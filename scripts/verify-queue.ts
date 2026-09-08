import { assignQueue, findMissed, reorder, type Slot } from "../src/lib/queue";
import { formatPacific, inPacific } from "../src/lib/time";

/**
 * Proves the rolling queue behaves. Run with `npm run verify:queue`.
 *
 * The daylight-saving cases are the point. A 10am slot must stay 10am across
 * the March and November changes; storing instants instead of wall-clock times
 * is the classic way to get an hour adrift twice a year, and nobody notices
 * until a post goes out at the wrong time.
 */

let failures = 0;
const check = (label: string, passed: boolean, detail = "") => {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures++;
};

const slot = (id: string, weekday: number, local_time: string, active = true): Slot => ({
  id,
  weekday,
  local_time,
  active,
});

// Tue 10:00, Thu 17:00, Sat 09:00 — the brief's own example.
const SLOTS = [slot("tue", 2, "10:00:00"), slot("thu", 4, "17:00:00"), slot("sat", 6, "09:00:00")];

const posts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, queue_position: i }));

console.log("\nFills slots in queue order");
{
  // A Monday.
  const now = new Date("2026-09-07T12:00:00-07:00");
  const { assignments, unassigned } = assignQueue({
    posts: posts(4),
    slots: SLOTS,
    fixed: [],
    now,
  });

  check("everything is placed", unassigned.length === 0 && assignments.length === 4);
  check("in queue order", assignments.map((a) => a.postId).join() === "p0,p1,p2,p3");
  check("times ascend", assignments.every((a, i) => i === 0 || a.at > assignments[i - 1]!.at));
  check("first is the Tuesday slot", assignments[0]!.slotId === "tue",
    formatPacific(assignments[0]!.at));
  check("second is Thursday", assignments[1]!.slotId === "thu", formatPacific(assignments[1]!.at));
  check("fourth wraps to next week", assignments[3]!.slotId === "tue",
    formatPacific(assignments[3]!.at));
}

console.log("\nA slot that has already passed today is skipped");
{
  // Tuesday, 11am — an hour after the 10am slot.
  const now = new Date("2026-09-08T11:00:00-07:00");
  const { assignments } = assignQueue({ posts: posts(1), slots: SLOTS, fixed: [], now });

  check("does not schedule in the past", assignments[0]!.at > now, formatPacific(assignments[0]!.at));
  check("takes Thursday instead", assignments[0]!.slotId === "thu");
}

console.log("\nFixed posts block the slot they sit on");
{
  const now = new Date("2026-09-07T12:00:00-07:00");
  const { assignments } = assignQueue({
    posts: posts(2),
    slots: SLOTS,
    // Pinned to the Tuesday 10am slot.
    fixed: [{ id: "fixed", scheduled_for: "2026-09-08T10:00:00-07:00" }],
    now,
  });

  check("queue skips the taken slot", assignments[0]!.slotId === "thu",
    formatPacific(assignments[0]!.at));
  check("and carries on after it", assignments[1]!.slotId === "sat");
}

console.log("\nNo active slots means nothing is scheduled");
{
  const now = new Date("2026-09-07T12:00:00-07:00");
  const off = SLOTS.map((s) => ({ ...s, active: false }));
  const { assignments, unassigned } = assignQueue({
    posts: posts(3),
    slots: off,
    fixed: [],
    now,
  });

  check("nothing assigned", assignments.length === 0);
  check("all reported as unassigned", unassigned.length === 3);
}

console.log("\nDaylight saving: a 10am slot stays 10am");
{
  // US clocks go forward on 8 March 2026 and back on 1 November 2026.
  const beforeSpring = new Date("2026-03-02T12:00:00-08:00");
  const springAssignments = assignQueue({
    posts: posts(3),
    slots: [slot("tue", 2, "10:00:00")],
    fixed: [],
    now: beforeSpring,
  }).assignments;

  const springHours = springAssignments.map((a) => inPacific(a.at).getHours());
  check("still 10am across the March change", springHours.every((h) => h === 10),
    springHours.join(","));

  const beforeAutumn = new Date("2026-10-26T12:00:00-07:00");
  const autumnAssignments = assignQueue({
    posts: posts(3),
    slots: [slot("tue", 2, "10:00:00")],
    fixed: [],
    now: beforeAutumn,
  }).assignments;

  const autumnHours = autumnAssignments.map((a) => inPacific(a.at).getHours());
  check("still 10am across the November change", autumnHours.every((h) => h === 10),
    autumnHours.join(","));

  // The instants either side of a change differ by 167 or 169 hours, not 168.
  const gap =
    (springAssignments[1]!.at.getTime() - springAssignments[0]!.at.getTime()) / 3_600_000;
  check("the week containing the change is 167 hours, not 168", gap === 167,
    `${gap} hours`);
}

console.log("\nMissed posts are found, with a grace period");
{
  const now = new Date("2026-09-08T12:00:00-07:00");
  const all = [
    { id: "long-gone", scheduled_for: "2026-09-08T09:00:00-07:00", status: "scheduled" },
    { id: "just-now", scheduled_for: "2026-09-08T11:50:00-07:00", status: "scheduled" },
    { id: "future", scheduled_for: "2026-09-09T10:00:00-07:00", status: "scheduled" },
    { id: "already-out", scheduled_for: "2026-09-01T10:00:00-07:00", status: "published" },
    { id: "draft", scheduled_for: null, status: "rough_draft" },
  ];

  const missed = findMissed(all, now).map((p) => p.id);
  check("catches the one that is properly late", missed.includes("long-gone"));
  check("leaves a just-due post alone", !missed.includes("just-now"));
  check("ignores the future", !missed.includes("future"));
  check("ignores published posts", !missed.includes("already-out"));
  check("ignores drafts", !missed.includes("draft"));
  check("finds exactly one", missed.length === 1, missed.join(","));
}

console.log("\nReordering");
{
  const ids = ["a", "b", "c", "d"];
  check("move down", reorder(ids, 0, 2).join() === "b,c,a,d", reorder(ids, 0, 2).join());
  check("move up", reorder(ids, 3, 0).join() === "d,a,b,c", reorder(ids, 3, 0).join());
  check("no-op stays put", reorder(ids, 1, 1).join() === "a,b,c,d");
  check("out of range is ignored", reorder(ids, 9, 0).join() === "a,b,c,d");
  check("original is untouched", ids.join() === "a,b,c,d");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
if (failures > 0) process.exit(1);
