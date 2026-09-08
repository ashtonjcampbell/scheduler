import sharp from "sharp";
import { processForInstagram, describeProfile } from "./lib/image.js";
import { reinterpretToSrgb } from "./lib/colour.js";

/**
 * Proves the colour pipeline still does what it claims. Run it after any
 * change to `lib/image.ts`:
 *
 *   npm run verify-pipeline
 *
 * The point of these checks is not that the code runs, but that it performs a
 * REAL gamut conversion. A strip-and-relabel would pass a "does it produce a
 * JPEG" test and fail every assertion here about pixel values.
 */

let failures = 0;

function check(label: string, passed: boolean, detail = "") {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures++;
}

/** Read a file's stored pixels without letting Sharp convert them on the way in. */
async function storedPixel(buffer: Buffer): Promise<[number, number, number]> {
  const raw = await sharp(buffer, { ignoreIcc: true }).raw().toBuffer();
  return [raw[0]!, raw[1]!, raw[2]!];
}

/** A colourful test image, optionally tagged with a wide-gamut profile. */
async function testImage(profile: "p3" | "srgb" | null, width = 3000) {
  const pipeline = sharp({
    create: {
      width,
      height: Math.round(width * 0.667),
      channels: 3,
      background: { r: 30, g: 170, b: 90 },
    },
  }).png();

  return profile ? pipeline.withIccProfile(profile).toBuffer() : pipeline.toBuffer();
}

