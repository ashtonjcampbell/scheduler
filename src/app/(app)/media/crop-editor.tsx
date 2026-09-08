"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Photo } from "@/lib/database.types";
import { photoUrl } from "@/lib/photos";
import { setCrop, type CropInput } from "./crop-actions";

/**
 * Instagram's accepted shapes.
 *
 * Anything outside 4:5 to 1.91:1 gets cropped by Instagram itself, from the
 * centre, without asking. Offering the three shapes it actually supports is
 * the difference between choosing the framing and having it chosen for you.
 */
const ASPECTS = [
  { key: "4:5", label: "Portrait 4:5", ratio: 4 / 5, note: "Tallest Instagram allows" },
  { key: "1:1", label: "Square 1:1", ratio: 1, note: "Classic grid" },
  { key: "1.91:1", label: "Landscape 1.91:1", ratio: 1.91, note: "Widest Instagram allows" },
  { key: "free", label: "Free", ratio: null, note: "Instagram may crop this itself" },
] as const;

export function CropEditor({
  photo,
  onClose,
}: {
  photo: Photo;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [aspectKey, setAspectKey] = useState<string>(photo.crop_aspect ?? "4:5");

  // The visible dimensions of the photo as delivered — the crop is expressed
  // as fractions of it, so the editor needs its shape to lay the box out.
  const imageRatio = photo.width && photo.height ? photo.width / photo.height : 1;

  const [box, setBox] = useState(() =>
    photo.crop_x !== null && photo.crop_y !== null && photo.crop_w !== null && photo.crop_h !== null
      ? { x: photo.crop_x, y: photo.crop_y, w: photo.crop_w, h: photo.crop_h }
      : largestFit(imageRatio, ASPECTS.find((a) => a.key === (photo.crop_aspect ?? "4:5"))?.ratio ?? 4 / 5),
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const chooseAspect = (key: string) => {
    setAspectKey(key);
    const next = ASPECTS.find((a) => a.key === key);
    setBox(next?.ratio ? largestFit(imageRatio, next.ratio) : { x: 0, y: 0, w: 1, h: 1 });
  };

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        startX: event.clientX,
        startY: event.clientY,
        origX: box.x,
        origY: box.y,
      };
    },
    [box.x, box.y],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag.current || !frameRef.current) return;

      const rect = frameRef.current.getBoundingClientRect();
      const dx = (event.clientX - drag.current.startX) / rect.width;
      const dy = (event.clientY - drag.current.startY) / rect.height;

      setBox((prev) => ({
        ...prev,
        // Clamped so the box can never leave the photo — which the database
        // would reject anyway, but silently snapping is friendlier than an error.
        x: clamp(drag.current!.origX + dx, 0, 1 - prev.w),
        y: clamp(drag.current!.origY + dy, 0, 1 - prev.h),
      }));
    },
    [],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const payload: CropInput | null =
        box.x === 0 && box.y === 0 && box.w === 1 && box.h === 1 && aspectKey === "free"
          ? null
          : { ...box, aspect: aspectKey === "free" ? null : aspectKey };

      const result = await setCrop(photo.id, payload);
      if (result.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const resultingSize = useMemo(() => {
    if (!photo.width || !photo.height) return null;
    return {
      w: Math.round(photo.width * box.w),
      h: Math.round(photo.height * box.h),
    };
  }, [photo.width, photo.height, box.w, box.h]);

  const original = photo.storage_path ? photoUrl(photo.storage_path) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 p-4">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Crop {photo.original_filename}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {ASPECTS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => chooseAspect(option.key)}
              title={option.note}
              className={
                aspectKey === option.key
                  ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                  : "rounded-md border border-stone-300 px-2.5 py-1 text-xs dark:border-stone-700"
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {original && (
          <div
            ref={frameRef}
            className="relative mt-3 select-none overflow-hidden rounded bg-stone-950"
            style={{ aspectRatio: String(imageRatio) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={original} alt="" className="h-full w-full object-contain opacity-40" />

            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute cursor-move overflow-hidden border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            >
              {/* The kept region at full brightness, so the framing reads clearly. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={original}
                alt=""
                className="pointer-events-none absolute max-w-none"
                style={{
                  width: `${100 / box.w}%`,
                  height: `${100 / box.h}%`,
                  left: `${(-box.x / box.w) * 100}%`,
                  top: `${(-box.y / box.h) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Drag to reposition.{" "}
          {resultingSize && (
            <>
              Result: {resultingSize.w}×{resultingSize.h}.{" "}
            </>
          )}
          {aspectKey === "free"
            ? "A free crop outside 4:5–1.91:1 will be cropped again by Instagram."
            : "Instagram will publish this shape untouched."}
        </p>

        {photo.original_removed_at && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The original has been deleted, so this photo can no longer be
            re-cropped. Upload it again to change the framing.
          </p>
        )}

        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending || !!photo.original_removed_at}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          >
            {pending ? "Saving…" : "Crop and reprocess"}
          </button>

          {photo.crop_aspect && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await setCrop(photo.id, null);
                  if (result.error) setError(result.error);
                  else {
                    router.refresh();
                    onClose();
                  }
                });
              }}
              className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              Remove crop
            </button>
          )}

          <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
            Re-run from your original — no extra compression
          </span>
        </div>
      </div>
    </div>
  );
}

/** The biggest box of the target ratio that fits inside the image. */
function largestFit(imageRatio: number, targetRatio: number) {
  if (targetRatio >= imageRatio) {
    // Limited by width: full width, shorter height.
    const h = imageRatio / targetRatio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }

  // Limited by height: full height, narrower width.
  const w = targetRatio / imageRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
