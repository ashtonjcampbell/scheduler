/**
 * Checks the guard that should have stopped a ruined carousel going out.
 *
 * The case that matters is the one that actually happened: ten sharp photos,
 * two different shapes, published without a word. Everything here is built
 * around never letting that pass again.
 */

import { carouselShape, describeShape, MIN_RATIO, MAX_RATIO } from "../src/lib/shape";

let failures = 0;

function check(what: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok    ${what}`);
  } else {
    failures++;
    console.error(`  FAIL  ${what}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  }
}

const p = (id: string, width: number | null, height: number | null, ready = true) => ({
  id,
  width,
  height,
  ready,
});

console.log("\nthe carousel that went out wrong");
{
  // The real post: 1440x2160 portrait first, then landscapes mixed through.
  const real = [
    p("1", 1440, 2160), p("2", 1440, 960), p("3", 1440, 960), p("4", 1440, 2160),
    p("5", 1440, 960), p("6", 1440, 2160), p("7", 1440, 2160), p("8", 1440, 960),
    p("9", 1440, 960), p("10", 1440, 2160),
  ];

  const verdict = carouselShape(real);
  check("is refused", verdict.ok, false);
  check("for mixing shapes", verdict.ok === false && verdict.kind, "mixed");
  check("and says why in plain words", typeof describeShape(verdict), "string");
}

console.log("\none shape, inside Instagram's range");
check("all 4:5", carouselShape([p("a", 1440, 1800), p("b", 1080, 1350)]), { ok: true });
check("all square", carouselShape([p("a", 1080, 1080), p("b", 1440, 1440)]), { ok: true });
check("all 1.91:1", carouselShape([p("a", 1910, 1000), p("b", 1146, 600)]), { ok: true });
check("a single photo", carouselShape([p("a", 1440, 1800)]), { ok: true });
check("no photos at all", carouselShape([]), { ok: true });

console.log("\none shape, outside it");
{
  // 2:3 — the shape the ruined post's first image actually was.
  const tall = carouselShape([p("a", 1440, 2160), p("b", 1000, 1500)]);
  check("2:3 is refused", tall.ok, false);
  check("as too tall", tall.ok === false && tall.kind === "out-of-range" && tall.tallest, true);

  const wide = carouselShape([p("a", 3000, 1000)]);
  check("3:1 is refused", wide.ok, false);
  check("as too wide", wide.ok === false && wide.kind === "out-of-range" && wide.tallest, false);
}

console.log("\nthe boundaries themselves are allowed");
check(`exactly 4:5 (${MIN_RATIO})`, carouselShape([p("a", 800, 1000)]), { ok: true });
check(`exactly 1.91:1 (${MAX_RATIO})`, carouselShape([p("a", 1910, 1000)]), { ok: true });

console.log("\nrounding must not read as a different shape");
{
  // Same intent, different integer pixels — must not be called "mixed".
  check(
    "1440x1800 beside 1439x1799",
    carouselShape([p("a", 1440, 1800), p("b", 1439, 1799)]),
    { ok: true },
  );

  // But a real difference must still be caught.
  const off = carouselShape([p("a", 1440, 1800), p("b", 1440, 1700)]);
  check("1440x1800 beside 1440x1700 is mixed", off.ok === false && off.kind, "mixed");
}

console.log("\nunmeasured photos are not assumed fine");
{
  const pending = carouselShape([p("a", 1440, 1800), p("b", null, null)]);
  check("a photo with no dimensions is refused", pending.ok, false);
  check("as unknown rather than guessed", pending.ok === false && pending.kind, "unknown");
}

console.log("\na photo being re-cropped carries dimensions about to change");
{
  // Both read 4:5 right now — but one is mid-crop, so those numbers describe
  // the photo it USED to be. Approving this blesses a shape that is already
  // on its way out.
  const cropping = carouselShape([p("a", 1440, 1800), p("b", 1440, 1800, false)]);
  check("is refused even though both look right", cropping.ok, false);
  check("as unknown", cropping.ok === false && cropping.kind, "unknown");
}

console.log("\ndescribeShape");
check("says nothing when there is nothing wrong", describeShape({ ok: true }), null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll shape checks passed.\n");
