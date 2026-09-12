import { redirect } from "next/navigation";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { NavLinks } from "@/components/nav-links";
import { createPost } from "./posts/actions";
import { DryRunBanner } from "@/components/dry-run-banner";
import { signOut } from "./actions";
import { Strip } from "./strip";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The signed-in shell. The proxy already redirects anonymous visitors,
 * but this checks again: the proxy can be bypassed by a misconfigured
 * matcher, and a layout guard cannot be.
 *
 * A SIDEBAR, like HQ. Sections sit still in the corner of the eye instead of
 * competing with the page's own heading for the top of the screen — and on a
 * wide monitor the width is there anyway. Below `md` it folds back to a row,
 * because a fixed sidebar on a phone is just a smaller phone.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const supabase = await supabaseServer();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("dry_run, ig_username")
    .single();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="md:flex">
        <aside className="border-b border-stone-200 px-4 py-3 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r md:px-4 md:py-6 dark:border-stone-800">
          <div className="flex items-center gap-4 md:block">
            <span className="font-display shrink-0 text-base md:mb-6 md:block md:px-3">
              Scheduler
            </span>

            <div className="min-w-0 flex-1 md:mt-0">
              <NavLinks />
            </div>
          </div>

          {/* Pinned to the bottom of the sidebar on a wide screen: the thought
              "I should post that" arrives while looking at photos, nowhere
              near a button, so it has to be reachable from every page. */}
          <div className="mt-4 hidden md:absolute md:inset-x-4 md:bottom-6 md:mt-0 md:block">
            <form action={createPost}>
              <button
                type="submit"
                className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
              >
                New post
              </button>
            </form>

            <div className="mt-3 px-3">
              <ThemeToggle />
            </div>

            <form action={signOut} className="mt-3 px-3">
              <button
                type="submit"
                className="text-xs text-stone-400 transition hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        {/* Reference, beside the work rather than instead of it. Lives here
            so it is fetched once and survives moving between pages. */}
        <Strip />

        <div className="min-w-0 flex-1">
          {settings?.dry_run !== false && <DryRunBanner />}

          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>

          {/* The same controls, for the narrow layout where the sidebar is a
              row. The theme toggle matters most here: a phone is where the
              device's own setting is most likely to disagree with you. */}
          <div className="flex items-center gap-4 px-6 pb-8 md:hidden">
            <div className="order-last ml-auto">
              <ThemeToggle />
            </div>

            <form action={createPost}>
              <button
                type="submit"
                className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900"
              >
                New post
              </button>
            </form>

            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-stone-400 dark:text-stone-500"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
