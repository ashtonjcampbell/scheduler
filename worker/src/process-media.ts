import { serviceClient, log } from "./lib/supabase.js";
import { processForInstagram } from "./lib/image.js";

/**
 * Turns raw uploads into the colour-managed files Instagram will be given.
 *
 * Runs in GitHub Actions rather than in the web app because Sharp is a
 * compiled library that Cloudflare Workers cannot load. See the README.
 */

/** How many rows to claim per trip to the database. Not a cap on the run. */
const BATCH_SIZE = 25;

/**
 * How long a run keeps pulling work before bowing out.
 *
 * A run drains the whole queue rather than stopping at one batch, so a
 * hundred-photo import finishes in a single run instead of trickling through
 * 20-minute sweeps. The budget sits well inside the workflow's 20-minute
 * timeout so the job always ends cleanly, with its progress recorded, rather
 * than being killed mid-photo.
 */
const TIME_BUDGET_MS = 15 * 60 * 1000;

/**
 * A run that dies mid-photo leaves its row marked 'processing' forever.
 * Anything claimed longer ago than this is assumed abandoned and retried.
 */
const STALE_CLAIM_MINUTES = 30;

/**
 * How long a trashed photo is kept before it is destroyed for good.
 *
 * Must match TRASH_RETENTION_DAYS in src/app/(app)/media/actions.ts, which is
 * what the trash screen promises the user.
 */
const TRASH_RETENTION_DAYS = 30;

async function main() {
  const supabase = serviceClient();

  await releaseStaleClaims();
  await purgeOldTrash();

  const startedAt = Date.now();
  let succeeded = 0;
  let failed = 0;
  let ranOutOfTime = false;

  // Keep pulling batches until the queue is empty. Photos uploaded WHILE this
  // run is working get picked up by it too, which is what makes uploading in
  // several batches feel like one continuous operation.
  for (;;) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }

    const { data: pending, error } = await supabase
      .from("photos")
      .select("id, original_filename, upload_path")
      .eq("status", "pending")
      .not("upload_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`Could not read the upload queue: ${error.message}`);
    }

    if (!pending || pending.length === 0) break;

    // Deliberately sequential. Sharp is memory-hungry and a GitHub runner is
    // small; three 40MP files decoded at once is how a runner gets killed.
    for (const photo of pending) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        ranOutOfTime = true;
        break;
      }

      const ok = await processOne(photo.id, photo.upload_path!, photo.original_filename);
      if (ok) succeeded++;
      else failed++;
    }

    if (ranOutOfTime) break;
  }

  if (succeeded === 0 && failed === 0) {
    console.log("Nothing to process.");
    return;
  }

  console.log(`Done. ${succeeded} processed, ${failed} failed.`);

  if (ranOutOfTime) {
    // Not a failure: the remaining photos are still pending and the next run
    // continues from here. Logged so a long import is explainable later.
    await log(
      "warn",
      "Stopped at the time limit with photos still queued — the next run will continue",
      { succeeded, failed },
    );
  }

  // A failure here is already recorded per-photo and surfaced in the UI, so
  // the job itself only fails when nothing at all got through — which is the
  // signal worth an email.
  if (succeeded === 0 && failed > 0) {
    throw new Error(`All ${failed} photo(s) failed to process.`);
  }
}