async function main() {
  console.log("\nColour conversion is a real transform, not a relabel");

  // A file tagged P3 holds different numbers than the same colour in sRGB.
  // Converting it must move those numbers back.
  const p3 = await testImage("p3", 64);
  const p3Pixel = await storedPixel(p3);
  const converted = await processForInstagram(p3);
  const convertedPixel = await storedPixel(converted.data);

  check(
    "a P3 file stores different numbers than sRGB",
    p3Pixel[0] !== 30 || p3Pixel[1] !== 170 || p3Pixel[2] !== 90,
    `P3 holds ${p3Pixel.join(",")}`,
  );

  // JPEG is lossy, so allow a couple of levels of slack.
  const near = (a: number, b: number) => Math.abs(a - b) <= 3;
  check(
    "converting it lands back on the sRGB colour",
    near(convertedPixel[0], 30) && near(convertedPixel[1], 170) && near(convertedPixel[2], 90),
    `got ${convertedPixel.join(",")}, expected ~30,170,90`,
  );

  console.log("\nOutput meets Instagram's ceiling");

  const large = await processForInstagram(await testImage("srgb", 3000));
  check("resized to at most 1440px wide", large.width <= 1440, `${large.width}px`);
  check("comfortably under the 8MB limit", large.bytes < 8 * 1024 * 1024,
    `${(large.bytes / 1024 / 1024).toFixed(2)}MB`);

  const outputMeta = await sharp(large.data).metadata();
  check("an ICC profile is embedded in the output", Boolean(outputMeta.icc));
  check("the output is JPEG", outputMeta.format === "jpeg", String(outputMeta.format));

  console.log("\nSmall images are not upscaled");

  const small = await processForInstagram(await testImage("srgb", 800));
  check("an 800px file stays 800px", small.width === 800, `${small.width}px`);

  console.log("\nMissing profiles are flagged, not guessed");

  const untagged = await processForInstagram(await testImage(null, 64));
  check("a file with no profile is flagged", untagged.missingColorProfile);
  check("its source profile is reported as unknown", untagged.sourceColorProfile === null);

  const tagged = await processForInstagram(await testImage("p3", 64));
  check("a tagged file is not flagged", !tagged.missingColorProfile);
  // Must be readable text. Decoding the big-endian name without swapping the
  // bytes yields plausible-looking CJK rather than an error, so assert the
  // characters are printable ASCII — a length check would not catch it.
  check(
    "its source profile is named in readable text",
    typeof tagged.sourceColorProfile === "string" &&
      /^[ -~]+$/.test(tagged.sourceColorProfile),
    tagged.sourceColorProfile ?? "null",
  );

  console.log("\nProfile names are read from the tag table");

  const srgbProfile = (await sharp(await testImage("srgb", 8)).metadata()).icc;
  const srgbName = describeProfile(srgbProfile);
  check(
    "the sRGB profile is named readably",
    typeof srgbName === "string" && /srgb/i.test(srgbName),
    srgbName ?? "null",
  );
  check("garbage input does not throw", describeProfile(Buffer.alloc(200)) === null);
  check("an empty buffer does not throw", describeProfile(undefined) === null);

  console.log("\nCropping");
  {
    // 3:2 landscape, 1200x800.
    const wide = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 170, b: 90 } },
    }).withIccProfile("srgb").jpeg().toBuffer();

    // Square out of 1200x800 means taking 800 of the 1200 width: 2/3, centred.
    const square = await processForInstagram(wide, { x: 1 / 6, y: 0, w: 2 / 3, h: 1 });
    check("a 1:1 crop comes out square", square.width === square.height,
      `${square.width}x${square.height}`);

    // 4:5 at full height means 640 of the 1200 width.
    const portrait = await processForInstagram(wide, { x: 7 / 30, y: 0, w: 8 / 15, h: 1 });
    const ratio = portrait.width / portrait.height;
    check("a 4:5 crop comes out 4:5", Math.abs(ratio - 0.8) < 0.01, ratio.toFixed(3));

    check("the thumbnail is cropped to match",
      await (async () => {
        const m = await sharp(square.thumb).metadata();
        return Math.abs((m.width ?? 0) / (m.height ?? 1) - 1) < 0.02;
      })(),
      "thumbnail aspect must match the full file");

    const uncropped = await processForInstagram(wide);
    check("no crop leaves the shape alone",
      Math.abs(uncropped.width / uncropped.height - 1.5) < 0.01,
      (uncropped.width / uncropped.height).toFixed(3));

    // A crop that rounds past the edge must clamp, not throw.
    const edge = await processForInstagram(wide, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    check("a crop flush to the edge does not throw", edge.width > 0);
  }

  console.log("\nCropping a photo the camera stored sideways");
  {
    /*
     * The case that silently produces the wrong picture. A phone held in
     * portrait usually stores the pixels landscape plus an EXIF orientation
     * tag. metadata() reports the STORED size, but the pipeline crops the
     * UPRIGHT image — so using the raw metadata numbers cuts the rectangle
     * out of the wrong place. No error, just the wrong photo.
     */
    const stored = await sharp({
      // Stored landscape: 1200 wide, 800 tall.
      create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 170, b: 90 } },
    })
      .withMetadata({ orientation: 6 }) // "rotate 90° clockwise to view"
      .withIccProfile("srgb")
      .jpeg()
      .toBuffer();

    const meta = await sharp(stored).metadata();
    check("the test file really is marked sideways", meta.orientation === 6,
      `orientation ${meta.orientation}`);

    // Upright it is 800x1200. Taking the top half should give 800x600.
    const topHalf = await processForInstagram(stored, { x: 0, y: 0, w: 1, h: 0.5 });
    const ratio = topHalf.width / topHalf.height;
    check("the crop is measured against the upright image", Math.abs(ratio - 800 / 600) < 0.02,
      `got ${topHalf.width}x${topHalf.height}, expected 4:3`);
  }

  console.log("\nReinterpreting a file whose profile was missing");
  {
    const untagged = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 170, b: 90 } },
    }).jpeg({ quality: 100 }).toBuffer();

    const assumed = await processForInstagram(untagged);
    const asAdobe = await processForInstagram(untagged, null, "adobe-rgb");

    const assumedPx = await storedPixel(assumed.data);
    const adobePx = await storedPixel(asAdobe.data);

    check("assuming sRGB leaves the numbers alone",
      Math.abs(assumedPx[0] - 30) <= 3 && Math.abs(assumedPx[1] - 170) <= 3,
      assumedPx.join(","));

    check("reinterpreting as Adobe RGB actually moves them",
      Math.abs(adobePx[0] - assumedPx[0]) > 5,
      assumedPx.join(",") + " -> " + adobePx.join(","));

    check("the reinterpreted file still carries an sRGB profile",
      Boolean((await sharp(asAdobe.data).metadata()).icc));

    check("it is no longer reported as a guess", asAdobe.missingColorProfile === false);

    // Neutrals must survive any of these transforms untouched, or every
    // grey in the photo picks up a colour cast.
    for (const profile of ["p3", "adobe-rgb"] as const) {
      const grey = reinterpretToSrgb(Buffer.from([128, 128, 128]), profile);
      check(`mid grey stays neutral through ${profile}`,
        Math.max(...[0, 1, 2].map((i) => Math.abs(grey[i]! - 128))) <= 2,
        grey.join(","));
    }
  }

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );

  if (failures > 0) process.exit(1);
}

await main();
