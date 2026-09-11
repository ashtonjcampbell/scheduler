import sharp from "sharp";
import { reinterpretToSrgb, type SourceProfile } from "./colour.js";
// Shared with the app so the editor opens on exactly the box the worker cut.
import { autoCrop, type CropAspect } from "../../../src/lib/crop";

/**
 * The colour-managed conversion. This is the reason the app exists, so the
 * reasoning is written down rather than assumed.
 *
 * The "washed out on Instagram" problem is a colour-profile mismatch: a file
 * exported in a wide-gamut space (Display P3, Adobe RGB, ProPhoto) has its ICC
 * profile stripped rather than converted, so the same numbers get reinterpreted
 * as sRGB and land in the wrong place — muted and dull.
 *
 * `withIccProfile("srgb")` is a real transform, not a relabel. Verified
 * against libvips/lcms 2.17: sRGB (30,170,90) encoded to P3 stores
 * (81,168,98) and converts back to exactly (30,170,90). Gamut maths, both ways.
 *
 * Everything below happens in ONE sharp pipeline. Each decode/encode cycle
 * compounds loss, so resize and colour conversion share a single pass.
 */

/** Instagram displays at most 1440px wide; anything larger it recompresses. */
const MAX_WIDTH = 1440;

/** Instagram's hard ceiling is 8MB. Staying well under it leaves headroom. */
const TARGET_MAX_BYTES = 6 * 1024 * 1024;

/** Quality ladder, tried in order, until the file fits the size budget. */
const QUALITY_STEPS = [95, 92, 88, 84, 80] as const;

/**
 * Width of the grid thumbnail.
 *
 * The media bank draws photos at roughly 200px in a grid; 400px covers a
 * retina screen at that size and is about 20x smaller than the full file.
 */
const THUMB_WIDTH = 400;

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
  quality: number;
  /**
   * Small version for grids and pickers. Produced by the SAME colour-managed
   * conversion as the full file, so it is a faithful miniature — not a
   * browser-scaled guess. Anywhere colour is actually being judged still
   * shows the full file.
   */
  thumb: Buffer;
  thumbBytes: number;
  /** Human-readable name of the profile the ORIGINAL carried, if any. */
  sourceColorProfile: string | null;
  /**
   * True when the upload carried no ICC profile at all. sharp falls back to
   * assuming sRGB, which is usually right but occasionally very wrong — so the
   * UI flags these rather than silently trusting the guess.
   */
  missingColorProfile: boolean;
}

