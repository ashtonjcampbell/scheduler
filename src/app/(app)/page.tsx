import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPacific } from "@/lib/time";

export const metadata = { title: "Overview" };

// Counts change as soon as anything is uploaded or scheduled, so this page
// must never be served from a cache.
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = await supabaseServer();

  // One round trip per figure, but they run concurrently and `head: true`
  // means no rows come back over the wire.
  const [photos, needsAttention, queued, scheduled, published, settings] =
    await Promise.all([
      // Trashed photos are excluded everywhere they are counted: the media
      // bank hides them, so counting them here would not add up.
      supabase
        .from("photos")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("photos")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null)
        .or("missing_color_profile.eq.true,status.eq.failed"),
      supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued"),
      supabase
        .from("posts")
        .select("id, title, scheduled_for", { count: "exact" })
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true })
        .limit(5),
      supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("status", "published"),
      supabase.from("app_settings").select("ig_username, dry_run").single(),
    ]);

  const failedConnection = photos.error;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          {settings.data?.ig_username
            ? `Connected to @${settings.data.ig_username}.`
            : "Instagram is not connected yet."}
        </p>
      </div>

      {failedConnection ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not reach the database: {failedConnection.message}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Photos" value={photos.count} href="/media" />
            <Stat
              label="Need a look"
              value={needsAttention.count}
              href="/media?filter=attention"
              tone={needsAttention.count ? "warn" : "plain"}
            />
            <Stat label="In queue" value={queued.count} href="/queue" />
            <Stat label="Published" value={published.count} href="/grid" />
          </dl>

          <section>
            <h2 className="text-sm font-semibold">Going out next</h2>

            {scheduled.data?.length ? (
              <ul className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {scheduled.data.map((post) => (
                  <li
                    key={post.id}
                    className="flex items-baseline justify-between gap-4 bg-white px-4 py-3 text-sm dark:bg-stone-900"
                  >
                    <span className="truncate">{post.title ?? "Untitled post"}</span>
                    <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                      {post.scheduled_for
                        ? formatPacific(post.scheduled_for)
                        : "unscheduled"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Nothing scheduled yet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone = "plain",
}: {
  label: string;
  value: number | null;
  href: string;
  tone?: "plain" | "warn";
}) {
  return (
    <Link
      href={href}
      className={
        tone === "warn" && value
          ? "rounded-lg border border-amber-300 bg-amber-50 p-4 transition hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950"
          : "rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
      }
    >
      <dt className="text-xs text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value ?? 0}</dd>
    </Link>
  );
}
