/**
 * Working out a crop box, shared by the editor and the worker.
 *
 * Both need the same answer to "where does a 4:5 crop sit on this photo": the
 * worker to apply one automatically on upload, the editor to open on the box
 * that was actually applied. Two implementations would drift, and the drift
 * would show as a photo that moves the first time you open the cropper.
 *
 * Boxes are fractions of the image (0–1), never pixels, so they survive the
 * resize that happens after the crop and mean the same thing against the
 * original as against the delivered file.
 */

/** The shapes Instagram keeps, by the name the editor shows. */
export const CROP_RATIOS = {
  "4:5": 4 / 5,
  "1:1": 1,
  "1.91:1": 1.91,
} as const;

export type CropAspect = keyof typeof CROP_RATIOS;

export function isCropAspect(value: string | null | undefined): value is CropAspect {
  return value !== null && value !== undefined && value in CROP_RATIOS;
}

export type CropBox = { x: number; y: number; w: number; h: number };

/**
 * The biggest box of the target shape that fits, centred.
 *
 * Centred because it is a starting point, not a decision — the subject of a
 * photograph is usually near the middle, and anything cleverer would be
 * guessing at a composition the photographer already made.
 */
export function largestFit(imageRatio: number, targetRatio: number): CropBox {
  if (targetRatio >= imageRatio) {
    // Limited by width: full width, shorter height.
    const h = imageRatio / targetRatio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }

  // Limited by height: full height, narrower width.
  const w = targetRatio / imageRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/**
 * The crop to apply to a freshly uploaded photo, or null to leave it alone.
 *
 * Returns null when the photo is ALREADY the target shape, so an image that
 * needs no cropping is not recorded as cropped — the difference matters when
 * deciding whether the owner has made a choice about this photo or not.
 */
export function autoCrop(
  width: number,
  height: number,
  aspect: CropAspect,
): CropBox | null {
  if (!(width > 0) || !(height > 0)) return null;

  const target = CROP_RATIOS[aspect];
  const actual = width / height;

  // Within a percent is the same shape; cropping it would only shave pixels
  // off a photo that already fits.
  if (Math.abs(actual - target) <= 0.01) return null;

  return largestFit(actual, target);
}
