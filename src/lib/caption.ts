import { renderHashtags } from "@/lib/hashtags";
import type { HashtagPlacement } from "@/lib/database.types";

/**
 * What a post will actually look like once published, and whether it fits.
 *
 * The subtlety worth getting right: when hashtags go in the caption they count
 * toward Instagram's 2,200-character limit, and when they go in the first
 * comment they do not. A counter that ignores that will happily let you write
 * a caption that Instagram rejects at publish time — which, for a scheduled
 * post, means finding out hours later that nothing went up.
 */

/** Instagram's hard caption ceiling. */
export const CAPTION_LIMIT = 2200;

/** Instagram's comment ceiling, which the first-comment hashtags must fit. */
export const COMMENT_LIMIT = 2200;

export type CaptionPlan = {
  /** Exactly what gets sent as the caption. */
  caption: string;
  /** Exactly what gets posted as the first comment, or null. */
  firstComment: string | null;
  captionLength: number;
  captionRemaining: number;
  overBy: number;
  fits: boolean;
};

export function planCaption({
  body,
  tags,
  placement,
}: {
  body: string;
  tags: readonly string[];
  placement: HashtagPlacement;
}): CaptionPlan {
  const trimmed = body.replace(/\s+$/, "");
  const rendered = renderHashtags([...tags]);

  const inCaption = placement === "caption" && tags.length > 0;

  // A blank line between the caption and its hashtags — the usual convention,
  // and it must be counted, not assumed free.
  const caption = inCaption
    ? trimmed.length > 0
      ? `${trimmed}\n\n${rendered}`
      : rendered
    : trimmed;

  const firstComment =
    placement === "first_comment" && tags.length > 0 ? rendered : null;

  // Instagram counts UTF-16 code units the way JavaScript's .length does for
  // ordinary text, but an emoji outside the BMP counts as two. Using
  // [...string].length would undercount and let a caption through that
  // Instagram rejects, so .length is the safer measure here.
  const captionLength = caption.length;

  return {
    caption,
    firstComment,
    captionLength,
    captionRemaining: CAPTION_LIMIT - captionLength,
    overBy: Math.max(0, captionLength - CAPTION_LIMIT),
    fits: captionLength <= CAPTION_LIMIT && (firstComment?.length ?? 0) <= COMMENT_LIMIT,
  };
}

/**
 * Hashtags typed directly into the caption body.
 *
 * Someone writing naturally will put a tag inline — "shot at #artistpoint" —
 * and that tag counts toward Instagram's limit of 30 just as much as one from
 * the picker. Counting only the picked ones would silently under-report.
 */
export function inlineHashtags(body: string): string[] {
  const found = body.match(/(?<![\w])#([A-Za-z0-9_]{1,138})/g) ?? [];
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const match of found) {
    const tag = match.slice(1);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

/** Every hashtag the post will carry, from the picker and typed inline. */
export function allHashtags(body: string, picked: readonly string[]): string[] {
  const seen = new Set<string>();
  const all: string[] = [];

  for (const tag of [...picked, ...inlineHashtags(body)]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    all.push(tag);
  }

  return all;
}
