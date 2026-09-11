import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import {
  MEDIA_FILTERS,
  isMediaFilter,
  matchesFilter,
  type MediaFilter,
} from "@/lib/photos";
import type { PhotoUsage } from "@/lib/database.types";
import { UploadZone } from "./upload-zone";
import { MediaGrid } from "./media-grid";
import { AutoRefresh } from "./auto-refresh";
import { TrashHeader } from "./trash-header";

/**
 * Photos per page.
 *
 * Chosen against a CPU budget, not a layout: Cloudflare gives this runtime ten
 * milliseconds per request on the free plan, and each card is a fair amount of
 * markup. Ninety-six of them exceeded it and the page failed outright.
 */
const PER_PAGE = 24;

export const metadata = { title: "Media bank" };
export const dynamic = "force-dynamic";

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { filter: raw, page: rawPage } = await searchParams;
  // Defaults to what is free to use. Opening the bank on everything meant
  // scrolling past photos already spoken for to find the ones that are not.
  const filter: MediaFilter = isMediaFilter(raw) ? raw : "available";

  const supabase = await supabaseServer();

  const [{ data: live, error }, { data: trashed }, { data: usageRows }] =
    await Promise.all([
      supabase
        .from("photos")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("photos")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase.from("photo_usage").select("photo_id, usage"),
    ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load the media bank: {error.message}
      </p>
    );
  }

  const usageById = new Map<string, PhotoUsage>(
    (usageRows ?? []).map((row) => [row.photo_id, row.usage]),
  );

  const livePhotos = live ?? [];
  const trashedPhotos = trashed ?? [];

  const inTrash = filter === "trash";
  const matching = inTrash
    ? trashedPhotos
    : livePhotos.filter((photo) =>
        matchesFilter(photo, usageById.get(photo.id) ?? "unused", filter),
      );

  /*
   * Shown a page at a time.
   *
   * Not for scrolling comfort — this runs on a budget of ten milliseconds of
   * CPU per request, and rendering a hundred photo cards in one pass spends it
   * before the page is finished. The bank failed outright at ninety-six.
   */
  const page = Math.max(1, Number(rawPage) || 1);
  const pageCount = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = matching.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const pageHref = (n: number) => {
    const query = new URLSearchParams();
    if (filter !== "available") query.set("filter", filter);
    if (n > 1) query.set("page", String(n));
    const suffix = query.toString();
    return suffix ? `/media?${suffix}` : "/media";
  };

  // While anything is mid-pipeline the page needs to update itself: the work
  // finishes in GitHub Actions, so nothing here would otherwise know.
  const stillWorking = livePhotos.some(
    (photo) => photo.status === "pending" || photo.status === "processing",
  );

  return (
    <div className="space-y-6">
      {stillWorking && <AutoRefresh />}

      <div>
        <h1 className="text-xl font-semibold tracking-tight">Media bank</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Every photo is converted to sRGB at 1440px — the best quality
          Instagram can display — and the original is discarded.
        </p>
      </div>

      {!inTrash && <UploadZone />}

      <nav className="flex flex-wrap items-center gap-1 border-b border-stone-200 pb-3 dark:border-stone-800">
        {(Object.keys(MEDIA_FILTERS) as MediaFilter[]).map((key) => {
          const count =
            key === "trash"
              ? trashedPhotos.length
              : livePhotos.filter((photo) =>
                  matchesFilter(photo, usageById.get(photo.id) ?? "unused", key),
                ).length;

          return (
            <Link
              key={key}
              href={key === "available" ? "/media" : `/media?filter=${key}`}
              aria-current={key === filter ? "page" : undefined}
              className={[
                key === filter
                  ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                  : "rounded-md px-2.5 py-1 text-xs text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100",
                // Trash sits apart from the live views.
                key === "trash" ? "ml-auto" : "",
              ].join(" ")}
            >
              {MEDIA_FILTERS[key]}
              <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
            </Link>
          );
        })}
      </nav>

      {inTrash && trashedPhotos.length > 0 && (
        <TrashHeader count={trashedPhotos.length} />
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          {inTrash
            ? "The trash is empty."
            : livePhotos.length === 0
              ? "No photos yet. Drop some above to get started."
              : "Nothing matches this filter."}
        </p>
      ) : (
        <>
          <MediaGrid photos={visible} usageById={usageById} inTrash={inTrash} />

          {pageCount > 1 && (
            <nav className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  href={pageHref(n)}
                  aria-current={n === current ? "page" : undefined}
                  className={
                    n === current
                      ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                      : "rounded-md border border-stone-300 px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:text-stone-400"
                  }
                >
                  {n}
                </Link>
              ))}

              <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                {matching.length} photo{matching.length === 1 ? "" : "s"}
              </span>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
