"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Photo, PhotoTag } from "@/lib/database.types";
import { photoUrl } from "@/lib/photos";
import { setPhotoTags } from "../actions";

/** Instagram's own ceiling. */
const MAX_TAGS = 20;

/**
 * Tagging accounts on one image.
 *
 * Instagram wants a username and a position as fractions of the image, so the
 * position is set by clicking where the tag should sit rather than typed — the
 * numbers are meaningless to a person, and a tag on the wrong part of a photo
 * is the whole failure mode.
 *
 * The full-size file is shown here, not the thumbnail: you are pointing at
 * something specific in the picture.
 */
export function TagEditor({
  photo,
  postId,
  tags,
  onClose,
}: {
  photo: Photo;
  postId: string;
  tags: PhotoTag[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState(
    tags.map((t) => ({ username: t.username, x: Number(t.x), y: Number(t.y) })),
  );
  const [placing, setPlacing] = useState<{ x: number; y: number } | null>(null);
  const [username, setUsername] = useState("");

  const frame = useRef<HTMLDivElement>(null);

  const onImageClick = (event: React.MouseEvent) => {
    if (items.length >= MAX_TAGS) return;
    if (!frame.current) return;

    const rect = frame.current.getBoundingClientRect();
    setPlacing({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
    setUsername("");
  };

  const confirmTag = () => {
    if (!placing) return;

    const clean = username.trim().replace(/^@+/, "");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) {
      setError("Usernames can only contain letters, numbers, dots and underscores.");
      return;
    }

    if (items.some((t) => t.username.toLowerCase() === clean.toLowerCase())) {
      setError(`@${clean} is already tagged on this photo.`);
      return;
    }

    setError(null);
    setItems([...items, { username: clean, x: placing.x, y: placing.y }]);
    setPlacing(null);
    setUsername("");
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await setPhotoTags(postId, photo.id, items);
      if (result.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const src = photo.storage_path ? photoUrl(photo.storage_path) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 p-4">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Tag accounts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          >
            Close
          </button>
        </div>

        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Click where the tag should sit, then type the username. {items.length} of{" "}
          {MAX_TAGS} used.
        </p>

        {src && (
          <div
            ref={frame}
            onClick={onImageClick}
            className="relative mt-3 cursor-crosshair overflow-hidden rounded bg-stone-950"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="w-full" />

            {items.map((tag) => (
              <span
                key={tag.username}
                style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-stone-900/85 px-1.5 py-0.5 text-[11px] font-medium text-white"
              >
                @{tag.username}
              </span>
            ))}

            {placing && (
              <span
                style={{ left: `${placing.x * 100}%`, top: `${placing.y * 100}%` }}
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500"
              />
            )}
          </div>
        )}

        {placing && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-stone-500">@</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmTag();
                }
                if (event.key === "Escape") setPlacing(null);
              }}
              autoFocus
              placeholder="username"
              className="w-48 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
            <button
              type="button"
              onClick={confirmTag}
              className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium dark:border-stone-700"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setPlacing(null)}
              className="text-xs text-stone-500"
            >
              Cancel
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {items.map((tag) => (
              <li
                key={tag.username}
                className="flex items-center gap-1 rounded-full border border-stone-300 py-0.5 pl-2 pr-1 text-xs dark:border-stone-700"
              >
                @{tag.username}
                <button
                  type="button"
                  onClick={() => setItems(items.filter((t) => t.username !== tag.username))}
                  aria-label={`Remove @${tag.username}`}
                  className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Tagging only works if that account allows it — Instagram silently
          drops a tag the account has disallowed.
        </p>

        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="mt-3 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {pending ? "Saving…" : "Save tags"}
        </button>
      </div>
    </div>
  );
}
