import { supabaseServer } from "@/lib/supabase/server";
import { formatPacific, TIMEZONE } from "@/lib/time";
import {
  DAY_PARTS,
  MIN_AGE_DAYS,
  WEEKDAYS,
  dayPart,
  overallCaution,
  score,
  summarise,
  type Bucket,
  type Measure,
  type Scored,
} from "@/lib/performance";

/*
   * Built ONCE, at module load.
   *
   * Constructing an Intl.DateTimeFormat is expensive — far more than using
   * one — and this runs per post. At a hundred posts that was a hundred
   * formatters built to read a weekday off each, on a runtime with a ten
   * millisecond CPU budget for the whole request.
   */
const WEEKDAY_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
  hour: "2-digit",
  hour12: false,
});

export const metadata = { title: "When to post" };
export const dynamic = "force-dynamic";

/**
 * What your own posts say about when to post.
 *
 * Written to be hard to over-read. Every figure carries its sample size, every
 * bucket carries the odds of it being luck, and a time you have never tried is
 * shown as untested rather than left blank — "no evidence" and "evidence of
 * nothing" are different answers and a table that hides the difference invites
 * the wrong one.
 */

const MEASURES: { key: Measure; label: string; hint: string }[] = [
  { key: "reach", label: "Reach", hint: "How many accounts saw it. The steadiest measure." },
  { key: "like_count", label: "Likes", hint: "Noisier — it depends who happened to be awake." },
  { key: "views", label: "Views", hint: "Counts repeat views, so a few fans can sway it." },
  { key: "total_interactions", label: "All interactions", hint: "Likes, comments, saves and shares together." },
];

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ measure?: string }>;
}) {
  const params = await searchParams;
  const measure: Measure =
    MEASURES.find((m) => m.key === params.measure)?.key ?? "reach";

  const supabase = await supabaseServer();

  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    supabase
      .from("media_performance")
      .select("id, posted_at, media_type, reach, views, like_count, total_interactions")
      .order("posted_at", { ascending: false }),
    supabase.from("app_settings").select("ig_username, performance_synced_at").single(),
  ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load performance: {error.message}
      </p>
    );
  }

  const all = rows ?? [];
  const scored = score(all, measure);

  const parts = (iso: string) => {
    const formatted = WEEKDAY_HOUR.formatToParts(new Date(iso));

    return {
      weekday: formatted.find((p) => p.type === "weekday")!.value,
      hour: Number(formatted.find((p) => p.type === "hour")!.value),
    };
  };

  const byWeekday = summarise(scored, (r) => parts(r.posted_at).weekday, [...WEEKDAYS]);
  const byTime = summarise(scored, (r) => dayPart(parts(r.posted_at).hour), [...DAY_PARTS]);

  if (all.length === 0) {
    return (
      <div className="space-y-4">
        <Heading />
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          {settings?.ig_username
            ? "No figures yet. They arrive with the next publishing run, and the first one has a couple of years of history to work through."
            : "Connect Instagram in Settings, and this fills in from your own posts."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Heading />

      <div className="flex flex-wrap items-center gap-1.5">
        {MEASURES.map((m) => (
          <a
            key={m.key}
            href={`/insights?measure=${m.key}`}
            title={m.hint}
            className={
              m.key === measure
                ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                : "rounded-md border border-stone-300 px-2.5 py-1 text-xs dark:border-stone-700"
            }
          >
            {m.label}
          </a>
        ))}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        {scored.length} posts measured
        {all.length > scored.length &&
          ` · ${all.length - scored.length} held back as too new or unscoreable`}
        {settings?.performance_synced_at &&
          ` · updated ${formatPacific(settings.performance_synced_at)}`}
      </p>

      <Table
        title="By day of the week"
        buckets={byWeekday}
        measure={measure}
        caution={overallCaution(byWeekday)}
      />

      <Table
        title="By time of day"
        buckets={byTime}
        measure={measure}
        caution={overallCaution(byTime)}
      />

      <FormatComparison scored={scored} measure={measure} />

      <section className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          How to read this
        </h2>

        <p className="mt-2">
          <strong>&ldquo;vs. normal&rdquo;</strong> compares each post against the
          posts published around the same time, not against your whole history.
          Your following has grown, so an old post and a new one are not
          otherwise comparable.
        </p>

        <p className="mt-2">
          <strong>&ldquo;Beat average&rdquo;</strong> is the honest one. If the
          timing made no difference at all, this would sit near half. The
          <em> chance</em> column is how often luck alone produces a split that
          lopsided — so 0.50 means a coin flip, and only something below about
          0.05 is worth changing your routine over.
        </p>

        <p className="mt-2">
          Posts from the last {MIN_AGE_DAYS} days are left out. Reach keeps
          climbing for weeks, so counting a new post would make it look like a
          failure for no reason other than being new.
        </p>

        <p className="mt-2">
          Watch the carousel column. Carousels outperform single images on this
          account, so a slot that happens to be mostly carousels can look like a
          good <em>time</em> when it is really a good <em>format</em>.
        </p>
      </section>
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">When to post</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
        Worked out from your own posts, not general advice. It will often say
        there is no difference — that is a real answer, and a more useful one
        than a confident guess.
      </p>
    </div>
  );
}

function Table({
  title,
  buckets,
  measure,
  caution,
}: {
  title: string;
  buckets: Bucket[];
  measure: Measure;
  caution: string | null;
}) {
  const best = buckets
    .filter((b) => b.verdict === "likely" || b.verdict === "possible")
    .sort((a, b) => b.ratio - a.ratio)[0];

  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead className="text-stone-500 dark:text-stone-400">
            <tr className="border-b border-stone-200 dark:border-stone-800">
              <th className="py-1.5 pr-3 font-medium">When</th>
              <th className="py-1.5 pr-3 font-medium">Posts</th>
              <th className="py-1.5 pr-3 font-medium">vs. normal</th>
              <th className="py-1.5 pr-3 font-medium">Beat average</th>
              <th className="py-1.5 pr-3 font-medium">Chance</th>
              <th className="py-1.5 pr-3 font-medium">Typical {labelFor(measure)}</th>
              <th className="py-1.5 pr-3 font-medium">Carousels</th>
              <th className="py-1.5 font-medium">Verdict</th>
            </tr>
          </thead>

          <tbody>
            {buckets.map((b) => (
              <tr
                key={b.key}
                className="border-b border-stone-100 last:border-0 dark:border-stone-900"
              >
                <td className="py-1.5 pr-3 font-medium">{b.key}</td>
                <td className="py-1.5 pr-3 tabular-nums">{b.n || "—"}</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {b.n === 0 ? "—" : `${b.ratio.toFixed(2)}×`}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {b.n === 0 ? "—" : `${b.beat}/${b.n}`}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {b.n === 0 ? "—" : b.p.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {b.n === 0 ? "—" : Math.round(b.typical).toLocaleString()}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {b.n === 0 ? "—" : `${Math.round(b.carouselShare * 100)}%`}
                </td>
                <td className="py-1.5">
                  <VerdictTag bucket={b} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {caution ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {caution}
        </p>
      ) : best ? (
        <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
          <strong>{best.key}</strong> is the strongest here at {best.ratio.toFixed(2)}×
          — and even that would happen by luck about {Math.round(best.p * 100)} times in 100.
        </p>
      ) : null}
    </section>
  );
}

function VerdictTag({ bucket }: { bucket: Bucket }) {
  if (bucket.n === 0) {
    return (
      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
        never tried
      </span>
    );
  }

  const map = {
    "too-few": ["too few to say", "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"],
    "no-signal": ["no difference", "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"],
    possible: [
      bucket.ratio >= 1 ? "maybe better" : "maybe worse",
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    ],
    likely: [
      bucket.ratio >= 1 ? "likely better" : "likely worse",
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    ],
  } as const;

  const [label, classes] = map[bucket.verdict];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${classes}`}>{label}</span>;
}

/**
 * Format, shown next to timing on purpose.
 *
 * On this account the gap between a carousel and a single image dwarfs every
 * difference between times of day, and someone who came here to optimise their
 * schedule should see the bigger lever while they are looking.
 */
function FormatComparison({ scored, measure }: { scored: Scored[]; measure: Measure }) {
  const buckets = summarise(scored, (r) => r.media_type ?? "UNKNOWN", [
    "CAROUSEL_ALBUM",
    "IMAGE",
    "VIDEO",
  ]);

  const names: Record<string, string> = {
    CAROUSEL_ALBUM: "Carousel",
    IMAGE: "Single image",
    VIDEO: "Video",
  };

  const measured = buckets.filter((b) => b.n > 0);
  if (measured.length < 2) return null;

  const top = [...measured].sort((a, b) => b.typical - a.typical)[0]!;
  const bottom = [...measured].sort((a, b) => a.typical - b.typical)[0]!;
  const gap = bottom.typical > 0 ? Math.round((top.typical / bottom.typical - 1) * 100) : 0;

  return (
    <section>
      <h2 className="text-sm font-semibold">By format</h2>

      <div className="mt-2 space-y-1">
        {measured.map((b) => (
          <div key={b.key} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0">{names[b.key] ?? b.key}</span>
            <span className="w-10 shrink-0 tabular-nums text-stone-500 dark:text-stone-400">
              {b.n}
            </span>
            <span
              className="h-3 rounded-sm bg-stone-800 dark:bg-stone-300"
              style={{ width: `${Math.max(2, (b.typical / top.typical) * 60)}%` }}
            />
            <span className="tabular-nums">{Math.round(b.typical).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {gap > 0 && (
        <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
          {names[top.key]}s get about <strong>{gap}% more {labelFor(measure)}</strong> than{" "}
          {(names[bottom.key] ?? bottom.key).toLowerCase()}s here. That is a bigger lever than
          any hour in the tables above.
        </p>
      )}
    </section>
  );
}

function labelFor(measure: Measure): string {
  return measure === "like_count"
    ? "likes"
    : measure === "total_interactions"
      ? "interactions"
      : measure;
}
