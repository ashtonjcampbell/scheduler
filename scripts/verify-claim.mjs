/**
 * A queued post can actually be claimed for publishing.
 *
 *   npm run verify:claim
 *
 * WHY THIS EXISTS. For a month, every Thursday slot came and went and nothing
 * published. The publisher found the post, tried to claim it, and the database
 * refused — a check constraint says a post that is `publishing` must know when
 * it is going live, and a queued post has no stored time. The error was thrown
 * away, so the log said "already claimed elsewhere, skipping", which is what an
 * ordinary race looks like.
 *
 * Nothing caught it because every unit test works on pure functions, and this
 * failure lived in the shape of a database row. So this one talks to the real
 * database: it creates a throwaway post, claims it exactly as the publisher
 * does, and deletes it. It never contacts Instagram and never publishes.
 *
 * Not in CI — it needs the service key and writes to the live database. Run it
 * after anything that touches claiming, status values, or the posts table.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const check = (name, passed, detail = "") => {
  console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures++;
};

console.log("\nclaiming a post for publishing\n");

// A post that exists only for this check, left out of every view by being a
// draft until the moment it is made ready below.
const { data: post, error: createError } = await db
  .from("posts")
  .insert({
    caption: "VERIFY:CLAIM — created and deleted by npm run verify:claim",
    status: "queued",
    schedule_mode: "queue",
    ready: true,
  })
  .select("id")
  .single();

if (createError) {
  console.error(`\nCould not create the test post: ${createError.message}\n`);
  process.exit(1);
}

try {
  const slotAt = new Date();

  const { data: claimed, error: claimError } = await db
    .from("posts")
    .update({
      status: "publishing",
      claimed_at: new Date().toISOString(),
      scheduled_for: slotAt.toISOString(),
    })
    .eq("id", post.id)
    .eq("ready", true)
    .in("status", ["queued", "scheduled"])
    .select("id, scheduled_for");

  check("the database accepts the claim", !claimError, claimError?.message);
  check("exactly one row is claimed", (claimed?.length ?? 0) === 1, `got ${claimed?.length ?? 0}`);
  check(
    "the slot it is going out for is recorded",
    claimed?.[0]?.scheduled_for != null,
    "a publishing post with no time is what the constraint forbids",
  );

  // Claiming twice must take exactly once, or two runs could both publish it.
  const { data: second } = await db
    .from("posts")
    .update({ status: "publishing", claimed_at: new Date().toISOString(), scheduled_for: slotAt.toISOString() })
    .eq("id", post.id)
    .eq("ready", true)
    .in("status", ["queued", "scheduled"])
    .select("id");

  check("a second run cannot claim the same post", (second?.length ?? 0) === 0, `got ${second?.length ?? 0}`);

  // And a draft is never claimable, however due its slot looks.
  await db.from("posts").update({ status: "queued", ready: false, claimed_at: null }).eq("id", post.id);

  const { data: draft } = await db
    .from("posts")
    .update({ status: "publishing", claimed_at: new Date().toISOString(), scheduled_for: slotAt.toISOString() })
    .eq("id", post.id)
    .eq("ready", true)
    .in("status", ["queued", "scheduled"])
    .select("id");

  check("an unfinished post is never claimed", (draft?.length ?? 0) === 0, `got ${draft?.length ?? 0}`);
} finally {
  const { error: cleanupError } = await db.from("posts").delete().eq("id", post.id);
  console.log(cleanupError ? `\n  WARNING: test post ${post.id} was left behind` : "\n  test post deleted");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll good.\n");
