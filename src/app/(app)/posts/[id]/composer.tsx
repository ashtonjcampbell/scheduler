"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Hashtag,
  HashtagCategory,
  HashtagPlacement,
  Photo,
  PhotoUsage,
  Post,
  PhotoTag,
} from "@/lib/database.types";
import { planCaption, allHashtags, inlineHashtags, CAPTION_LIMIT } from "@/lib/caption";
import { MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";
import { updatePost, setPostPhotos, setPostHashtags } from "../actions";
import { PhotoPicker } from "./photo-picker";
import { HashtagPanel, type PickedTag } from "./hashtag-panel";
import { SchedulePanel } from "./schedule-panel";
import { PostHeader } from "./post-header";
import { TagEditor } from "./tag-editor";
import { CropEditor } from "../../media/crop-editor";
import { carouselShape, describeShape } from "@/lib/shape";

type LoadedPost = Post & {
  post_photos: Array<{ id: string; photo_id: string; position: number }>;
  post_hashtags: Array<{ id: string; tag: string; hashtag_id: string | null; position: number }>;
  photo_tags: PhotoTag[];
};

/**
 * What a saved post looks like, for comparing against what is on screen.
 *
 * Editing used to save itself a moment after you stopped typing, which meant
 * there was never anything to take back — a sentence you regretted was already
 * the post. Saving is now deliberate, which is what makes discarding possible.
 */
type Snapshot = {
  caption: string;
  placement: HashtagPlacement;
  photoIds: string[];
  picked: PickedTag[];
};

function snapshotOf(post: LoadedPost): Snapshot {
  return {
    caption: post.caption,
    placement: post.hashtag_placement,
    photoIds: [...post.post_photos].sort((a, b) => a.position - b.position).map((p) => p.photo_id),
    picked: [...post.post_hashtags]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ tag: t.tag, hashtagId: t.hashtag_id })),
  };
}

