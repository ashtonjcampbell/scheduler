"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Photo } from "@/lib/database.types";

import { setCrop, originalPhotoUrl, type CropInput } from "./crop-actions";

/**
 * Instagram's accepted shapes.
 *
 * Anything outside 4:5 to 1.91:1 gets cropped by Instagram itself, from the
 * centre, without asking. Offering the three shapes it actually supports is
 * the difference between choosing the framing and having it chosen for you.
 */
/** What the pipeline delivers at, so the result can be stated honestly. */
const MAX_DELIVERED_WIDTH = 1440;

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

  /*
   * The ORIGINAL, not the delivered file.
   *
   * The stored crop is fractions of the original, so the box only lines up
   * when it is drawn over the original. Using the delivered file looks fine
   * until a photo has been cropped once — after that a 4:5 crop reopens as a
   * box covering five sixths of an image that is already 4:5, which is not a
   * crop anyone asked for and compounds every time it is saved.
   *
   * Its shape is measured from the file itself as it loads, so nothing has to
   * be recorded or kept in step.
   */
  const [source, setSource] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);
  const sourceRatio = sourceSize ? sourceSize.w / sourceSize.h : null;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void originalPhotoUrl(photo.id).then((result) => {
      if (cancelled) return;
      if (result.error) setLoadError(result.error);
      else setSource(result.url ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  const imageRatio = sourceRatio ?? (photo.width && photo.height ? photo.width / photo.height : 1);

  const [box, setBox] = useState(() =>
    photo.crop_x !== null && photo.crop_y !== null && photo.crop_w !== null && photo.crop_h !== null
      ? { x: photo.crop_x, y: photo.crop_y, w: photo.crop_w, h: photo.crop_h }
      : largestFit(imageRatio, ASPECTS.find((a) => a.key === (photo.crop_aspect ?? "4:5"))?.ratio ?? 4 / 5),
  );

  const frameRef = useRef<HTMLDivElement>(null);

  /** Which corner is being pulled, or "move" when the whole box is sliding. */
  type Handle = "move" | "nw" | "ne" | "sw" | "se";

  const drag = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    orig: Box;
  } | null>(null);

  const ratio = ASPECTS.find((a) => a.key === aspectKey)?.ratio ?? null;

  const chooseAspect = (key: string) => {
    setAspectKey(key);
    const next = ASPECTS.find((a) => a.key === key);
    setBox(next?.ratio ? largestFit(imageRatio, next.ratio) : { x: 0, y: 0, w: 1, h: 1 });
  };

  const onPointerDown = useCallback(
    (handle: Handle) => (event: React.PointerEvent) => {
      // A corner sits on top of the box; without this the box would start
      // sliding at the same time as the corner resizes.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { handle, startX: event.clientX, startY: event.clientY, orig: box };
    },
    [box],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag.current || !frameRef.current) return;

      const rect = frameRef.current.getBoundingClientRect();
      const dx = (event.clientX - drag.current.startX) / rect.width;
      const dy = (event.clientY - drag.current.startY) / rect.height;
      const { handle, orig } = drag.current;

      if (handle === "move") {
        setBox((prev) => ({
          ...prev,
          // Clamped so the box can never leave the photo — which the database
          // would reject anyway, but silently snapping is friendlier than an error.
          x: clamp(orig.x + dx, 0, 1 - prev.w),
          y: clamp(orig.y + dy, 0, 1 - prev.h),
        }));
        return;
      }

      setBox(resize(orig, handle, dx, dy, ratio, imageRatio));
    },
    [ratio, imageRatio],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  // Nudging with the keyboard is the only way to place a crop exactly, and the
  // only way to place one at all without a mouse.
  const nudge = useCallback(
    (dx: number, dy: number) => {
      setBox((prev) => ({
        ...prev,
        x: clamp(prev.x + dx, 0, 1 - prev.w),
        y: clamp(prev.y + dy, 0, 1 - prev.h),
      }));
    },
    [],
  );

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

  /*
   * What the delivered file will be, measured from the ORIGINAL.
   *
   * The crop is cut from the full-resolution source and then resized down to
   * the delivery width, so a crop taken from a 6000px original is still
   * delivered at full width — the numbers here have to come from the source,
   * not from the file this replaces.
   */
  const resultingSize = useMemo(() => {
    if (!sourceSize) return null;

    const w = Math.round(sourceSize.w * box.w);
    const h = Math.round(sourceSize.h * box.h);

    if (w <= MAX_DELIVERED_WIDTH) return { w, h, upscaled: false };

    return {
      w: MAX_DELIVERED_WIDTH,
      h: Math.round((h / w) * MAX_DELIVERED_WIDTH),
      upscaled: false,
    };
  }, [sourceSize, box.w, box.h]);

  const original = source;

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

        {!original && (
          <p className="mt-3 rounded border border-stone-200 px-3 py-6 text-center text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
            {loadError ?? "Opening the original…"}
          </p>
        )}

        {original && (
          <div
            ref={frameRef}
            className="relative mt-3 select-none overflow-hidden rounded bg-stone-950"
            style={{ aspectRatio: String(imageRatio) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={original}
              alt=""
              onLoad={(event) =>
                setSourceSize({
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                })
              }
              className="h-full w-full object-contain opacity-40"
            />

            <div
              onPointerDown={onPointerDown("move")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={(event) => {
                // Shift for a coarse move, otherwise a fraction of a percent —
                // fine enough to place an edge exactly.
                const step = event.shiftKey ? 0.02 : 0.002;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const move = moves[event.key];
                if (!move) return;
                event.preventDefault();
                nudge(move[0], move[1]);
              }}
              tabIndex={0}
              role="application"
              aria-label="Crop area. Arrow keys move it; hold shift to move further."
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] outline-none focus-visible:border-sky-400"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            >
              {/* The kept region at full brightness, so the framing reads clearly. */}
              <div className="absolute inset-0 overflow-hidden">
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

              {/* Thirds, for placing a horizon or a subject deliberately. */}
              <div className="pointer-events-none absolute inset-0 opacity-40">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white" />
              </div>

              {/* Corners sit half outside the box so they stay grabbable even
                  when the crop is pushed against the edge of the photo. */}
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <span
                  key={corner}
                  onPointerDown={onPointerDown(corner)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className={`absolute h-4 w-4 rounded-full border-2 border-stone-900 bg-white ${
                    corner === "nw"
                      ? "-left-2 -top-2 cursor-nwse-resize"
                      : corner === "ne"
                        ? "-right-2 -top-2 cursor-nesw-resize"
                        : corner === "sw"
                          ? "-bottom-2 -left-2 cursor-nesw-resize"
                          : "-bottom-2 -right-2 cursor-nwse-resize"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Drag inside to move, corners to resize, arrow keys to nudge.{" "}
          {resultingSize && (
            <>
              Result: <span className="tabular-nums">{resultingSize.w}×{resultingSize.h}</span>
              {sourceSize && (
                <>
                  {" "}
                  — <span className="tabular-nums">{Math.round(box.w * 100)}%</span> of the
                  original&rsquo;s width, from{" "}
                  <span className="tabular-nums">{Math.round(box.x * sourceSize.w)}px</span>,{" "}
                  <span className="tabular-nums">{Math.round(box.y * sourceSize.h)}px</span>
                </>
              )}
              .{" "}
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

type Box = { x: number; y: number; w: number; h: number };

/** Nothing smaller, as a fraction of the image — below this the box is unusable. */
const MIN_SIZE = 0.08;

/**
 * Pull a corner.
 *
 * The opposite corner is the anchor and does not move, which is what makes
 * dragging feel like resizing rather than sliding.
 *
 * The subtlety is the aspect lock. The crop is stored as fractions of the
 * image, so a 4:5 crop is only 0.8 in fraction-space when the image itself is
 * square — on a 3:2 photo the same shape is a different pair of numbers. Width
 * therefore leads and height is derived through the image's own ratio; doing it
 * in fraction-space directly quietly produces a crop that is not 4:5 at all.
 */
function resize(
  orig: Box,
  handle: "nw" | "ne" | "sw" | "se",
  dx: number,
  dy: number,
  ratio: number | null,
  imageRatio: number,
): Box {
  const west = handle === "nw" || handle === "sw";
  const north = handle === "nw" || handle === "ne";

  // The corner that stays put.
  const anchorX = west ? orig.x + orig.w : orig.x;
  const anchorY = north ? orig.y + orig.h : orig.y;

  const availableW = west ? anchorX : 1 - anchorX;
  const availableH = north ? anchorY : 1 - anchorY;

  /*
   * Floor these BEFORE anything else. Drag a corner past the opposite one and
   * the raw width goes negative; carried into the ratio maths it comes back
   * through a division as a plausible-looking positive, and the crop jumps
   * somewhere nobody asked for.
   */
  let w = Math.max(MIN_SIZE, west ? orig.w - dx : orig.w + dx);
  let h = Math.max(MIN_SIZE, north ? orig.h - dy : orig.h + dy);

  if (ratio === null) {
    w = clamp(w, MIN_SIZE, availableW);
    h = clamp(h, MIN_SIZE, availableH);
  } else {
    // Follow whichever direction the pointer moved further, so a diagonal drag
    // does not fight itself.
    if (Math.abs(dx) >= Math.abs(dy)) h = (w * imageRatio) / ratio;
    else w = (h * ratio) / imageRatio;

    /*
     * Every limit from here is applied as a UNIFORM scale of both sides.
     * Clamping width and height separately is the obvious way to write this
     * and it silently breaks the ratio at the extremes — squeeze a 1.91:1 crop
     * into the corner and a per-side minimum turns it into 1.25:1, which then
     * gets cropped again by Instagram. Scaling keeps the shape exact.
     */
    const grow = Math.max(MIN_SIZE / w, MIN_SIZE / h, 1);
    w *= grow;
    h *= grow;

    const shrink = Math.min(availableW / w, availableH / h, 1);
    w *= shrink;
    h *= shrink;
  }

  return {
    x: west ? anchorX - w : anchorX,
    y: north ? anchorY - h : anchorY,
    w,
    h,
  };
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
