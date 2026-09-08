import type { AppSettings } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";

/**
 * Connection state. Read-only until phase 6 builds the OAuth callback — the
 * point for now is that dry run is visible and explained, rather than a
 * setting nobody can find.
 */
export function InstagramStatus({ settings }: { settings: AppSettings }) {
  const connected = Boolean(settings.ig_user_id);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Instagram</h2>

      <p className="mt-2 text-sm">
        {connected ? (
          <>
            Connected to <strong>@{settings.ig_username}</strong>
            {settings.ig_connected_at && (
              <span className="text-stone-500 dark:text-stone-400">
                {" "}
                since {formatPacific(settings.ig_connected_at)}
              </span>
            )}
          </>
        ) : (
          <span className="text-stone-600 dark:text-stone-400">
            Not connected yet. Everything works without it — posts are
            simulated and logged rather than published.
          </span>
        )}
      </p>

      {settings.ig_token_expires_at && (
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Access expires {formatPacific(settings.ig_token_expires_at)} — renewed
          automatically each week.
        </p>
      )}

      <div
        className={
          settings.dry_run
            ? "mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        }
      >
        {settings.dry_run ? (
          <>
            <strong>Dry run is on.</strong> Posts are simulated and written to
            the log; nothing reaches Instagram. This stays on until the account
            is connected.
          </>
        ) : (
          <>
            <strong>Live.</strong> Scheduled posts will publish to Instagram for
            real.
          </>
        )}
      </div>
    </section>
  );
}