/** Order matters for photos and hashtags, so compare in order. */
function same(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function Composer({
  post,
  libraryPhotos,
  usage,
  library,
  categories,
  guide,
  defaultCounts,
}: {
  post: LoadedPost;
  libraryPhotos: Photo[];
  usage: Array<{ photo_id: string; usage: PhotoUsage }>;
  library: Hashtag[];
  categories: HashtagCategory[];
  guide: { min: number; max: number };
  defaultCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [caption, setCaption] = useState(() => snapshotOf(post).caption);
  const [placement, setPlacement] = useState<HashtagPlacement>(
    () => snapshotOf(post).placement,
  );
  const [photoIds, setPhotoIds] = useState<string[]>(() => snapshotOf(post).photoIds);
  const [picked, setPicked] = useState<PickedTag[]>(() => snapshotOf(post).picked);

  /** The last version written to the database — what "discard" returns to. */
  const [saved, setSaved] = useState<Snapshot>(() => snapshotOf(post));

  const [tagging, setTagging] = useState<Photo | null>(null);
  const [cropping, setCropping] = useState<Photo | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Hashtags typed straight into the caption count toward Instagram's 30 just
  // as much as picked ones, so the counter has to see both.
  const inline = useMemo(() => inlineHashtags(caption), [caption]);
  const effectiveTags = useMemo(
    () => allHashtags(caption, picked.map((p) => p.tag)),
    [caption, picked],
  );

  // When hashtags are already written into the caption body, appending them
  // again underneath would duplicate them.
  const appended = useMemo(
    () =>
      picked
        .map((p) => p.tag)
        .filter((tag) => !inline.some((i) => i.toLowerCase() === tag.toLowerCase())),
    [picked, inline],
  );

  const plan = useMemo(
    () => planCaption({ body: caption, tags: appended, placement }),
    [caption, appended, placement],
  );

  // --- saving ---------------------------------------------------------------

  const current: Snapshot = useMemo(
    () => ({ caption, placement, photoIds, picked }),
    [caption, placement, photoIds, picked],
  );

  const dirty = !same(current, saved);

  const save = useCallback(async () => {
    setSaveState("saving");
    setError(null);

    const results = await Promise.all([
      updatePost(post.id, { caption, hashtag_placement: placement }),
      setPostPhotos(post.id, photoIds),
      setPostHashtags(post.id, picked),
    ]);

    const failure = results.find((r) => r.error);
    if (failure?.error) {
      setError(failure.error);
      setSaveState("error");
      return;
    }

    setSaved({ caption, placement, photoIds, picked });
    setSaveState("saved");
    startTransition(() => router.refresh());
  }, [post.id, caption, placement, photoIds, picked, router]);

  const discard = useCallback(() => {
    setCaption(saved.caption);
    setPlacement(saved.placement);
    setPhotoIds(saved.photoIds);
    setPicked(saved.picked);
    setSaveState("idle");
    setError(null);
  }, [saved]);

  /*
   * The browser's own "leave site?" prompt. Crude, and the only thing that
   * works for a closed tab or a typed URL — without it, deliberate saving
   * would just be a quieter way to lose an afternoon's writing.
   */
  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Ctrl/Cmd+S is the reflex for anyone who has ever used a text editor, and
  // the browser's own save dialog is never what is wanted here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  const usageById = useMemo(
    () => new Map(usage.map((u) => [u.photo_id, u.usage])),
    [usage],
  );

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of post.photo_tags) {
      counts.set(tag.photo_id, (counts.get(tag.photo_id) ?? 0) + 1);
    }
    return counts;
  }, [post.photo_tags]);

  /*
   * What Instagram will do to these photos, in the order they are actually in.
   * Checked here rather than at publish time because this is where it can
   * still be fixed — by the crop button sitting right next to each photo.
   */
  const shape = useMemo(() => {
    const byId = new Map(libraryPhotos.map((p) => [p.id, p]));
    return carouselShape(
      photoIds
        .map((id) => byId.get(id))
        .filter((p): p is Photo => !!p)
        .map((p) => ({
          id: p.id,
          width: p.width,
          height: p.height,
          ready: p.status === "ready",
        })),
    );
  }, [photoIds, libraryPhotos]);

  const shapeProblem = describeShape(shape);

  const tooManyTags = effectiveTags.length > MAX_HASHTAGS_PER_POST;
  const outsideGuide =
    effectiveTags.length > 0 &&
    (effectiveTags.length < guide.min || effectiveTags.length > guide.max);

  return (
    <div className="space-y-5">
      {/* No title field. It was an internal name that never left the app, and
          the caption's first line already identifies a post everywhere one
          needs identifying — so it was a box to fill in for nothing. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto" />
        <SaveIndicator state={saveState} dirty={dirty} />

        <button
          type="button"
          disabled={!dirty || saveState === "saving"}
          onClick={() => void save()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          Save
        </button>

        <button
          type="button"
          disabled={!dirty || saveState === "saving"}
          onClick={() => {
            if (confirm("Throw away every change since the last save?")) discard();
          }}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-stone-700"
        >
          Discard
        </button>
      </div>

      <PostHeader
        post={post}
        photoCount={photoIds.length}
        hasCaption={caption.trim().length > 0}
        hashtagCount={effectiveTags.length}
        shapeProblem={shapeProblem}
        unsaved={dirty}
      />

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <PhotoPicker
            photos={libraryPhotos}
            usageById={usageById}
            selected={photoIds}
            onChange={setPhotoIds}
            tagCounts={tagCounts}
            onTag={setTagging}
            onCrop={setCropping}
          />

          <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Caption</h2>
              <span
                className={
                  plan.overBy > 0
                    ? "text-xs font-medium tabular-nums text-red-600 dark:text-red-400"
                    : plan.captionRemaining < 150
                      ? "text-xs tabular-nums text-amber-600 dark:text-amber-400"
                      : "text-xs tabular-nums text-stone-500 dark:text-stone-400"
                }
              >
                {plan.captionLength.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()}
                {plan.overBy > 0 && ` · ${plan.overBy} over`}
              </span>
            </div>

            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={10}
              placeholder="Write the caption…"
              className="mt-3 w-full resize-y rounded-lg border border-stone-300 bg-white p-3 text-sm leading-relaxed outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
            />

            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              Instagram captions are plain text — line breaks work, bold and
              italic do not.
              {placement === "caption" && appended.length > 0 && (
                <> Hashtags are counted above because they go in the caption.</>
              )}
              {placement === "first_comment" && appended.length > 0 && (
                <> Hashtags are not counted above — they go in the first comment.</>
              )}
            </p>

            {/*
              The whole caption used to be reprinted below this box under
              "Exactly what gets posted". Reading the same words twice is noise,
              and the box above is already exactly what gets posted.

              What is NOT visible in the box is the part that goes somewhere
              else — so that is all that is shown, right where it belongs.
            */}
            {placement === "first_comment" && plan.firstComment && (
              <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
                <h3 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                  First comment
                </h3>
                <p className="mt-1.5 break-words rounded-lg bg-stone-50 p-2.5 text-sm leading-relaxed dark:bg-stone-950">
                  {plan.firstComment}
                </p>
              </div>
            )}

            {placement === "caption" && appended.length > 0 && (
              <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
                <h3 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                  Added to the end of the caption
                </h3>
                <p className="mt-1.5 break-words rounded-lg bg-stone-50 p-2.5 text-sm leading-relaxed dark:bg-stone-950">
                  {appended.map((tag) => `#${tag}`).join(" ")}
                </p>
              </div>
            )}

            {plan.overBy > 0 && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                {plan.overBy} characters over Instagram&rsquo;s limit — it will
                be refused as it stands.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <SchedulePanel
            post={post}
            photoCount={photoIds.length}
            hasCaption={caption.trim().length > 0}
            hashtagCount={effectiveTags.length}
            shapeProblem={shapeProblem}
            unsaved={dirty}
          />

          <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <h2 className="text-sm font-semibold">Where hashtags go</h2>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["caption", "In the caption", "Counts toward the 2,200 characters."],
                  [
                    "first_comment",
                    "As the first comment",
                    "Posted immediately after publishing. Keeps the caption clean.",
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer gap-2 text-sm">
                  <input
                    type="radio"
                    name="placement"
                    checked={placement === value}
                    onChange={() => setPlacement(value)}
                    className="mt-0.5 accent-stone-900 dark:accent-stone-100"
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <HashtagPanel
            library={library}
            categories={categories}
            picked={picked}
            onChange={setPicked}
            inlineTags={inline}
            guide={guide}
            defaultCounts={defaultCounts}
          />

          {tooManyTags && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {effectiveTags.length} hashtags — Instagram allows{" "}
              {MAX_HASHTAGS_PER_POST}.
            </p>
          )}

          {!tooManyTags && outsideGuide && (
            <p className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
              {effectiveTags.length} hashtags. You usually use {guide.min}–{guide.max}
              {" "}— not a rule, just a nudge.
            </p>
          )}
        </div>
      </div>
      {cropping && (
        <CropEditor photo={cropping} onClose={() => setCropping(null)} />
      )}

      {tagging && (
        <TagEditor
          photo={tagging}
          postId={post.id}
          tags={post.photo_tags.filter((t) => t.photo_id === tagging.id)}
          onClose={() => setTagging(null)}
        />
      )}
    </div>
  );
}

/**
 * The exact text that will be sent, rendered from the same function the
 * publishing worker uses — so this cannot drift from what actually goes out.
 */
function SaveIndicator({
  state,
  dirty,
}: {
  state: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
}) {
  if (state === "saving") {
    return <span className="text-xs text-stone-500 dark:text-stone-400">Saving…</span>;
  }

  if (state === "error") {
    return <span className="text-xs text-red-600 dark:text-red-400">Not saved</span>;
  }

  // Unsaved beats a stale "Saved": once edited again, the last save is no
  // longer what this post says.
  if (dirty) {
    return (
      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Unsaved changes
      </span>
    );
  }

  // Says so even before anything has been edited. A greyed-out Save button with
  // no explanation reads as broken rather than as "there is nothing to save",
  // and the obvious wrong guess is that something else is blocking it.
  return (
    <span className="text-xs text-stone-500 dark:text-stone-400">All changes saved</span>
  );
}
