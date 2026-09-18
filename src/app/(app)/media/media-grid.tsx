"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Photo, PhotoUsage } from "@/lib/database.types";
import { PhotoCard } from "./photo-card";
import { createPostFrom } from "./create-post-from";
import { trashPhotos } from "./actions";

/** Instagram's Content Publishing API caps a carousel at 10 images. */
const MAX_CAROUSEL = 10;

/**
 * The media bank grid, with selection.
 *
 * Selection is ordered rather than a set: the first photo picked becomes the
 * first in the carousel, which is the one that shows in the profile grid. A
 * plain Set would lose that and quietly reorder the post.
 */
export function MediaGrid({
  photos,
  usageById,
  inTrash,
}: {
  photos: Photo[];
  usageById: Map<string, PhotoUsage>;
  inTrash: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const toggle = (id: string) => {
    setError(null);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await createPostFrom(selected);
      // A successful call redirects and never returns; anything here failed.
      if (result?.error) setError(result.error);
    });
  };

  /*
   * Everything selected, to the trash in one go.
   *
   * No "are you sure": it is the trash, and anything in it comes back with one
   * click for thirty days. Asking would only make the reversible step feel as
   * heavy as the irreversible one.
   */
  const trash = () => {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await trashPhotos(selected);

      if (result.error) {
        setError(result.error);
        return;
      }

      setSelected([]);
      setNotice(
        result.kept
          ? `Moved ${result.trashed} to the trash. ${result.kept} kept — ${result.kept === 1 ? "it is" : "they are"} in a scheduled or published post.`
          : `Moved ${result.trashed} to the trash.`,
      );
      router.refresh();
    });
  };

  const tooMany = selected.length > MAX_CAROUSEL;

  return (
    <>
      {/*
        Pinned directly under the nav bar, whose height `top-14` matches.

        It was `bottom-4` before, which sounds equivalent and is not: with a
        library this long, a selection made near the top left the button
        several screens below, and reaching it meant scrolling away from the
        photos you were choosing between.
      */}
      {selected.length > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-stone-300 bg-white px-4 py-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <span className="text-sm font-medium">
            {selected.length} selected
            {selected.length > 1 && (
              <span className="ml-2 font-normal text-stone-500 dark:text-stone-400">
                first one leads the carousel
              </span>
            )}
          </span>

          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={trash}
            disabled={pending}
            className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition hover:border-red-400 hover:text-red-700 disabled:opacity-50 dark:border-stone-700 dark:hover:border-red-800 dark:hover:text-red-400"
          >
            Move to trash
          </button>

          <button
            type="button"
            onClick={start}
            disabled={pending || tooMany}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {pending
              ? "Creating…"
              : selected.length === 1
                ? "Make a post from this"
                : `Make a post from these ${selected.length}`}
          </button>

          {tooMany && (
            <p className="w-full text-xs text-red-600 dark:text-red-400">
              Instagram allows {MAX_CAROUSEL} images in a carousel. Deselect{" "}
              {selected.length - MAX_CAROUSEL} to make a post — trashing works on any
              number.
            </p>
          )}

          {error && (
            <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      )}

      {notice && selected.length === 0 && (
        <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
          {notice}{" "}
          <a href="/media?filter=trash" className="underline underline-offset-2">
            Open the trash
          </a>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            usage={usageById.get(photo.id) ?? "unused"}
            inTrash={inTrash}
            // Only ready, un-archived photos can start a post, so only those
            // offer a checkbox — rather than letting one be picked and then
            // refused on the next screen.
            selectable={!inTrash && photo.status === "ready" && !!photo.storage_path}
            selectedIndex={selected.indexOf(photo.id)}
            onToggleSelect={() => toggle(photo.id)}
          />
        ))}
      </div>
    </>
  );
}
