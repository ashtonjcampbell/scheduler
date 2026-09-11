/**
 * Whether Instagram will publish these photos as they are, or reshape them.
 *
 * This exists because it did not, once, and a carousel of ten good photographs
 * went out ruined. The files were fine — 1440px, sharp, correctly encoded. What
 * happened was two rules of Instagram's meeting each other:
 *
 *   1. A CAROUSEL IS ONE SHAPE. Instagram takes the aspect ratio of the FIRST
 *      image and crops every other image to match. Mix a portrait and a
 *      landscape and it will centre-crop the landscapes without asking.
 *
 *   2. THAT SHAPE MUST BE BETWEEN 4:5 AND 1.91:1. Anything taller or wider is
 *      cropped too — including the first image, so "it follows the first one"
 *      is not even a safe way to control it.
 *
 * The damage is not just the framing. Cropping a 1440x960 landscape to 4:5
 * leaves 768 pixels of width, which Instagram then UPSCALES to the 1080 it
 * displays at. That is where "why is it blurry" comes from, and no amount of
 * care in the colour pipeline survives it.
 *
 * So the app checks before publishing rather than discovering afterwards.
 */

/** Tallest Instagram will keep: 4:5 portrait. */
export const MIN_RATIO = 4 / 5;

/** Widest Instagram will keep: 1.91:1 landscape. */
export const MAX_RATIO = 1.91;

/**
 * How close two ratios must be to count as the same shape.
 *
 * Rounding through integer pixel dimensions means two photos cropped to the
 * same ratio rarely divide to exactly the same number — 1440/1800 and
 * 1439/1799 are the same intent. A whole percent is far tighter than anything
 * Instagram would visibly crop.
 */
const TOLERANCE = 0.01;

export type PhotoShape = {
  id: string;
  width: number | null;
  height: number | null;
  /**
   * Finished processing.
   *
   * A photo being re-cropped still carries the dimensions it had BEFORE the
   * crop, which are about to be wrong. Judging the carousel on those would
   * bless a post that is about to change shape underneath it.
   */
  ready: boolean;
};

export type ShapeVerdict =
  | { ok: true }
  | { ok: false; kind: "mixed"; ratios: number[] }
  | { ok: false; kind: "out-of-range"; ratio: number; tallest: boolean }
  | { ok: false; kind: "unknown" };

export function carouselShape(photos: readonly PhotoShape[]): ShapeVerdict {
  const measured = photos
    .map((p) => (p.width && p.height ? p.width / p.height : null))
    .filter((r): r is number => r !== null && Number.isFinite(r) && r > 0);

  if (photos.some((p) => !p.ready)) return { ok: false, kind: "unknown" };

  if (measured.length === 0) return { ok: true };

  // A photo still processing has no dimensions yet; better to say so than to
  // pass a carousel whose shape is not actually known.
  if (measured.length !== photos.length) return { ok: false, kind: "unknown" };

  const first = measured[0]!;

  if (measured.some((r) => Math.abs(r - first) > TOLERANCE)) {
    return { ok: false, kind: "mixed", ratios: measured };
  }

  // Every photo shares the first one's shape by now, so one check covers all.
  if (first < MIN_RATIO - TOLERANCE) {
    return { ok: false, kind: "out-of-range", ratio: first, tallest: true };
  }

  if (first > MAX_RATIO + TOLERANCE) {
    return { ok: false, kind: "out-of-range", ratio: first, tallest: false };
  }

  return { ok: true };
}

/** Plain English for the composer, saying what Instagram will do about it. */
export function describeShape(verdict: ShapeVerdict): string | null {
  if (verdict.ok) return null;

  switch (verdict.kind) {
    case "unknown":
      return "Some photos are still processing, so their shape is not known yet.";

    case "mixed":
      return (
        "These photos are not all the same shape. Instagram crops a carousel to " +
        "match its first image, so the others would be cut down — and a landscape " +
        "squeezed into a portrait loses so much width that Instagram scales it " +
        "back up, which is what makes a post look blurry. Crop them to one shape."
      );

    case "out-of-range":
      return verdict.tallest
        ? `This is taller than 4:5, which is the tallest Instagram keeps. It would be cropped from the centre without asking. Crop it to 4:5.`
        : `This is wider than 1.91:1, which is the widest Instagram keeps. It would be cropped from the centre without asking. Crop it to 1.91:1.`;
  }
}

export const SHAPE_HELP =
  "Instagram publishes a carousel as one shape, taken from the first image, and only between 4:5 and 1.91:1.";
