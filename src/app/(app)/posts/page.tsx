import Link from "next/link";
import { GridView } from "./_views/grid-view";
import { ScheduleView } from "./_views/schedule-view";
import { DraftsView } from "./_views/drafts-view";
import { NewPostButton } from "./new-post-button";

export const metadata = { title: "Posts" };
export const dynamic = "force-dynamic";

/**
 * Every post, three ways of looking at it.
 *
 * These were three separate pages — Grid, Queue and Posts — and they were
 * three answers to one question. That is where a day of confusion came from:
 * the grid said November while the queue said September, drafts appeared in a
 * queue they were not in, and each fix had to be made twice because the same
 * idea lived in two places.
 *
 * One page cannot disagree with itself about what is coming next. The views
 * differ only in how they draw it:
 *
 *   GRID      how the profile will look, and the order, by dragging
 *   SCHEDULE  what is going out, and when
 *   DRAFTS    what is still unfinished, and why
 *
 * Each view loads only its own data, so a visit costs what the old page cost
 * rather than the sum of all three.
 */

const VIEWS = [
  { key: "grid", label: "Grid", hint: "How the profile will look" },
  { key: "schedule", label: "Schedule", hint: "What is going out, and when" },
  { key: "drafts", label: "Drafts", hint: "Still to finish" },
] as const;

type View = (typeof VIEWS)[number]["key"];

/** Old names, so a bookmark or a stale link still lands somewhere sensible. */
const RENAMED: Record<string, View> = { list: "drafts" };

function isView(value: string | undefined): value is View {
  return VIEWS.some((v) => v.key === value);
}

function resolve(value: string | undefined): View {
  if (isView(value)) return value;
  if (value && RENAMED[value]) return RENAMED[value];

  // The grid is the default: it answers "what should I do next", where the
  // others answer questions you already know you have.
  return "grid";
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;

  const view = resolve(params.view);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Posts</h1>

        <nav className="flex flex-wrap items-center gap-1">
          {VIEWS.map((option) => (
            <Link
              key={option.key}
              href={option.key === "grid" ? "/posts" : `/posts?view=${option.key}`}
              title={option.hint}
              aria-current={option.key === view ? "page" : undefined}
              className={
                option.key === view
                  ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                  : "rounded-md px-2.5 py-1 text-xs text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <NewPostButton />
        </div>
      </div>

      {view === "grid" && <GridView />}
      {view === "schedule" && <ScheduleView />}
      {view === "drafts" && <DraftsView />}
    </div>
  );
}
