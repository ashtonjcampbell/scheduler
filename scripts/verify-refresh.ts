/**
 * The polling backs off, and stays polite for a long job.
 *
 * The numbers are the point, not the mechanism: the previous version was a
 * fixed five seconds, and the cost of that only showed up on a job that ran
 * for twenty minutes — which is not something anyone notices while writing it.
 * So the schedule is asserted rather than eyeballed.
 */

import assert from "node:assert/strict";

/** Must match src/app/(app)/media/auto-refresh.tsx. */
const STEPS = [5_000, 5_000, 5_000, 7_000, 7_000, 10_000, 10_000, 15_000, 20_000];
const SETTLED = 30_000;

let failures = 0;

function check(name: string, run: () => void) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}

/** How many requests a job of this length would cause. */
function requestsOver(ms: number): number {
  let elapsed = 0;
  let count = 0;

  for (let step = 0; ; step++) {
    elapsed += STEPS[step] ?? SETTLED;
    if (elapsed > ms) return count;
    count++;
  }
}

console.log("media auto-refresh");

check("a short job is as responsive as it was", () => {
  // Three photos land in well under a minute; nothing should feel slower.
  assert.ok(STEPS[0] <= 5_000, "the first check should be within five seconds");
  assert.ok(
    requestsOver(30_000) >= 4,
    `only ${requestsOver(30_000)} checks in the first thirty seconds`,
  );
});

check("it never polls faster than every five seconds", () => {
  for (const step of STEPS) assert.ok(step >= 5_000, `found a ${step}ms gap`);
});

check("the gaps only grow", () => {
  for (let i = 1; i < STEPS.length; i++) {
    assert.ok(STEPS[i] >= STEPS[i - 1], `step ${i} is shorter than the one before`);
  }
  assert.ok(SETTLED >= STEPS[STEPS.length - 1], "it should not speed up at the end");
});

check("a twenty-minute job costs a fraction of what it did", () => {
  const now = requestsOver(20 * 60 * 1000);
  const before = (20 * 60 * 1000) / 5_000; // the old fixed five seconds

  assert.ok(
    now < before / 4,
    `${now} requests against ${before} before — not the reduction intended`,
  );

  console.log(`       (${before} requests before, ${now} now)`);
});

check("it still checks often enough to be useful", () => {
  // Half a minute is the longest anyone should wait to see a photo appear.
  assert.ok(SETTLED <= 30_000, "settling slower than thirty seconds is too slow");
});

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log("\nAll good.");
