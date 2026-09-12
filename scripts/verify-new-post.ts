/**
 * Every way of starting a post gives it a place in the running order.
 *
 * There are three: the New post button, duplicating an existing post, and
 * picking photos in the media bank. For a day the third did not set a queue
 * position, so those posts appeared in the grid and then refused to be
 * dragged — and because the other two were fine, it looked random.
 *
 * This reads the source rather than the database, because the bug was never
 * in the data: it was a creation path that had not been kept up with the
 * others. What it checks is that no path builds a post row by hand.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Every file that inserts a row into `posts`. Add one here when you add one. */
const CREATORS = [
  "src/app/(app)/posts/actions.ts",
  "src/app/(app)/media/create-post-from.ts",
];

/*
 * Ideas are the deliberate exception. An idea is a caption and nothing else —
 * it has no photos, no tile and no place in the grid until it is turned into a
 * real post, so a position would be a promise the app does not keep.
 */
const EXEMPT = ["src/app/(app)/ideas/actions.ts"];

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

console.log("starting a post");

for (const file of CREATORS) {
  const source = readFileSync(file, "utf8");

  check(`${file} uses the shared fields`, () => {
    assert.ok(
      source.includes("newPostFields("),
      "inserts a post without newPostFields(), so it can miss a queue position",
    );
  });

  check(`${file} does not set a position by hand`, () => {
    assert.ok(
      !/queue_position:\s*\(/.test(source),
      "works out a position itself — that is what drifted last time",
    );
  });
}

check("every inserting file is accounted for", () => {
  // A new creation path that nobody added to CREATORS is exactly how this
  // happened, so the list is checked against the code rather than trusted.
  const found = execSync(
    'git grep -l --no-color -e "from(\\"posts\\")" -- "src/**/*.ts" "src/**/*.tsx"',
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((file) => /\.insert\(/.test(readFileSync(file, "utf8")))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      // Only files where the insert is actually into `posts`.
      return /from\("posts"\)\s*\n?\s*\.insert\(/.test(source);
    })
    .map((file) => file.replace(/\\/g, "/"));

  const unknown = found.filter(
    (file) => !CREATORS.includes(file) && !EXEMPT.includes(file),
  );

  assert.deepEqual(
    unknown,
    [],
    `these create posts but are not listed in this test: ${unknown.join(", ")}`,
  );
});

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log("\nAll good.");
