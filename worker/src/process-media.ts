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
  await purgeExpiredOriginals();
  await archivePublishedPhotos();

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
    const thumbPath = `thumbs/${id}.jpg`;

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

    const { error: thumbError } = await supabase.storage
      .from("media")
      .upload(thumbPath, result.thumb, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });

    if (thumbError) {
      throw new Error(`Could not store the thumbnail: ${thumbError.message}`);
    }

    const { error: updateError } = await supabase
      .from("photos")
      .update({
        status: "ready",
        storage_path: storagePath,
        thumb_path: thumbPath,
        // The original is deliberately KEPT for a while: a lossless re-crop,
        // or re-reading a file whose profile had to be guessed, both need it.
        // purgeExpiredOriginals() clears it once the window passes.
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


    console.log(
      `  ${filename} → ${result.width}×${result.height}, ` +
        `${(result.bytes / 1024 / 1024).toFixed(2)}MB (+${Math.round(result.thumbBytes / 1024)}KB thumb), q${result.quality}, ` +
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

/**
 * Drop the full-size file for photos whose posts went live a while ago.
 *
 * Once a post is published, Instagram holds its own copy and the only thing
 * this app still needs is something to draw in the grid preview — which the
 * thumbnail covers at about 5% of the size.
 *
 * Two rules keep this from destroying anything useful:
 *
 *  - the photo must not belong to any post that is still unpublished. A photo
 *    queued for a second post keeps its full file, or that post would go out
 *    with nothing to send.
 *  - the thumbnail must already exist. Photos processed before thumbnails
 *    were added have none, and archiving those would leave a blank square.
 */
async function archivePublishedPhotos() {
  const supabase = serviceClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("archive_published_after_days")
    .single();

  const days = settings?.archive_published_after_days ?? 0;
  if (days <= 0) return; // Archiving switched off.

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Everything still holding a full file that has a thumbnail to fall back on.
  const { data: candidates, error } = await supabase
    .from("photos")
    .select("id, original_filename, storage_path")
    .not("storage_path", "is", null)
    .not("thumb_path", "is", null)
    .is("full_removed_at", null);

  if (error) {
    await log("warn", "Could not check for archivable photos", { error: error.message });
    return;
  }

  if (!candidates || candidates.length === 0) return;

  // Both sides fetched separately and paired here: an embedded select needs
  // relationship metadata the hand-written types do not carry.
  const { data: allLinks } = await supabase.from("post_photos").select("photo_id, post_id");
  const { data: posts } = await supabase.from("posts").select("id, status, published_at");

  const postById = new Map((posts ?? []).map((p) => [p.id, p]));

  const usage = new Map<string, { unpublished: boolean; lastPublished: string | null }>();
  for (const link of allLinks ?? []) {
    const post = postById.get(link.post_id);
    if (!post) continue;

    const entry = usage.get(link.photo_id) ?? { unpublished: false, lastPublished: null };

    if (post.status === "published") {
      if (post.published_at && (!entry.lastPublished || post.published_at > entry.lastPublished)) {
        entry.lastPublished = post.published_at;
      }
    } else {
      entry.unpublished = true;
    }

    usage.set(link.photo_id, entry);
  }

  let archived = 0;
  let freed = 0;

  for (const photo of candidates) {
    const entry = usage.get(photo.id);

    // Never used, or still wanted by a post that has not gone out yet.
    if (!entry || entry.unpublished || !entry.lastPublished) continue;
    if (entry.lastPublished > cutoff) continue;

    const { data: sizes } = await supabase
      .from("photos")
      .select("bytes")
      .eq("id", photo.id)
      .single();

    const { error: removeError } = await supabase.storage
      .from("media")
      .remove([photo.storage_path!]);

    if (removeError) {
      await log("warn", `Could not archive ${photo.original_filename}`, {
        id: photo.id,
        error: removeError.message,
      });
      continue;
    }

    // Row updated only after the file is actually gone, so a failure here
    // leaves the photo looking normal rather than pointing at nothing.
    await supabase
      .from("photos")
      .update({ storage_path: null, full_removed_at: new Date().toISOString() })
      .eq("id", photo.id);

    archived++;
    freed += sizes?.bytes ?? 0;
  }

  if (archived > 0) {
    await log(
      "info",
      `Archived ${archived} published photo(s), freeing ${(freed / 1024 / 1024).toFixed(1)}MB`,
      { days },
    );
  }
}

/**
 * Delete originals that have outlived their usefulness.
 *
 * The original is kept for a short window after conversion so a crop or a
 * corrected colour profile can be applied losslessly. Past that window it is
 * pure cost: the delivered file already exists, and only recent uploads are
 * ever revisited in practice.
 */
async function purgeExpiredOriginals() {
  const supabase = serviceClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("keep_originals_days")
    .single();

  const days = settings?.keep_originals_days ?? 7;
  if (days <= 0) return; // Keeping originals indefinitely.

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired, error } = await supabase
    .from("photos")
    .select("id, original_filename, upload_path")
    .eq("status", "ready")
    .not("upload_path", "is", null)
    .is("original_removed_at", null)
    .lt("processed_at", cutoff);

  if (error) {
    await log("warn", "Could not check for expired originals", { error: error.message });
    return;
  }

  if (!expired || expired.length === 0) return;

  let removed = 0;

  for (const photo of expired) {
    const { error: removeError } = await supabase.storage
      .from("uploads")
      .remove([photo.upload_path!]);

    if (removeError) {
      await log("warn", `Could not delete the original for ${photo.original_filename}`, {
        id: photo.id,
        error: removeError.message,
      });
      continue;
    }

    // Row updated only once the file is actually gone, so a failure leaves
    // the photo looking re-croppable rather than pointing at nothing.
    await supabase
      .from("photos")
      .update({ upload_path: null, original_removed_at: new Date().toISOString() })
      .eq("id", photo.id);

    removed++;
  }

  if (removed > 0) {
    await log("info", `Deleted ${removed} original(s) older than ${days} days`);
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