async function processOne(
  id: string,
  uploadPath: string,
  filename: string,
): Promise<boolean> {
  const supabase = serviceClient();

  // Claim it. The `.eq("status", "pending")` makes this a compare-and-set, so
  // two overlapping runs cannot both take the same photo.
  const { data: claimed, error: claimError } = await supabase
    .from("photos")
    .update({ status: "processing", processed_at: null, claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (claimError) {
    await log("error", `Could not claim photo for processing`, {
      id,
      error: claimError.message,
    });
    return false;
  }

  if (!claimed || claimed.length === 0) {
    // Another run got there first. Not an error.
    console.log(`Skipping ${filename}: already claimed.`);
    return true;
  }

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("uploads")
      .download(uploadPath);

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? "The upload could not be found");
    }

    const input = Buffer.from(await blob.arrayBuffer());
    const result = await processForInstagram(input);

    const storagePath = `${id}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, result.data, {
        contentType: "image/jpeg",
        // Files are immutable once written and named by a UUID, so they can
        // be cached hard. Instagram fetches this URL too.
        cacheControl: "31536000",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Could not store the processed file: ${uploadError.message}`);
    }

    const { error: updateError } = await supabase
      .from("photos")
      .update({
        status: "ready",
        storage_path: storagePath,
        // The original has served its purpose; clearing the path first means
        // a failed delete below cannot leave a dangling reference.
        upload_path: null,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        source_color_profile: result.sourceColorProfile,
        missing_color_profile: result.missingColorProfile,
        processing_error: null,
        processed_at: new Date().toISOString(),
        claimed_at: null,
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(`Could not record the result: ${updateError.message}`);
    }

    // Free the storage the original was using. A failure here wastes space
    // but does not invalidate the work, so it must not fail the photo.
    const { error: removeError } = await supabase.storage
      .from("uploads")
      .remove([uploadPath]);

    if (removeError) {
      await log("warn", "Processed file stored, but the original could not be deleted", {
        id,
        uploadPath,
        error: removeError.message,
      });
    }

    console.log(
      `  ${filename} → ${result.width}×${result.height}, ` +
        `${(result.bytes / 1024 / 1024).toFixed(2)}MB, q${result.quality}, ` +
        `from ${result.sourceColorProfile ?? "no embedded profile"}`,
    );

    if (result.missingColorProfile) {
      await log(
        "warn",
        `${filename} had no colour profile — check its colours before scheduling`,
        { id },
      );
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("photos")
      .update({ status: "failed", processing_error: message, claimed_at: null })
      .eq("id", id);

    await log("error", `Could not process ${filename}`, { id, error: message });
    return false;
  }
}

/**
 * Destroy photos that have sat in the trash past the retention window.
 *
 * Storage is the scarce resource on the free tier — a trashed photo keeps
 * using it until this runs — so the trash has to empty itself eventually. The
 * cutoff is deliberately generous and the trash screen states it plainly.
 */
async function purgeOldTrash() {
  const supabase = serviceClient();
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: expired, error } = await supabase
    .from("photos")
    .select("id, original_filename, storage_path, upload_path")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);

  if (error) {
    await log("warn", "Could not check the trash for expired photos", {
      error: error.message,
    });
    return;
  }

  if (!expired || expired.length === 0) return;

  let removed = 0;

  for (const photo of expired) {
    // Row first: the in-use trigger refuses if the photo somehow became part
    // of a live post, and that refusal must leave the files alone.
    const { error: deleteError } = await supabase
      .from("photos")
      .delete()
      .eq("id", photo.id);

    if (deleteError) {
      await log("warn", `Could not purge ${photo.original_filename} from the trash`, {
        id: photo.id,
        error: deleteError.message,
      });
      continue;
    }

    if (photo.storage_path) {
      await supabase.storage.from("media").remove([photo.storage_path]);
    }
    if (photo.upload_path) {
      await supabase.storage.from("uploads").remove([photo.upload_path]);
    }

    removed++;
  }

  if (removed > 0) {
    await log(
      "info",
      `Purged ${removed} photo(s) that had been in the trash over ${TRASH_RETENTION_DAYS} days`,
    );
  }
}

/** Hand abandoned claims back to the queue so a dead run doesn't strand them. */
async function releaseStaleClaims() {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();

  const { data, error } = await serviceClient()
    .from("photos")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "processing")
    .lt("claimed_at", cutoff)
    .select("id");

  if (error) {
    await log("warn", "Could not release stale processing claims", {
      error: error.message,
    });
    return;
  }

  if (data && data.length > 0) {
    await log("warn", `Released ${data.length} stalled photo(s) back to the queue`);
  }
}

await main();
