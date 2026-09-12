"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { assignQueue, publishOrder } from "@/lib/queue";
import { thumbUrl } from "@/lib/photos";
import type { Notebook } from "@/lib/notebooks";

export type StripTile = {
  id: string;
  caption: string;
  cover: string | null;
  ready: boolean;
  at: string | null;
};

/**
 * What the strip shows, fetched only when it is opened.
 *
 * NOT loaded with any page. Cloudflare gives a free Worker about ten
 * milliseconds, and a strip that rendered with every page would add a second
 * page's worth of work to every request whether or not it was open. Opening
 * it is a deliberate act, and that is when it is paid for — once, and then
 * kept for the rest of the visit, because the strip lives in the shell and
 * the shell does not remount when you move between pages.
 */
export async function loadStrip(): Promise<{
  tiles?: StripTile[];
  notes?: Record<Notebook, string>;
  error?: string;
}> {
  const supabase = await supabaseServer();

  const [{ data: posts, error }, { data: slots }, { data: links }, { data: photos }, { data: notes }] =
    await Promise.all([
      supabase
        .from("posts")
        .select("id, caption, status, ready, scheduled_for, queue_position")
        .in("status", ["preview_draft", "queued", "scheduled", "publishing"])
        .is("removed_from_instagram_at", null),
      supabase.from("schedule_slots").select("*"),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase
        .from("photos")
        .select("id, storage_path, thumb_path, processed_at")
        .is("deleted_at", null),
      supabase.from("notes").select("kind, content_html"),
    ]);

  if (error) return { error: error.message };

  const all = posts ?? [];

  // Worked out the same way the grid and the worker do it — one source of
  // truth for "when", so the strip cannot disagree with the page beside it.
  const queued = publishOrder(
    all.filter((p) => p.queue_position !== null && p.ready),
  );

  const { assignments } = assignQueue({
    posts: queued,
    slots: slots ?? [],
    fixed: all
      .filter((p) => p.scheduled_for && p.queue_position === null)
      .map((p) => ({ id: p.id, scheduled_for: p.scheduled_for! })),
    now: new Date(),
  });

  const timeFor = new Map(assignments.map((a) => [a.postId, a.at.toISOString()]));
  const photoById = new Map((photos ?? []).map((p) => [p.id, p]));

  const coverFor = (postId: string) => {
    const first = (links ?? [])
      .filter((l) => l.post_id === postId)
      .sort((a, b) => a.position - b.position)[0];
    const photo = first ? photoById.get(first.photo_id) : undefined;
    return photo ? thumbUrl(photo) : null;
  };

  // Newest first, the way Instagram draws a profile — so the strip matches
  // the grid it is a small copy of.
  const tiles = [...all]
    .sort((a, b) => (b.queue_position ?? 0) - (a.queue_position ?? 0))
    .map((post) => ({
      id: post.id,
      caption: post.caption,
      cover: coverFor(post.id),
      ready: post.ready,
      at: post.scheduled_for ?? timeFor.get(post.id) ?? null,
    }));

  const byKind = new Map((notes ?? []).map((n) => [n.kind, n.content_html]));

  return {
    tiles,
    notes: {
      strategy: byKind.get("strategy") ?? "",
      idea_bank: byKind.get("idea_bank") ?? "",
    },
  };
}
