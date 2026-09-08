/**
 * Hashtag parsing and validation.
 *
 * Tags are stored WITHOUT the leading '#' — it is punctuation, not part of the
 * tag — and with their case preserved, because camel case is far easier to
 * read in a caption. Uniqueness is case-insensitive, matching Instagram.
 */

/** Instagram's own hard ceiling. The soft 3-7 guide lives in app_settings. */
export const MAX_HASHTAGS_PER_POST = 30;

/** Instagram truncates beyond this; the database enforces it too. */
export const MAX_TAG_LENGTH = 138;

const VALID_TAG = /^[A-Za-z0-9_]{1,138}$/;

export type ParsedTag = { tag: string } | { input: string; error: string };

/**
 * Clean a single tag as typed. Returns null when nothing usable is left.
 */
export function normaliseTag(input: string): string | null {
  // People paste '#tag', '＃tag' (full width, common on mobile), or plain 'tag'.
  const stripped = input.trim().replace(/^[#＃]+/, "").trim();
  return stripped.length > 0 ? stripped : null;
}

export function validateTag(tag: string): string | null {
  if (tag.length > MAX_TAG_LENGTH) return `Too long (max ${MAX_TAG_LENGTH})`;
  if (!VALID_TAG.test(tag)) {
    return "Only letters, numbers and underscores";
  }
  return null;
}

/**
 * Split a pasted block into individual tags.
 *
 * Photographers arrive with existing hashtag sets copied out of a note or an
 * old caption, so accept whatever separator that block happens to use —
 * spaces, commas, newlines — rather than making them reformat it.
 *
 * Duplicates within the paste are dropped case-insensitively, keeping the
 * first spelling seen.
 */
export function parseTagBlock(block: string): ParsedTag[] {
  const seen = new Set<string>();
  const results: ParsedTag[] = [];

  for (const piece of block.split(/[\s,;]+/)) {
    if (piece.trim().length === 0) continue;

    const tag = normaliseTag(piece);
    if (!tag) continue;

    const error = validateTag(tag);
    if (error) {
      results.push({ input: piece, error });
      continue;
    }

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    results.push({ tag });
  }

  return results;
}

export function isValidParse(parsed: ParsedTag): parsed is { tag: string } {
  return "tag" in parsed;
}

/**
 * How the hashtags will actually appear once published.
 *
 * Kept in one place so the composer's preview and the publishing worker can
 * never disagree about what gets sent.
 */
export function renderHashtags(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(" ");
}

/**
 * The characters hashtags will add to a caption, including the blank line
 * that separates them from the caption body.
 */
export function hashtagCost(tags: string[]): number {
  if (tags.length === 0) return 0;
  return renderHashtags(tags).length + 2; // two newlines
}
