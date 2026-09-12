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
  PhotoTag,
} from "@/lib/database.types";
import { planCaption, allHashtags, inlineHashtags, CAPTION_LIMIT } from "@/lib/caption";
import { MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";
import { updatePost, setPostPhotos, setPostHashtags } from "../actions";
import { PhotoPicker } from "./photo-picker";
import { HashtagPanel, type PickedTag } from "./hashtag-panel";
import { WhenBar } from "./when-bar";
import { PostActions } from "./post-actions";
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

  // Needed to insert text where the cursor is, rather than only at the end.
  const captionRef = useRef<HTMLTextAreaElement>(null);
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

  /*
   * Text sent over from the notes panel, dropped in at the cursor.
   *
   * An event rather than a prop because the panel sits outside this component
   * — it wraps the whole page so it can split it — and the caption is state in
   * here. Listening is the small end of that problem.
   *
   * Always the owner's own writing, moved from one box to another.
   */
  useEffect(() => {
    const onInsert = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text) return;

      const field = captionRef.current;

      // No cursor to speak of if the box was never focused, so it goes on the
      // end — which is where someone who has not clicked into it would expect.
      if (!field) {
        setCaption((current) => (current ? `${current}\n\n${text}` : text));
        return;
      }

      const { selectionStart, selectionEnd } = field;

      setCaption((current) => {
        const before = current.slice(0, selectionStart);
        const after = current.slice(selectionEnd);

        /*
         * Keep it off the neighbours.
         *
         * Dropped in raw, a line landed as "…for ten minutes.The details often"
         * — one thought welded to the next. A note is a whole thought, so it
         * gets a line of its own unless there is already a break there.
         */
        const lead = before && !/\s$/.test(before) ? "\n" : "";
        const trail = after && !/^\s/.test(after) ? "\n" : "";

        return before + lead + text + trail + after;
      });

      // Leave the cursor after what was just inserted, so typing carries on
      // from there rather than jumping to the end.
      const landed =
        selectionStart +
        text.length +
        (selectionStart > 0 && !/\s$/.test(field.value.slice(0, selectionStart)) ? 1 : 0);

      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(landed, landed);
      });
    };

    window.addEventListener("caption:insert", onInsert);
    return () => window.removeEventListener("caption:insert", onInsert);
  }, []);

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
    <div className="mx-auto max-w-2xl">
      {/*
        WHEN COMES FIRST. It used to be a banner at the top with one button and
        a panel at the bottom with two more — one decision in three places. It
        is also the honest order: whether this goes out on Thursday or sits as
        a draft changes how it gets written.
      */}
      <WhenBar
        post={post}
        photoCount={photoIds.length}
        hasCaption={caption.trim().length > 0}
        hashtagCount={effectiveTags.length}
        shapeProblem={shapeProblem}
        unsaved={dirty}
      />

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {/* Sections are separated by rules rather than boxed as cards. Every one
          being a bordered panel meant nothing looked more important than
          anything else. */}
      <section className="border-b border-stone-200 py-6 dark:border-stone-800">
        <PhotoPicker
          photos={libraryPhotos}
          usageById={usageById}
          selected={photoIds}
          onChange={setPhotoIds}
          tagCounts={tagCounts}
          onTag={setTagging}
          onCrop={setCropping}
        />
      </section>

      <section className="border-b border-stone-200 py-6 dark:border-stone-800">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base">Caption</h2>
          <span
            className={
              plan.overBy > 0
                ? "ml-auto text-xs font-medium tabular-nums text-red-600 dark:text-red-400"
                : plan.captionRemaining < 150
                  ? "ml-auto text-xs tabular-nums text-amber-600 dark:text-amber-400"
                  : "ml-auto text-xs tabular-nums text-stone-400 dark:text-stone-500"
            }
          >
            {plan.captionLength.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()}
            {plan.overBy > 0 && " · " + plan.overBy + " over"}
          </span>
        </div>

        {/*
          No border on the box. The caption is the page rather than a field on
          a form, and a rule under the heading is enough to say where it starts.
        */}
        <textarea
          ref={captionRef}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={9}
          placeholder="Write the caption…"
          className="mt-3 w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
        />

        {/*
          The whole caption used to be reprinted below under "Exactly what gets
          posted". Reading the same words twice is noise, and the box above is
          already exactly what gets posted. What is NOT visible in it is the
          part that goes somewhere else — so that is all that is shown.
        */}
        {placement === "first_comment" && plan.firstComment && (
          <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
              First comment
            </h3>
            <p className="mt-1.5 break-words text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              {plan.firstComment}
            </p>
          </div>
        )}

        {placement === "caption" && appended.length > 0 && (
          <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
              Added to the end of the caption
            </h3>
            <p className="mt-1.5 break-words text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              {appended.map((tag) => "#" + tag).join(" ")}
            </p>
          </div>
        )}

        {plan.overBy > 0 && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">
            {plan.overBy} characters over Instagram&rsquo;s limit — it will be
            refused as it stands.
          </p>
        )}
      </section>

      <section className="border-b border-stone-200 py-6 dark:border-stone-800">
        <HashtagPanel
          library={library}
          categories={categories}
          picked={picked}
          onChange={setPicked}
          inlineTags={inline}
          defaultCounts={defaultCounts}
        />

        {/* Placement reads as a sentence, because it is a setting changed
            about once a year rather than a panel of its own. */}
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          {placement === "first_comment"
            ? "Going in the first comment, so they do not count toward the caption."
            : "Going in the caption, so they count toward the 2,200 characters."}{" "}
          <button
            type="button"
            onClick={() =>
              setPlacement(placement === "caption" ? "first_comment" : "caption")
            }
            className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
          >
            {placement === "first_comment" ? "Put them in the caption" : "Move to first comment"}
          </button>
        </p>

        {tooManyTags && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {effectiveTags.length} hashtags — Instagram allows {MAX_HASHTAGS_PER_POST}.
          </p>
        )}

        {!tooManyTags && outsideGuide && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            You usually use {guide.min}–{guide.max} — not a rule, just a nudge.
          </p>
        )}
      </section>

      {/* Save and discard sit at the end, where you finish. The unsaved state
          is also announced at the top by WhenBar, because that is where it
          stops you publishing. */}
      <div className="flex items-center gap-3 py-5">
        <button
          type="button"
          disabled={!dirty || saveState === "saving"}
          onClick={() => void save()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {saveState === "saving" ? "Saving…" : "Save"}
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

        <span className="text-xs text-stone-400 dark:text-stone-500">
          {dirty
            ? "Unsaved changes"
            : saveState === "saved"
              ? "Saved"
              : "Everything saved"}
        </span>
      </div>

      <PostActions post={post} />

      {cropping && <CropEditor photo={cropping} onClose={() => setCropping(null)} />}

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
