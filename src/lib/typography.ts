/**
 * The substitutions a typewriter used to make you do by hand.
 *
 * Only what was asked for, and only what is unambiguous:
 *
 *   -->   ↠   a long arrow
 *   --    —   an em dash
 *
 * NOT a general "smart punctuation" pass. Straight quotes are left alone: a
 * caption may quote someone, and guessing which way a quote mark should curl
 * gets it wrong often enough to be worse than leaving it. Ellipses are left
 * alone too — three dots is a deliberate look.
 *
 * ORDER MATTERS. `-->` contains `--`, so the arrow has to be taken first or an
 * arrow becomes "—>".
 */

/*
 * ORDER MATTERS, and the rules deliberately run into each other.
 *
 * "-->" contains "--", so the arrow has to be taken first or it would already
 * have become "—>" by the time anything looked for it. The second rule then
 * catches exactly that case — an em dash this list already made, with a ">"
 * typed after it — which is how "-->" typed one character at a time still
 * arrives at an arrow.
 *
 * No capture groups anywhere. The editor's own version of these rules cannot
 * use them (it inserts the replacement literally), and keeping both halves
 * written the same way means they cannot drift apart.
 */
const RULES: Array<[RegExp, string]> = [
  [/-->/g, "↠"],
  [/—>/g, "↠"],
  [/--/g, "—"],
];

/** Rewrite a whole string. Safe to run repeatedly: the output has no triggers left. */
export function smarten(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Rewrite a string and say where the cursor should end up.
 *
 * A replacement shortens the text — "-->" is three characters and "↠" is one —
 * so a cursor left at its old offset would jump backwards through what was
 * just typed. Only the part BEFORE the cursor can move it, so that is measured
 * on its own.
 */
export function smartenAt(text: string, caret: number): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const smartBefore = smarten(before);

  return {
    text: smartBefore + smarten(text.slice(caret)),
    caret: smartBefore.length,
  };
}
