/**
 * Reinterpreting a file whose colour profile was missing.
 *
 * When an upload carries no ICC profile, Sharp assumes sRGB. That is usually
 * right — and when it is wrong (an Adobe RGB export that lost its tag) the
 * photo looks flat and undersaturated, which is the very problem this app
 * exists to fix.
 *
 * Sharp cannot help here: it converts FROM an embedded profile, and has no way
 * to reinterpret one that is absent. Splicing a profile into the file works
 * but is format-specific — an APP2 marker for JPEG, an iCCP chunk for PNG, and
 * so on. Doing the transform directly is format-independent, and can be
 * checked against Sharp's own conversion, which is the reason for that choice.
 *
 * Nothing here guesses. It applies the interpretation the user has stated.
 */

export type SourceProfile = "srgb" | "p3" | "adobe-rgb";

/**
 * RGB to XYZ, D65 white point, for each space we can be told a file really is.
 * Standard published values, not derived here.
 */
const TO_XYZ: Record<SourceProfile, number[][]> = {
  srgb: [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.715152, 0.072175],
    [0.0193339, 0.119192, 0.9503041],
  ],
  p3: [
    [0.4865709, 0.2656677, 0.1982173],
    [0.2289746, 0.6917385, 0.0792869],
    [0.0, 0.0451134, 1.0439444],
  ],
  "adobe-rgb": [
    [0.5767309, 0.185554, 0.1881852],
    [0.2973769, 0.6273491, 0.0752741],
    [0.0270343, 0.0706872, 0.9911085],
  ],
};

/** XYZ back to sRGB, D65. */
const XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

/** sRGB and Display P3 share the same piecewise transfer function. */
function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** Adobe RGB (1998) uses a plain gamma of 563/256. */
const ADOBE_GAMMA = 563 / 256;

function decode(value: number, profile: SourceProfile): number {
  return profile === "adobe-rgb" ? Math.pow(value, ADOBE_GAMMA) : srgbToLinear(value);
}

/**
 * Convert pixels that are really `profile` into sRGB.
 *
 * `pixels` is raw 8-bit RGB as stored in the file — read with Sharp's
 * `ignoreIcc` so nothing has already reinterpreted them.
 *
 * Out-of-gamut colours are clipped, which is what a relative-colorimetric
 * conversion does at the gamut boundary and matches Sharp's own behaviour.
 */
export function reinterpretToSrgb(
  pixels: Buffer,
  profile: SourceProfile,
  channels = 3,
): Buffer {
  if (profile === "srgb") return Buffer.from(pixels);

  const matrix = TO_XYZ[profile];
  const out = Buffer.from(pixels);

  for (let i = 0; i + channels - 1 < pixels.length; i += channels) {
    const r = decode(pixels[i]! / 255, profile);
    const g = decode(pixels[i + 1]! / 255, profile);
    const b = decode(pixels[i + 2]! / 255, profile);

    const x = matrix[0]![0]! * r + matrix[0]![1]! * g + matrix[0]![2]! * b;
    const y = matrix[1]![0]! * r + matrix[1]![1]! * g + matrix[1]![2]! * b;
    const z = matrix[2]![0]! * r + matrix[2]![1]! * g + matrix[2]![2]! * b;

    const lr = XYZ_TO_SRGB[0]![0]! * x + XYZ_TO_SRGB[0]![1]! * y + XYZ_TO_SRGB[0]![2]! * z;
    const lg = XYZ_TO_SRGB[1]![0]! * x + XYZ_TO_SRGB[1]![1]! * y + XYZ_TO_SRGB[1]![2]! * z;
    const lb = XYZ_TO_SRGB[2]![0]! * x + XYZ_TO_SRGB[2]![1]! * y + XYZ_TO_SRGB[2]![2]! * z;

    out[i] = clamp8(linearToSrgb(clamp01(lr)) * 255);
    out[i + 1] = clamp8(linearToSrgb(clamp01(lg)) * 255);
    out[i + 2] = clamp8(linearToSrgb(clamp01(lb)) * 255);
    // Any alpha channel passes through untouched.
  }

  return out;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp8(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

export const PROFILE_LABELS: Record<SourceProfile, string> = {
  srgb: "sRGB",
  p3: "Display P3",
  "adobe-rgb": "Adobe RGB (1998)",
};
