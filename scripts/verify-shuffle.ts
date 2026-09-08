import { drawHashtags, rerollOne, type DrawableTag } from "../src/lib/shuffle.js";

/**
 * Proves the hashtag shuffle behaves. Run with `npm run verify:shuffle`.
 *
 * The distribution check at the end is the one that matters most: a shuffle
 * that quietly favours the same handful of tags would look fine in casual use
 * and slowly make every post identical.
 */

let failures = 0;
const check = (label: string, passed: boolean, detail = "") => {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures++;
};

const tag = (
  id: string,
  category_id: string,
  post_count: number | null = 50_000,
  active = true,
): DrawableTag => ({ id, tag: `t${id}`, category_id, post_count, active });

const pool: DrawableTag[] = [
  ...Array.from({ length: 8 }, (_, i) => tag(`e${i}`, "elopement", 100_000 + i)),
  ...Array.from({ length: 4 }, (_, i) => tag(`b${i}`, "baker", 40_000 + i)),
  tag("r0", "regional", 90_000),
  tag("dead", "elopement", 200, false),
  tag("huge", "elopement", 50_000_000),
  tag("nulls", "baker", null),
];

// Deterministic RNG so a failure is reproducible.
let seed = 1;
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

console.log("\nDraws the requested shape");
{
  const { picked, shortfalls } = drawHashtags({
    pool,
    counts: { elopement: 2, baker: 2, regional: 1 },
    random: rng,
  });
  check("five tags total", picked.length === 5, `got ${picked.length}`);
  check("two from elopement", picked.filter((t) => t.category_id === "elopement").length === 2);
  check("two from baker", picked.filter((t) => t.category_id === "baker").length === 2);
  check("no shortfalls", shortfalls.length === 0);
  check("no duplicates", new Set(picked.map((t) => t.id)).size === picked.length);
  check("retired tags are never drawn", !picked.some((t) => t.id === "dead"));
}

console.log("\nReports shortfalls rather than under-delivering silently");
{
  const { picked, shortfalls } = drawHashtags({ pool, counts: { regional: 3 }, random: rng });
  check("gives what it can", picked.length === 1, `got ${picked.length}`);
  check(
    "says so",
    shortfalls.length === 1 && shortfalls[0]!.wanted === 3 && shortfalls[0]!.got === 1,
    JSON.stringify(shortfalls),
  );
}

console.log("\nVolume band");
{
  const { picked } = drawHashtags({
    pool,
    counts: { elopement: 8 },
    maxPosts: 1_000_000,
    random: rng,
  });
  check("excludes a 50M-post tag", !picked.some((t) => t.id === "huge"));
  check(
    "a tag with unknown volume is not filtered out",
    drawHashtags({ pool, counts: { baker: 5 }, minPosts: 1000, random: rng }).picked.some(
      (t) => t.id === "nulls",
    ),
  );
}

console.log("\nLocked tags are kept and count toward the quota");
{
  const { picked } = drawHashtags({
    pool,
    counts: { elopement: 3 },
    locked: ["e0", "e1"],
    random: rng,
  });
  check("both survive", picked.some((t) => t.id === "e0") && picked.some((t) => t.id === "e1"));
  check("only the missing one is drawn", picked.length === 3, `got ${picked.length}`);
}

console.log("\nRe-roll swaps one tag within its own category");
{
  const current = drawHashtags({ pool, counts: { baker: 2 }, random: rng }).picked;
  const swapped = rerollOne(current, current[0]!, pool, { random: rng });
  check("same size", swapped.length === current.length);
  check("the target is gone", !swapped.some((t) => t.id === current[0]!.id));
  check("the other is untouched", swapped.some((t) => t.id === current[1]!.id));
  check("replacement is from the same category", swapped.every((t) => t.category_id === "baker"));

  const solo = [tag("solo", "solo")];
  const noSwap = rerollOne(solo, solo[0]!, solo, { random: rng });
  check(
    "leaves the set alone when nothing else is available",
    noSwap.length === 1 && noSwap[0]!.id === "solo",
  );
}

console.log("\nDistribution is even, not degenerate");
{
  const seen = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    for (const t of drawHashtags({ pool, counts: { elopement: 2 }, random: rng }).picked) {
      seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
    }
  }

  const eligible = pool.filter((t) => t.category_id === "elopement" && t.active).length;
  check("every eligible tag appears over 400 draws", seen.size === eligible,
    `${seen.size} of ${eligible}`);

  const counts = [...seen.values()];
  const spread = Math.max(...counts) / Math.min(...counts);
  check("no tag dominates", spread < 2, `max/min ${spread.toFixed(2)}`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
if (failures > 0) process.exit(1);
