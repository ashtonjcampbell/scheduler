"use client";

import { useState } from "react";
import type { Photo, PhotoUsage } from "@/lib/database.types";
import { photoUrl, USAGE_LABELS } from "@/lib/photos";

/** Instagram's Content Publishing API cap, even though the app allows 20. */
const MAX_CAROUSEL = 10;

export function PhotoPicker({
  photos,
  usageById,
  selected,
  onChange,
}: {
  photos: Photo[];
  usageById: Map<string, PhotoUsage>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [onlyUnused, setOnlyUnused] = useState(false);

  const byId = new Map(photos.map((p) => [p.id, p]));
  const chosen = selected.map((id) => byId.get(id)).filter((p): p is Photo => !!p);

  const full = selected.length >= MAX_CAROUSEL;

  const add = (id: string) => {
    if (selected.includes(id) || full) return;
    onChange([...selected, id]);
  };

  const remove = (id: string) => onChange(selected.filter((s) => s !== id));

  const move = (index: number, delta: number) => {
    const next = [...selected];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;

    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const available = photos.filter((photo) => {
    if (selected.includes(photo.id)) return false;
    if (onlyUnused && (usageById.get(photo.id) ?? "unused") !== "unused") return false;
    return true;
  });

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Photos{" "}
          <span className="font-normal text-stone-500 dark:text-stone-400">
            {selected.length} of {MAX_CAROUSEL}
          </span>
        </h2>

        <button
          type="button"
          onClick={() => setBrowsing((v) => !v)}
          className="text-xs font-medium text-stone-600 underline-offset-2 hover:underline dark:text-stone-300"
        >
          {browsing ? "Done choosing" : "Choose photos"}
        </button>
      </div>

      {selected.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          No photos yet.
        </p>
      ) : (
        <ol className="mt-3 flex flex-wrap gap-2">
          {chosen.map((photo, index) => (
            <li
              key={photo.id}
              className="relative w-24 overflow-hidden rounded border border-stone-200 dark:border-stone-700"
            >
              {photo.storage_path && (
                // Plain <img> on purpose: this file is already exactly what
                // Instagram will receive, and re-encoding it risks the colour
                // shift the whole pipeline exists to prevent.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(photo.storage_path)}
                  alt={photo.alt_text ?? photo.original_filename}
                  className="aspect-square w-full object-cover"
                />
              )}

              <span className="absolute left-1 top-1 rounded bg-stone-900/80 px-1 text-[10px] font-semibold text-white">
                {index + 1}
              </span>

              <div className="flex items-center justify-between gap-0.5 bg-stone-50 px-1 py-0.5 dark:bg-stone-950">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move earlier"
                  className="px-1 text-xs text-stone-500 disabled:opacity-30 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  aria-label={`Remove ${photo.original_filename}`}
                  className="px-1 text-xs text-red-600 dark:text-red-400"
                >
                  ×
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === chosen.length - 1}
                  aria-label="Move later"
                  className="px-1 text-xs text-stone-500 disabled:opacity-30 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {selected.length > 1 && (
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          The first photo is the one shown in the grid.
        </p>
      )}

      {full && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          That&apos;s the maximum. Instagram&apos;s API caps carousels at{" "}
          {MAX_CAROUSEL} images — the app allows 20, but no scheduling tool can
          reach that.
        </p>
      )}

      {browsing && (
        <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
          <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
            <input
              type="checkbox"
              checked={onlyUnused}
              onChange={(event) => setOnlyUnused(event.target.checked)}
              className="accent-stone-900 dark:accent-stone-100"
            />
            Only photos I haven&apos;t used
          </label>

          {available.length === 0 ? (
            <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
              {photos.length === 0
                ? "No processed photos yet — upload some in the media bank."
                : "Nothing left matching that filter."}
            </p>
          ) : (
            <ul className="mt-3 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {available.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => add(photo.id)}
                    disabled={full}
                    title={photo.original_filename}
                    className="relative block w-full overflow-hidden rounded border border-stone-200 transition hover:border-stone-500 disabled:opacity-40 dark:border-stone-700"
                  >
                    {photo.storage_path && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl(photo.storage_path)}
                        alt={photo.alt_text ?? photo.original_filename}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    )}

                    {photo.missing_color_profile && (
                      <span
                        title="No colour profile — check before posting"
                        className="absolute left-0.5 top-0.5 rounded bg-amber-500 px-1 text-[9px] font-semibold text-amber-950"
                      >
                        !
                      </span>
                    )}

                    {(usageById.get(photo.id) ?? "unused") !== "unused" && (
                      <span className="absolute bottom-0 w-full bg-stone-900/75 text-[9px] text-white">
                        {USAGE_LABELS[usageById.get(photo.id) ?? "unused"]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
