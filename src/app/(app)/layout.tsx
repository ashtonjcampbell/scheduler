import { redirect } from "next/navigation";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { NavLinks } from "@/components/nav-links";
import { createPost } from "./posts/actions";
import { DryRunBanner } from "@/components/dry-run-banner";
import { signOut } from "./actions";

/**
 * The signed-in shell. The proxy already redirects anonymous visitors,
 * but this checks again: the proxy can be bypassed by a misconfigured
 * matcher, and a layout guard cannot be.
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
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/85 backdrop-blur dark:border-stone-800 dark:bg-stone-950/85">
        {/* A fixed height, not padding: anything else that pins itself below
            this bar needs to know exactly how tall it is. */}
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <span className="text-sm font-semibold tracking-tight">Scheduler</span>

          <NavLinks />

          {/* In the sticky bar rather than on the Posts page, because the
              thought "I should post that" arrives while looking at photos,
              three screens down, nowhere near a button. */}
          <form action={createPost} className="ml-auto">
            <button
              type="submit"
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              New post
            </button>
          </form>

          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-stone-500 transition hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {settings?.dry_run !== false && <DryRunBanner />}

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
