"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Hashtag,
  HashtagCategory,
  HashtagPlacement,
  Photo,
  PhotoUsage,
  Post,
} from "@/lib/database.types";
import { planCaption, allHashtags, inlineHashtags, CAPTION_LIMIT } from "@/lib/caption";
import { MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";
import { updatePost, setPostPhotos, setPostHashtags } from "../actions";
import { PhotoPicker } from "./photo-picker";
import { HashtagPanel, type PickedTag } from "./hashtag-panel";

type LoadedPost = Post & {
  post_photos: Array<{ id: string; photo_id: string; position: number }>;
  post_hashtags: Array<{ id: string; tag: string; hashtag_id: string | null; position: number }>;
};

/** Long enough not to fire mid-sentence, short enough to feel automatic. */
const SAVE_DELAY_MS = 900;

export function Composer({
  post,
  libraryPhotos,
  usage,
  library,
  categories,
  guide,
}: {
  post: LoadedPost;
  libraryPhotos: Photo[];
  usage: Array<{ photo_id: string; usage: PhotoUsage }>;
  library: Hashtag[];
  categories: HashtagCategory[];
  guide: { min: number; max: number };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(post.title ?? "");
  const [caption, setCaption] = useState(post.caption);
  const [placement, setPlacement] = useState<HashtagPlacement>(post.hashtag_placement);

  const [photoIds, setPhotoIds] = useState<string[]>(() =>
    [...post.post_photos].sort((a, b) => a.position - b.position).map((p) => p.photo_id),
  );

  const [picked, setPicked] = useState<PickedTag[]>(() =>
    [...post.post_hashtags]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ tag: t.tag, hashtagId: t.hashtag_id })),
  );

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

  // --- autosave -----------------------------------------------------------

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const save = useCallback(async () => {
    setSaveState("saving");
    setError(null);

    const results = await Promise.all([
      updatePost(post.id, { title, caption, hashtag_placement: placement }),
      setPostPhotos(post.id, photoIds),
      setPostHashtags(post.id, picked),
    ]);

    const failure = results.find((r) => r.error);
    if (failure?.error) {
      setError(failure.error);
      setSaveState("error");
      return;
    }

    setSaveState("saved");
    startTransition(() => router.refresh());
  }, [post.id, title, caption, placement, photoIds, picked, router]);

  useEffect(() => {
    // Don't save on mount — nothing has changed yet.
    if (first.current) {
      first.current = false;
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);

  const usageById = useMemo(
    () => new Map(usage.map((u) => [u.photo_id, u.usage])),
    [usage],
  );

  const tooManyTags = effectiveTags.length > MAX_HASHTAGS_PER_POST;
  const outsideGuide =
    effectiveTags.length > 0 &&
    (effectiveTags.length < guide.min || effectiveTags.length > guide.max);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Internal name (never posted)"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
        />
        <SaveIndicator state={saveState} />
      </div>

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
          </section>

          <PreviewPanel plan={plan} placement={placement} />
        </div>

        <div className="space-y-5">
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
    </div>
  );
}

/**
 * The exact text that will be sent, rendered from the same function the
 * publishing worker uses — so this cannot drift from what actually goes out.
 */
function PreviewPanel({
  plan,
  placement,
}: {
  plan: ReturnType<typeof planCaption>;
  placement: HashtagPlacement;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Exactly what gets posted</h2>

      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 font-sans text-sm leading-relaxed dark:bg-stone-950">
        {plan.caption || (
          <span className="text-stone-400 dark:text-stone-600">Nothing yet.</span>
        )}
      </pre>

      {plan.firstComment && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            First comment
          </h3>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 font-sans text-sm dark:bg-stone-950">
            {plan.firstComment}
          </pre>
        </>
      )}

      {placement === "first_comment" && !plan.firstComment && (
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          No hashtags yet, so there will be no first comment.
        </p>
      )}
    </section>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const text = {
    idle: "",
    saving: "Saving…",
    saved: "Saved",
    error: "Not saved",
  }[state];

  if (!text) return null;

  return (
    <span
      className={
        state === "error"
          ? "text-xs text-red-600 dark:text-red-400"
          : "text-xs text-stone-500 dark:text-stone-400"
      }
    >
      {text}
    </span>
  );
}