/** A crop expressed as fractions of the upright image, 0-1. */
export type { CropAspect };

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function processForInstagram(
  input: Buffer,
  crop?: Crop | null,
  /**
   * What the file REALLY is, when it arrived with no profile and the user has
   * said so. Overrides Sharp's sRGB assumption; see lib/colour.ts for why this
   * cannot simply be handed to Sharp.
   */
  assumeProfile?: SourceProfile | null,
  /**
   * Shape to crop to when no explicit crop is given.
   *
   * Applied HERE rather than by the caller because the box has to be measured
   * against the UPRIGHT image, and only this function knows whether EXIF says
   * the stored dimensions are turned on their side. Working it out from the
   * stored width and height would silently crop a portrait as though it were
   * a landscape.
   */
  defaultAspect?: CropAspect | null,
): Promise<ProcessedImage> {
  const metadata = await sharp(input).metadata();

  const sourceColorProfile = describeProfile(metadata.icc);
  const missingColorProfile = !metadata.icc;

  const turned = (metadata.orientation ?? 1) >= 5;
  const uprightWidth = (turned ? metadata.height : metadata.width) ?? 0;
  const uprightHeight = (turned ? metadata.width : metadata.height) ?? 0;

  // An explicit crop always wins: it is a decision someone made by hand.
  const effectiveCrop =
    crop ??
    (defaultAspect ? autoCrop(uprightWidth, uprightHeight, defaultAspect) : null);

  const extract = effectiveCrop ? toPixels(effectiveCrop, metadata) : null;

  // Reinterpreting means the embedded profile is deliberately ignored — the
  // whole point is that the file was mislabelled, or unlabelled.
  if (assumeProfile) {
    return reinterpretAndEncode(input, extract, assumeProfile, sourceColorProfile);
  }

  for (const quality of QUALITY_STEPS) {
    const pipeline = sharp(input, {
      // Honour the embedded profile. Explicit because this is the whole point.
      ignoreIcc: false,
      // Respect EXIF rotation, then drop the orientation tag, so the delivered
      // file is upright for anything that ignores EXIF.
      autoOrient: true,
    });

    // Crop first, then resize — cropping from full resolution and downscaling
    // once keeps this a single pass and loses nothing to an intermediate.
    if (extract) pipeline.extract(extract);

    const { data, info } = await pipeline
      .resize({
        width: MAX_WIDTH,
        // Never upscale: enlarging a small file invents detail and costs bytes.
        withoutEnlargement: true,
        fit: "inside",
      })
      // Converts pixel values from the embedded profile INTO sRGB and embeds
      // the sRGB profile in the output.
      .withIccProfile("srgb")
      .jpeg({
        quality,
        // No chroma subsampling: colour detail is what we are protecting.
        chromaSubsampling: "4:4:4",
        // mozjpeg buys roughly 10% smaller files at the same visual quality.
        mozjpeg: true,
        progressive: true,
      })
      .toBuffer({ resolveWithObject: true });

    if (info.size <= TARGET_MAX_BYTES || quality === QUALITY_STEPS.at(-1)) {
      return {
        data,
        width: info.width,
        height: info.height,
        bytes: info.size,
        quality,
        ...(await makeThumbnail(input, extract)),
        sourceColorProfile,
        missingColorProfile,
      };
    }
  }

  // Unreachable: the loop always returns on its final step.
  throw new Error("Image processing failed to produce an output");
}

/**
 * Convert a file whose real colour space the user has told us, then encode.
 *
 * Resizing happens BEFORE the transform, in the file's own encoding — which
 * is what Sharp would do anyway for an untagged file — so the per-pixel maths
 * runs over 1440px rather than 40 megapixels.
 */
async function reinterpretAndEncode(
  input: Buffer,
  extract: sharp.Region | null,
  profile: SourceProfile,
  sourceColorProfile: string | null,
): Promise<ProcessedImage> {
  const prepared = sharp(input, { ignoreIcc: true, autoOrient: true });
  if (extract) prepared.extract(extract);

  const { data, info } = await prepared
    .resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const corrected = reinterpretToSrgb(data, profile, info.channels);

  const encode = (quality: number) =>
    sharp(corrected, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      // The pixels ARE sRGB now, so this attaches the profile rather than
      // converting again — the transform has already happened.
      .withIccProfile("srgb")
      .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true });

  let result = await encode(QUALITY_STEPS[0]);
  for (const quality of QUALITY_STEPS.slice(1)) {
    if (result.info.size <= TARGET_MAX_BYTES) break;
    result = await encode(quality);
  }

  const thumb = await sharp(corrected, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: "inside" })
    .withIccProfile("srgb")
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    bytes: result.info.size,
    quality: 0,
    thumb,
    thumbBytes: thumb.length,
    sourceColorProfile,
    // It has been told what the file is, so it is no longer a guess.
    missingColorProfile: false,
  };
}

/**
 * The grid thumbnail.
 *
 * Made from the ORIGINAL, not from the finished JPEG. Downscaling an
 * already-compressed file bakes its artefacts into the smaller one; going back
 * to the source costs one extra decode and gives a visibly cleaner thumbnail.
 * It runs the same ICC conversion, so the colours match what the full file
 * shows rather than drifting.
 */
async function makeThumbnail(
  input: Buffer,
  extract: sharp.Region | null,
): Promise<{ thumb: Buffer; thumbBytes: number }> {
  const pipeline = sharp(input, { ignoreIcc: false, autoOrient: true });

  // The thumbnail must show the same framing as the delivered file, or the
  // grid would quietly disagree with what actually gets posted.
  if (extract) pipeline.extract(extract);

  const thumb = await pipeline
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: "inside" })
    .withIccProfile("srgb")
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return { thumb, thumbBytes: thumb.length };
}

