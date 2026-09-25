/**
 * The watchdog shouts once, late enough to mean it, and never for a blip.
 *
 * These are the cases an outage would otherwise teach us: an alarm that fires
 * every minute gets filtered into a folder nobody reads, and one that never
 * fires is the reason two and a half days of failed publishing went unnoticed.
 */

import assert from "node:assert/strict";
import { decide, alertText, recoveryText, minutes, PATIENCE_MS } from "../clock/watchdog";

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

const MINUTE = 60_000;
const T = 1_000_000_000_000;

console.log("watchdog");

check("a healthy tick forgets any incident", () => {
  const d = decide({ wrong: false, remembered: { since: T, alerted: true }, now: T + MINUTE, kind: "unreachable" });
  assert.equal(d.action, "clear");
});

check("the first bad tick only remembers", () => {
  const d = decide({ wrong: true, remembered: null, now: T, kind: "unreachable" });
  assert.equal(d.action, "remember");
  assert.equal(d.action === "remember" && d.incident.since, T);
});

check("a one-minute blip never alerts", () => {
  const first = decide({ wrong: true, remembered: null, now: T, kind: "unreachable" });
  const incident = first.action === "remember" ? first.incident : null;

  const second = decide({ wrong: true, remembered: incident, now: T + MINUTE, kind: "unreachable" });
  assert.equal(second.action, "remember", "one minute is not an outage");

  // ...and then it recovers.
  const third = decide({ wrong: false, remembered: incident, now: T + 2 * MINUTE, kind: "unreachable" });
  assert.equal(third.action, "clear");
});

check("a database down for three minutes alerts", () => {
  const d = decide({ wrong: true, remembered: { since: T }, now: T + PATIENCE_MS.unreachable, kind: "unreachable" });
  assert.equal(d.action, "alert");
  assert.equal(d.action === "alert" && d.incident.alerted, true);
});

check("a post two minutes late does NOT alert", () => {
  // A publish run takes about a minute; two minutes late is traffic.
  const d = decide({ wrong: true, remembered: { since: T }, now: T + 2 * MINUTE, kind: "overdue" });
  assert.equal(d.action, "remember");
});

check("a post twenty minutes late alerts", () => {
  const d = decide({ wrong: true, remembered: { since: T }, now: T + PATIENCE_MS.overdue, kind: "overdue" });
  assert.equal(d.action, "alert");
});

check("it shouts once, not every minute", () => {
  const first = decide({ wrong: true, remembered: { since: T }, now: T + PATIENCE_MS.unreachable, kind: "unreachable" });
  assert.equal(first.action, "alert");

  const after = first.action === "alert" ? first.incident : null;

  // The next two and a half days of failed ticks must produce nothing more.
  for (const later of [5 * MINUTE, 60 * MINUTE, 60 * 60 * MINUTE]) {
    const again = decide({ wrong: true, remembered: after, now: T + later, kind: "unreachable" });
    assert.equal(again.action, "remember", `alerted again after ${later / MINUTE} minutes`);
  }
});

check("recovering and failing again alerts a second time", () => {
  // A new incident is news, even if the last one was the same fault.
  const cleared = decide({ wrong: false, remembered: { since: T, alerted: true }, now: T + MINUTE, kind: "unreachable" });
  assert.equal(cleared.action, "clear");

  const fresh = decide({ wrong: true, remembered: null, now: T + 2 * MINUTE, kind: "unreachable" });
  assert.equal(fresh.action, "remember", "a new incident starts its own clock");
});

check("the message says how long, in plain minutes", () => {
  const { title, body } = alertText("unreachable", 4 * MINUTE + 20_000);
  assert.match(title, /database/i);
  assert.match(body, /4 minutes/);
  assert.match(body, /Restart project/, "it should say what fixes it");
  assert.ok(!body.includes("undefined"));
});

check("the overdue message points at the Actions log", () => {
  const { title, body } = alertText("overdue", 25 * MINUTE);
  assert.match(title, /overdue/i);
  assert.match(body, /Actions/);
  assert.match(body, /25 minutes/);
  assert.match(body, /not lost/i, "it should say the post is safe");
});

check("a sub-minute delay still reads as a whole minute", () => {
  assert.equal(minutes(20_000), 1, "never 'for 0 minutes'");
});

check("lateness counts from the slot, not from when the clock noticed", () => {
  // The database was down for days; the clock has just got it back and sees a
  // post that was due last Thursday. That is not "late by one minute".
  const dueSince = T - 3 * 24 * 60 * MINUTE;
  const d = decide({ wrong: true, remembered: null, now: T, kind: "overdue", startedAt: dueSince });

  assert.equal(d.action, "alert", "a post three days late should alert on the first look");
  assert.equal(d.action === "alert" && d.incident.since, dueSince);
});

check("a slot time in the future never makes lateness negative", () => {
  const d = decide({ wrong: true, remembered: null, now: T, kind: "overdue", startedAt: T + 10 * MINUTE });
  assert.equal(d.action, "remember");
  assert.ok(d.action === "remember" && d.incident.since <= T);
});

check("the recovery note says what recovered and for how long", () => {
  const down = recoveryText("unreachable", 47 * MINUTE);
  assert.match(down, /answering again/i);
  assert.match(down, /47 minutes/);

  const late = recoveryText("overdue", 90 * MINUTE);
  assert.match(late, /published/i);
  assert.match(late, /90 minutes/);
});

check("the issue number survives so recovery can close the right one", () => {
  const alerted = decide({ wrong: true, remembered: { since: T }, now: T + PATIENCE_MS.unreachable, kind: "unreachable" });
  assert.equal(alerted.action, "alert");

  // The clock stores the issue number alongside; a later tick must keep it.
  const carried = { ...(alerted.action === "alert" ? alerted.incident : {}), issue: 42 } as { since: number; alerted?: boolean; issue?: number };
  const still = decide({ wrong: true, remembered: carried, now: T + 60 * MINUTE, kind: "unreachable" });

  assert.equal(still.action, "remember");
  assert.equal(still.action === "remember" && still.incident.issue, 42);
});

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log("\nAll good.");
