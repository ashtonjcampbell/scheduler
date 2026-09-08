/**
 * Drawing a hashtag set from the library.
 *
 * This replaces the spreadsheet formula that picked a few random tags per
 * category. It selects at RANDOM from the photographer's own curated list —
 * nothing is generated, invented or suggested. That distinction is the whole
 * product stance; see the absolute rule in AGENTS.md.
 *
 * Pure and RNG-injectable so the behaviour can be tested rather than eyeballed.
 */

export type DrawableTag = {
  id: string;
  tag: string;
  category_id: string | null;
  post_count: number | null;
  active: boolean;
};

export type DrawRequest = {
  /** Every tag in the library. Filtering happens here, not in the query. */
  pool: readonly DrawableTag[];
  /** How many to draw from each category, keyed by category id. */
  counts: Readonly<Record<string, number>>;
  /** Optional volume band — ignoring the giant tags is a real strategy. */
  minPosts?: number | null;
  maxPosts?: number | null;
  /** Tags to keep as-is. They count toward their category's quota. */
  locked?: readonly string[];
  /** Injectable for tests. Must return [0, 1). */
  random?: () => number;
};

export type DrawResult = {
  picked: DrawableTag[];
  /** Categories that could not supply as many tags as asked for. */
  shortfalls: Array<{ categoryId: string; wanted: number; got: number }>;
};

export function drawHashtags({
  pool,
  counts,
  minPosts = null,
  maxPosts = null,
  locked = [],
  random = Math.random,
}: DrawRequest): DrawResult {
  const lockedIds = new Set(locked);
  const lockedTags = pool.filter((t) => lockedIds.has(t.id));

  const picked: DrawableTag[] = [...lockedTags];
  const shortfalls: DrawResult["shortfalls"] = [];

  for (const [categoryId, wanted] of Object.entries(counts)) {
    if (wanted <= 0) continue;

    // A locked tag already satisfies part of this category's quota, so it is
    // not re-drawn and not double-counted.
    const alreadyHeld = lockedTags.filter((t) => t.category_id === categoryId).length;
    const stillNeeded = wanted - alreadyHeld;
    if (stillNeeded <= 0) continue;

    const candidates = pool.filter(
      (t) =>
        t.active &&
        t.category_id === categoryId &&
        !lockedIds.has(t.id) &&
        withinVolume(t.post_count, minPosts, maxPosts),
    );

    const drawn = sample(candidates, stillNeeded, random);
    picked.push(...drawn);

    if (drawn.length < stillNeeded) {
      shortfalls.push({
        categoryId,
        wanted,
        got: drawn.length + alreadyHeld,
      });
    }
  }

  return { picked, shortfalls };
}

/**
 * A tag with no recorded volume is never excluded by a volume filter: the
 * number is missing, not zero, and silently dropping it would quietly shrink
 * the pool for reasons the user cannot see.
 */
function withinVolume(
  postCount: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (postCount === null) return true;
  if (min !== null && postCount < min) return false;
  if (max !== null && postCount > max) return false;
  return true;
}

/**
 * Partial Fisher-Yates: shuffles only as far as it needs to.
 *
 * Sorting by a random key — the obvious one-liner — gives a subtly biased
 * order with most comparison sorts, and this is the part that decides which
 * of two tags gets used, so it is worth doing properly.
 */
function sample<T>(items: readonly T[], take: number, random: () => number): T[] {
  const copy = [...items];
  const limit = Math.min(take, copy.length);

  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }

  return copy.slice(0, limit);
}

/** Swap one tag for another from the same category. Used by "re-roll". */
export function rerollOne(
  current: readonly DrawableTag[],
  target: DrawableTag,
  pool: readonly DrawableTag[],
  options: { minPosts?: number | null; maxPosts?: number | null; random?: () => number } = {},
): DrawableTag[] {
  const { minPosts = null, maxPosts = null, random = Math.random } = options;
  const held = new Set(current.map((t) => t.id));

  const candidates = pool.filter(
    (t) =>
      t.active &&
      t.category_id === target.category_id &&
      !held.has(t.id) &&
      withinVolume(t.post_count, minPosts, maxPosts),
  );

  // Nothing else available in that category: leave the set untouched rather
  // than silently shrinking it.
  const [replacement] = sample(candidates, 1, random);
  if (!replacement) return [...current];

  return current.map((t) => (t.id === target.id ? replacement : t));
}
