import sharp from "sharp";
import { processForInstagram, describeProfile } from "./lib/image.js";

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

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );

  if (failures > 0) process.exit(1);
}

await main();
