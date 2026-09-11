/**
 * Working out whether a posting time actually matters.
 *
 * This is the honest-arithmetic half of the insights page. It has no opinions
 * about Instagram and makes no network calls, so every claim it produces can
 * be checked against fixed numbers in `scripts/verify-performance.ts`.
 *
 * Three things make the difference between a useful answer and a flattering
 * one, and all three live here:
 *
 *  1. DETRENDING. Raw reach climbs as the account grows, so a 2026 post beats
 *     a 2024 post for reasons that have nothing to do with the hour. Each post
 *     is therefore scored against the posts nearest it IN TIME, not against the
 *     whole history.
 *
 *  2. MEDIANS, not means. One post that happens to travel can be twenty times
 *     a normal one. A mean would let that single post decide which day of the
 *     week "wins".
 *
 *  3. SAYING WHEN THERE IS NO ANSWER. Splitting a hundred posts seven ways
 *     leaves buckets small enough that chance alone produces convincing-looking
 *     winners. Every bucket is therefore returned with the sample size and the
 *     odds of seeing a split that lopsided by luck, and `verdict` refuses to
 *     dress up a coin flip as a finding.
 */

/** The metrics worth ranking a time slot by. */
export type Measure = "reach" | "like_count" | "views" | "total_interactions";

export type PerformanceRow = {
  id: string;
  posted_at: string;
  media_type: string | null;
  reach: number | null;
  views: number | null;
  like_count: number | null;
  total_interactions: number | null;
};

export type Scored = PerformanceRow & {
  /** How this post did against its neighbours in time. 1 = typical. */
  ratio: number;
  value: number;
};

/**
 * Posts either side used as a post's baseline.
 *
 * Ten neighbours is a compromise: too few and the baseline is as noisy as the
 * post being measured, too many and slow changes in the account's reach leak
 * back in as if they were an effect of timing.
 */
const NEIGHBOURS = 5;

/**
 * A post needs neighbours on BOTH sides to be scored.
 *
 * With a one-sided window every neighbour of the newest post is older, so under
 * a growing account its baseline is systematically low and the post looks like
 * a triumph. The same in reverse buries the oldest. Measured against steady
 * growth, that edge alone moved a ratio by 13% — easily enough to invent a
 * winning weekday out of nothing.
 *
 * Dropping those posts costs the first and last five. At the recent end that is
 * no loss at all: their numbers are still climbing anyway, which is what
 * `MIN_AGE_DAYS` is for.
 */

/**
 * How long a post needs before its numbers mean anything.
 *
 * Reach keeps accruing for weeks. Include a three-day-old post and it reads as
 * a failure, purely for being new — and since new posts are exactly the ones
 * following any schedule change, that bias would land squarely on whatever was
 * being tested.
 */
export const MIN_AGE_DAYS = 14;

/** Below this a bucket is reported as unanswered rather than ranked. */
export const MIN_SAMPLE = 8;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Score each post against the posts around it in time.
 *
 * Posts missing the chosen measure are dropped BEFORE neighbours are taken, so
 * a gap in the data cannot quietly become a neighbour worth zero and drag a
 * baseline down.
 */
export function score(
  rows: readonly PerformanceRow[],
  measure: Measure,
  now: Date = new Date(),
): Scored[] {
  const cutoff = now.getTime() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

  const usable = rows
    .map((row) => ({ row, value: row[measure] }))
    .filter((entry): entry is { row: PerformanceRow; value: number } =>
      typeof entry.value === "number" &&
      entry.value > 0 &&
      new Date(entry.row.posted_at).getTime() <= cutoff,
    )
    .sort((a, b) => a.row.posted_at.localeCompare(b.row.posted_at));

  const scored: Scored[] = [];

  // Both ends need a full window; see NEIGHBOURS above for why a truncated one
  // is worse than no answer.
  for (let i = NEIGHBOURS; i < usable.length - NEIGHBOURS; i++) {
    const baseline = median(
      usable
        .slice(i - NEIGHBOURS, i + NEIGHBOURS + 1)
        .filter((_, offset) => offset !== NEIGHBOURS)
        .map((e) => e.value),
    );

    if (baseline <= 0) continue;

    scored.push({ ...usable[i]!.row, value: usable[i]!.value, ratio: usable[i]!.value / baseline });
  }

  return scored;
}

