"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Weekly posting slots.
 *
 * Stored as a weekday plus a wall-clock time rather than as instants, so a
 * 10am slot stays 10am across both daylight-saving changes. See src/lib/time.ts.
 */
export async function addSlot(
  weekday: number,
  localTime: string,
): Promise<{ error?: string }> {
  if (weekday < 0 || weekday > 6) return { error: "Pick a day of the week." };
  if (!/^\d{2}:\d{2}$/.test(localTime)) return { error: "Pick a time." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("schedule_slots")
    .insert({ weekday, local_time: `${localTime}:00` });

  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "You already have a slot at that time."
        : error.message,
    };
  }

  revalidatePath("/settings");
  revalidatePath("/queue");
  return {};
}

export async function setSlotActive(id: string, active: boolean): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("schedule_slots").update({ active }).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/queue");
  return {};
}

/**
 * Delete a slot.
 *
 * Posts already published through it keep their `slot_id` set to null rather
 * than being deleted with it — a published post is a record of something that
 * happened and must survive the timetable changing.
 */
export async function deleteSlot(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("schedule_slots").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/queue");
  return {};
}

export async function updateSettings(fields: {
  dry_run?: boolean;
  hashtag_min?: number;
  hashtag_max?: number;
  archive_published_after_days?: number;
  keep_originals_days?: number;
}): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  if (
    fields.hashtag_min !== undefined &&
    fields.hashtag_max !== undefined &&
    fields.hashtag_min > fields.hashtag_max
  ) {
    return { error: "The minimum cannot be above the maximum." };
  }

  const { error } = await supabase.from("app_settings").update(fields).eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

// ---------------------------------------------------------------------------
// Instagram credentials
// ---------------------------------------------------------------------------

/**
 * Save the Meta app credentials.
 *
 * These land in app_secrets, which deliberately has NO row-level security
 * policies — so the browser can write them but can never read them back. Only
 * the worker's service key can.
 */
export async function saveMetaCredentials(
  appId: string,
  appSecret: string,
): Promise<{ error?: string }> {
  const supabase = supabaseAdmin();

  const id = appId.trim();
  const secret = appSecret.trim();

  if (!/^\d{5,}$/.test(id)) {
    return { error: "An App ID is a long number — check you have copied the right field." };
  }
  if (secret.length < 16) {
    return { error: "That App Secret looks too short." };
  }

  const { error } = await supabase
    .from("app_secrets")
    .update({ ig_app_id: id, ig_app_secret: secret })
    .eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

/** Forget the Instagram connection. Dry run goes back on as a safety net. */
export async function disconnectInstagram(): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  await supabaseAdmin()
    .from("app_secrets")
    .update({ ig_access_token: null, ig_user_access_token: null })
    .eq("id", true);

  const { error } = await supabase
    .from("app_settings")
    .update({
      ig_user_id: null,
      ig_username: null,
      ig_page_id: null,
      ig_page_name: null,
      ig_connected_at: null,
      ig_token_expires_at: null,
      dry_run: true,
    })
    .eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

/**
 * Turn dry run off — the moment posts start going out for real.
 *
 * Refuses unless Instagram is actually connected, because otherwise the
 * publisher would simply fail at the next slot with nothing to publish through.
 */
export async function setDryRun(dryRun: boolean): Promise<{ error?: string }> {
  const supabase = await supabaseServer();

  if (!dryRun) {
    const { data } = await supabase
      .from("app_settings")
      .select("ig_user_id")
      .single();

    if (!data?.ig_user_id) {
      return { error: "Connect Instagram before turning dry run off." };
    }
  }

  const { error } = await supabase.from("app_settings").update({ dry_run: dryRun }).eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/");
  return {};
}
