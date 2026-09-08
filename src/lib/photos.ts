import { publicEnv } from "@/lib/env";
import type { Photo, PhotoUsage } from "@/lib/database.types";

/** Formats accepted for upload, matching the `uploads` bucket's own allowlist. */
export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
  "image/avif",
] as const;

/** Also matching the bucket. Originals are deleted right after processing. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * How long trashed photos are kept before the worker clears them out.
 *
 * Lives here rather than beside the actions because a "use server" module may
 * only export async functions — exporting a constant from one silently
 * invalidates every action in it.
 *
 * Duplicated as TRASH_RETENTION_DAYS in worker/src/process-media.ts, which is
 * what actually does the deleting. Change both together.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Public URL of a processed photo.
 *
 * The `media` bucket has to be publicly readable: Instagram's publishing API
 * is handed a URL and fetches the image itself, rather than accepting an
 * upload. Paths are UUIDs, so files are unguessable, but treat them as public.
 */
export function photoUrl(storagePath: string): string {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  return `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${storagePath}`;
}

/** Storage path for a freshly uploaded original. */
export function uploadPathFor(photoId: string, filename: string): string {
  return `${photoId}.${extensionOf(filename)}`;
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  return match ? match[1].toLowerCase() : "bin";
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The filters offered above the media bank.
 *
 * Trash is deliberately last and stands apart: every other filter is a view
 * of live photos, while trash is a view of ones on their way out.
 */
export const MEDIA_FILTERS = {
  all: "All",
  available: "Available",
  drafted: "In drafts",
  used: "Used",
  attention: "Needs a look",
  trash: "Trash",
} as const;

export type MediaFilter = keyof typeof MEDIA_FILTERS;

export function isMediaFilter(value: string | undefined): value is MediaFilter {
  return value !== undefined && value in MEDIA_FILTERS;
}

/**
 * Decide whether a photo belongs in a filter.
 *
 * Kept here rather than in the query so "Needs a look" — which spans a
 * processing failure and a missing colour profile, two unrelated columns —
 * reads as one idea instead of an `.or()` string.
 */
export function matchesFilter(
  photo: Pick<Photo, "status" | "missing_color_profile">,
  usage: PhotoUsage,
  filter: MediaFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "available":
      return usage === "unused" && photo.status === "ready";
    case "drafted":
      return usage === "drafted";
    case "used":
      return usage === "scheduled" || usage === "posted";
    case "attention":
      return photo.status === "failed" || photo.missing_color_profile;
    case "trash":
      // Handled by the query, which fetches trashed photos separately.
      return true;
  }
}

export const USAGE_LABELS: Record<PhotoUsage, string> = {
  unused: "Unused",
  drafted: "In a draft",
  scheduled: "Scheduled",
  posted: "Posted",
};