export type Bucket = {
  key: string;
  n: number;
  /** Typical performance against the account's own baseline. 1 = ordinary. */
  ratio: number;
  /** Median of the raw measure, for a number that means something on its own. */
  typical: number;
  /** How many of these posts beat their baseline. */
  beat: number;
  /** Odds of a split this lopsided if timing made no difference at all. */
  p: number;
  verdict: Verdict;
  /** Share of this bucket that were carousels — the biggest confounder here. */
  carouselShare: number;
};

export type Verdict = "too-few" | "no-signal" | "possible" | "likely";

/**
 * Group posts and judge each group.
 *
 * `keys` fixes the order and, importantly, keeps groups with NO posts in the
 * output. An untested Saturday and a Saturday that failed are completely
 * different facts, and a table that silently omits the first invites reading it
 * as the second.
 */
export function summarise(
  scored: readonly Scored[],
  keyOf: (row: Scored) => string,
  keys: readonly string[],
): Bucket[] {
  const groups = new Map<string, Scored[]>();
  for (const key of keys) groups.set(key, []);
  for (const row of scored) groups.get(keyOf(row))?.push(row);

  return keys.map((key) => {
    const rows = groups.get(key) ?? [];
    const beat = rows.filter((r) => r.ratio > 1).length;
    const p = signTest(beat, rows.length);

    return {
      key,
      n: rows.length,
      ratio: median(rows.map((r) => r.ratio)),
      typical: median(rows.map((r) => r.value)),
      beat,
      p,
      verdict: judge(rows.length, p),
      carouselShare:
        rows.length === 0
          ? 0
          : rows.filter((r) => r.media_type === "CAROUSEL_ALBUM").length / rows.length,
    };
  });
}

function judge(n: number, p: number): Verdict {
  if (n < MIN_SAMPLE) return "too-few";
  if (p <= 0.05) return "likely";
  if (p <= 0.2) return "possible";
  return "no-signal";
}

/**
 * Two-sided sign test: if the time of day made no difference whatsoever, how
 * often would chance alone produce a split at least this uneven?
 *
 * Deliberately the blunt test rather than something with more power. It assumes
 * almost nothing about how reach is distributed — and reach is wildly skewed,
 * which is exactly where a t-test would start inventing confidence.
 */
export function signTest(successes: number, n: number): number {
  if (n === 0) return 1;

  const observed = binomial(n, successes);
  let total = 0;

  for (let k = 0; k <= n; k++) {
    // Everything at least as extreme as what we saw, from either direction.
    if (binomial(n, k) <= observed + 1e-12) total += binomial(n, k);
  }

  return Math.min(1, total);
}

/** P(exactly k of n), fair coin. Multiplied stepwise so n=500 cannot overflow. */
function binomial(n: number, k: number): number {
  let result = Math.pow(0.5, n);
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/**
 * How much of a warning the table needs as a whole.
 *
 * Seven weekdays means seven chances for luck to look like a discovery, so the
 * page says so whenever the only positive results are the borderline kind.
 */
export function overallCaution(buckets: readonly Bucket[]): string | null {
  const tested = buckets.filter((b) => b.verdict !== "too-few").length;
  const likely = buckets.filter((b) => b.verdict === "likely").length;
  const possible = buckets.filter((b) => b.verdict === "possible").length;

  if (tested === 0) return null;
  if (likely > 0) return null;

  if (possible > 0) {
    return `Nothing here is solid. Across ${tested} comparisons, a hint this strong turns up by chance more often than not — treat it as somewhere to experiment, not a conclusion.`;
  }

  return `No time tested here performs differently from any other, as far as ${tested} comparisons can tell.`;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const DAY_PARTS = [
  "Before 9am",
  "9–11am",
  "11am–1pm",
  "1–4pm",
  "4–7pm",
  "After 7pm",
] as const;

export function dayPart(hour: number): string {
  if (hour < 9) return "Before 9am";
  if (hour < 11) return "9–11am";
  if (hour < 13) return "11am–1pm";
  if (hour < 16) return "1–4pm";
  if (hour < 19) return "4–7pm";
  return "After 7pm";
}
