"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

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
