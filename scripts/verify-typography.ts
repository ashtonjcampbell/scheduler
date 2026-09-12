/**
 * The substitutions do what they say, and nothing else.
 *
 * Text replacement that runs while someone types is the kind of thing that
 * looks obviously right and eats a word. These are the cases worth pinning:
 * the ones it must change, the ones it must leave, and the cursor.
 */

import assert from "node:assert/strict";
import { smarten, smartenAt } from "../src/lib/typography";

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

console.log("typing shortcuts");

check("--> becomes an arrow", () => {
  assert.equal(smarten("the ridge --> the lake"), "the ridge ↠ the lake");
});

check("-- between words becomes an em dash", () => {
  assert.equal(smarten("quiet--then not"), "quiet—then not");
});

check("-- surrounded by spaces becomes an em dash", () => {
  assert.equal(smarten("quiet -- then not"), "quiet — then not");
});

check("the arrow is taken before the dash", () => {
  // "-->" contains "--", so the wrong order would produce "—>".
  assert.equal(smarten("a --> b"), "a ↠ b");
  assert.ok(!smarten("a --> b").includes(">"));
});

check("a single hyphen is left alone", () => {
  assert.equal(smarten("half-formed thoughts"), "half-formed thoughts");
  assert.equal(smarten("a well-lit room"), "a well-lit room");
});

check("two hyphens convert the moment they are typed", () => {
  // Deliberate: the owner typed "--" and expected a dash, not a wait.
  assert.equal(smarten("still typing--"), "still typing—");
});

check("--> typed one character at a time still reaches the arrow", () => {
  // "--" becomes an em dash first, then ">" lands on it. This is the path the
  // editor takes, and it is where the literal "$1" bug was hiding.
  assert.equal(smarten("a --"), "a —");
  assert.equal(smarten("a —>"), "a ↠");
});

check("no replacement ever leaks a regex reference", () => {
  // The editor's rules insert their replacement literally, so a "$1" in one
  // reached the screen as text. Nothing here may contain a dollar sign.
  for (const input of ["a--b", "a -- b", "a-->b", "a --> b", "x--", "--"]) {
    const out = smarten(input);
    assert.ok(!out.includes("$"), `"${input}" produced "${out}"`);
  }
});

check("quotes are not touched", () => {
  assert.equal(smarten(`she said "no"`), `she said "no"`);
  assert.equal(smarten("it's fine"), "it's fine");
});

check("three dots are not touched", () => {
  assert.equal(smarten("waiting..."), "waiting...");
});

check("running it twice changes nothing more", () => {
  const once = smarten("a --> b -- c");
  assert.equal(smarten(once), once);
});

check("hashtags survive", () => {
  assert.equal(smarten("#pnw-elopement"), "#pnw-elopement");
});

check("the cursor follows the text it is in", () => {
  // "the ridge -->" is 13 characters; the arrow makes it 11.
  const typed = "the ridge --> the lake";
  const { text, caret } = smartenAt(typed, 13);

  assert.equal(text, "the ridge ↠ the lake");
  assert.equal(caret, 11, "the cursor should sit just after the arrow");
  assert.equal(text.slice(0, caret), "the ridge ↠");
});

check("a replacement after the cursor does not move it", () => {
  const { caret } = smartenAt("write -- here and --> there", 5);
  assert.equal(caret, 5);
});

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log("\nAll good.");
