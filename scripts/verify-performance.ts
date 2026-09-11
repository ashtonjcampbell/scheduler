/**
 * Checks the insights arithmetic against numbers worked out by hand.
 *
 * The failures worth catching here are the quiet ones. A broken sign test or a
 * baseline that drifts does not throw — it produces a confident, plausible,
 * wrong recommendation about when to post, and there is nothing on the page to
 * suggest anything went astray.
 */

import {
  dayPart,
  median,
  score,
  signTest,
  summarise,
  overallCaution,
  WEEKDAYS,
  type PerformanceRow,
} from "../src/lib/performance";

/** Fixtures are dated early 2026; judge them from a point where all are mature. */
const NOW = new Date("2027-01-01T00:00:00Z");

let failures = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${what}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${what}`);
  }
}

function close(what: string, actual: number, expected: number, tolerance = 0.005) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${what}\n        expected ~${expected}, got ${actual}`);
  } else {
    console.log(`  ok    ${what} (${actual.toFixed(3)})`);
  }
}

console.log("\nmedian");
check("odd length", median([3, 1, 2]), 2);
check("even length averages the middle pair", median([1, 2, 3, 4]), 2.5);
check("empty", median([]), 0);
check("ignores how extreme the outlier is", median([1, 2, 3, 4, 1000]), 3);

console.log("\nsignTest");
// A fair coin landing 5 of 5 one way: 2 * (1/32).
close("5 of 5", signTest(5, 5), 0.0625);
close("an even split is unremarkable", signTest(5, 10), 1);
close("8 of 11 — the evening result that did not hold up", signTest(8, 11), 0.2266);
close("13 of 18 — the Thursday result", signTest(13, 18), 0.0963);
close("3 of 12 — the Sunday result", signTest(3, 12), 0.1460);
check("no posts cannot be significant", signTest(0, 0), 1);

console.log("\nscore: growth must not look like a finding");
{
  // Reach doubles across the year. Every post is exactly typical for its own
  // moment, so nothing should stand out — if detrending works.
  const rows: PerformanceRow[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString(),
    media_type: "IMAGE",
    reach: 100 + i * 5,
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  const scored = score(rows, "reach", NOW);
  const drift = Math.max(...scored.map((s) => Math.abs(s.ratio - 1)));
  close("steady growth leaves every ratio at 1", drift, 0, 0.03);
  check("the ends, which cannot be scored fairly, are dropped", scored.length, rows.length - 10);
}

console.log("\nscore: posts too new to judge are held back");
{
  const rows: PerformanceRow[] = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 11, 1 + i)).toISOString(),
    media_type: "IMAGE",
    reach: 100,
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  // 30 daily posts ending 30 Dec; from 1 Jan only those before 18 Dec are
  // mature, and the window then trims five more from each end.
  const scored = score(rows, "reach", NOW);
  check("nothing newer than the cutoff is scored", scored.every((s) => s.posted_at < "2026-12-18"), true);
  check("the mature ones still are", scored.length > 0, true);
}

console.log("\nscore: a real effect must survive");
{
  // Same steady growth, but every fourth post does twice as well.
  const rows: PerformanceRow[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString(),
    media_type: "IMAGE",
    reach: (100 + i * 5) * (i % 4 === 0 ? 2 : 1),
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  const scored = score(rows, "reach", NOW);
  // Index into `scored` is not index into `rows` — the unscoreable ends are
  // gone — so identify the boosted posts by their id, not their position.
  const boosted = scored.filter((s) => Number(s.id.slice(1)) % 4 === 0).map((s) => s.ratio);
  close("the doubled posts still read as roughly double", median(boosted), 2, 0.12);
}

console.log("\nscore: missing metrics are dropped, not counted as zero");
{
  // Every post reached 100 except one, whose insights call came back empty.
  // If that gap were read as zero it would drop the baseline of everything
  // near it, and ten ordinary posts would look like ten triumphs.
  const rows: PerformanceRow[] = Array.from({ length: 21 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    media_type: "IMAGE",
    reach: i === 10 ? null : 100,
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  const scored = score(rows, "reach", NOW);
  check("the post with no number is excluded", scored.some((s) => s.id === "p10"), false);
  check("and its neighbours are still ordinary", scored.every((s) => s.ratio === 1), true);
  check("the rest are scored", scored.length, 10);
}

console.log("\nsummarise");
{
  const rows: PerformanceRow[] = Array.from({ length: 20 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 0, 5 + i)).toISOString(),
    media_type: i % 2 === 0 ? "CAROUSEL_ALBUM" : "IMAGE",
    reach: 100,
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  const scored = score(rows, "reach", NOW);
  const buckets = summarise(scored, () => "Mon", ["Mon", "Tue"]);

  check("a day with no posts is still listed", buckets.map((b) => b.key), ["Mon", "Tue"]);
  check("and is reported as unanswered, not as bad", buckets[1]!.verdict, "too-few");
  check("an empty bucket has no sample", buckets[1]!.n, 0);
  check("carousel share is tracked as a confounder", buckets[0]!.carouselShare, 0.5);
}

console.log("\nverdicts");
{
  const thin: PerformanceRow[] = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    posted_at: new Date(Date.UTC(2026, 0, 5 + i)).toISOString(),
    media_type: "IMAGE",
    reach: 100 + i,
    views: null,
    like_count: null,
    total_interactions: null,
  }));

  const buckets = summarise(score(thin, "reach", NOW), () => "Mon", ["Mon"]);
  check("a handful of posts never reads as a finding", buckets[0]!.verdict, "too-few");
}

console.log("\noverallCaution");
{
  const none = summarise([], () => "Mon", [...WEEKDAYS]);
  check("nothing measured yet says nothing at all", overallCaution(none), null);
}

console.log("\ndayPart boundaries");
check("8am", dayPart(8), "Before 9am");
check("9am starts its own band", dayPart(9), "9–11am");
check("11am", dayPart(11), "11am–1pm");
check("1pm", dayPart(13), "1–4pm");
check("4pm", dayPart(16), "4–7pm");
check("7pm", dayPart(19), "After 7pm");
check("midnight", dayPart(0), "Before 9am");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll performance checks passed.\n");