/**
 * Turn a fractional crop into pixel coordinates.
 *
 * The trap here is EXIF orientation. `metadata()` reports the dimensions as
 * STORED, but the pipeline runs with autoOrient, so `extract` operates on the
 * UPRIGHT image. For a photo shot in portrait — orientation 6 or 8, which is
 * most phone portraits — stored width and height are swapped relative to what
 * the user framed their crop against. Using the raw metadata numbers would
 * crop a rotated rectangle out of the wrong part of the image: not an error,
 * just silently the wrong picture.
 */
function toPixels(
  crop: Crop,
  metadata: sharp.Metadata,
): sharp.Region {
  // Orientations 5-8 involve a 90° turn, so the upright image has the stored
  // dimensions swapped.
  const turned = (metadata.orientation ?? 1) >= 5;

  const width = (turned ? metadata.height : metadata.width) ?? 0;
  const height = (turned ? metadata.width : metadata.height) ?? 0;

  // Round inward so rounding can never ask for a pixel outside the image,
  // which sharp rejects outright.
  const left = Math.max(0, Math.round(crop.x * width));
  const top = Math.max(0, Math.round(crop.y * height));

  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(crop.w * width), width - left)),
    height: Math.max(1, Math.min(Math.round(crop.h * height), height - top)),
  };
}

/**
 * Pull the human-readable description out of an ICC profile.
 *
 * ICC profiles are a header followed by a tag table. This walks the table
 * looking for the 'desc' tag rather than scanning for the bytes, because a
 * naive search finds the string inside the copyright tag just as often.
 */
export function describeProfile(icc: Buffer | undefined): string | null {
  if (!icc || icc.length < 132) return null;

  try {
    const tagCount = icc.readUInt32BE(128);
    // A sane profile has a handful of tags; a wild number means we are not
    // looking at a tag table and should stop rather than read garbage.
    if (tagCount === 0 || tagCount > 100) return null;

    for (let i = 0; i < tagCount; i++) {
      const entry = 132 + i * 12;
      if (entry + 12 > icc.length) break;

      if (icc.toString("ascii", entry, entry + 4) !== "desc") continue;

      const offset = icc.readUInt32BE(entry + 4);
      const size = icc.readUInt32BE(entry + 8);
      if (offset + size > icc.length) break;

      return readDescription(icc.subarray(offset, offset + size));
    }
  } catch {
    // A malformed profile is not a reason to fail the upload; the caller
    // treats "unknown" the same as any other named profile.
  }

  return null;
}

function readDescription(tag: Buffer): string | null {
  const type = tag.toString("ascii", 0, 4);

  // ICC v2 'desc' tag: type, reserved, ASCII length, then the string.
  if (type === "desc" && tag.length >= 12) {
    const length = tag.readUInt32BE(8);
    return clean(tag.toString("latin1", 12, 12 + Math.max(0, length - 1)));
  }

  // ICC v4 'mluc' tag: a table of localised strings. The first record is good
  // enough for a label.
  //
  // The strings are UTF-16 BIG-endian and Node only decodes little-endian, so
  // the bytes must be swapped first. Decoding without swapping does not fail
  // — it silently yields plausible-looking CJK ("sRGB" reads as 猀刀䜀䈀), which
  // is exactly the kind of bug that reaches the UI unnoticed.
  if (type === "mluc" && tag.length >= 28) {
    const length = tag.readUInt32BE(20);
    const offset = tag.readUInt32BE(24);
    if (offset + length > tag.length) return null;

    // swap16 needs an even number of bytes, and mutates in place — so copy.
    const utf16be = Buffer.from(tag.subarray(offset, offset + (length & ~1)));
    return clean(utf16be.swap16().toString("utf16le"));
  }

  return null;
}

function clean(value: string): string | null {
  const trimmed = value.replace(/\0/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
