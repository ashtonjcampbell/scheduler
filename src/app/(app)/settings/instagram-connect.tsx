"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";
import { saveMetaCredentials, disconnectInstagram, setDryRun } from "./actions";

/**
 * Connecting the Instagram account.
 *
 * The credentials go in here but can never be read back — app_secrets has no
 * access policies, so the browser can write to it and only the worker can read
 * it. That is why the secret field shows a placeholder rather than the value.
 */
export function InstagramConnect({
  settings,
  hasCredentials,
  appId,
  notice,
}: {
  settings: AppSettings;
  hasCredentials: boolean;
  appId: string | null;
  notice: { error?: string; connected?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [id, setId] = useState(appId ?? "");
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(!hasCredentials);

  const connected = Boolean(settings.ig_user_id);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Instagram</h2>

      {notice.connected && (
        <p className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Connected to @{notice.connected}.
        </p>
      )}

      {notice.error && (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {notice.error}
        </p>
      )}

      {connected ? (
        <div className="mt-2 space-y-1 text-sm">
          <p>
            Posting to <strong>@{settings.ig_username}</strong>
            {settings.ig_page_name && (
              <span className="text-stone-500 dark:text-stone-400">
                {" "}
                via the {settings.ig_page_name} Page
              </span>
            )}
          </p>
          {settings.ig_connected_at && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Connected {formatPacific(settings.ig_connected_at)}
              {settings.ig_token_expires_at &&
                ` · access expires ${formatPacific(settings.ig_token_expires_at)}, renewed weekly`}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Not connected. Everything still works — posts are simulated and
          logged rather than published.
        </p>
      )}

      {/* --- credentials --------------------------------------------------- */}
      <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
        {editing ? (
          <div className="space-y-2">
            <p className="text-xs text-stone-500 dark:text-stone-400">
              From your Meta app, under App settings → Basic.
            </p>

            <label className="block text-xs">
              <span className="text-stone-500 dark:text-stone-400">App ID</span>
              <input
                value={id}
                onChange={(event) => setId(event.target.value)}
                inputMode="numeric"
                placeholder="1714411816322299"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-stone-700 dark:bg-stone-950"
              />
            </label>

            <label className="block text-xs">
              <span className="text-stone-500 dark:text-stone-400">App Secret</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder={hasCredentials ? "•••••••• (already saved)" : ""}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-stone-700 dark:bg-stone-950"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending || !id || !secret}
                onClick={() =>
                  run(async () => {
                    const result = await saveMetaCredentials(id, secret);
                    if (!result.error) {
                      setSecret("");
                      setEditing(false);
                    }
                    return result;
                  })
                }
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
              >
                Save credentials
              </button>

              {hasCredentials && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-xs text-stone-500"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-stone-500 dark:text-stone-400">
              App ID {appId} · secret saved
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
            >
              Change
            </button>
          </div>
        )}
      </div>

      {/* --- connect ------------------------------------------------------- */}
      {hasCredentials && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href="/api/auth/instagram/start"
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-900"
          >
            {connected ? "Reconnect" : "Connect Instagram"}
          </a>

          {connected && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("Disconnect Instagram? Dry run will be switched back on.")) {
                  run(() => disconnectInstagram());
                }
              }}
              className="text-xs text-red-600 hover:underline dark:text-red-400"
            >
              Disconnect
            </button>
          )}
        </div>
      )}

      {/* --- dry run ------------------------------------------------------- */}
      <div
        className={
          settings.dry_run
            ? "mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950"
            : "mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950"
        }
      >
        <p
          className={
            settings.dry_run
              ? "text-xs text-amber-900 dark:text-amber-200"
              : "text-xs text-emerald-900 dark:text-emerald-200"
          }
        >
          {settings.dry_run ? (
            <>
              <strong>Dry run is on.</strong> Posts are simulated and written to
              the log; nothing reaches Instagram.
            </>
          ) : (
            <>
              <strong>Live.</strong> Scheduled posts publish to Instagram for
              real.
            </>
          )}
        </p>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (settings.dry_run) {
              if (
                confirm(
                  "Turn dry run OFF? Scheduled posts will start publishing to Instagram for real.",
                )
              ) {
                run(() => setDryRun(false));
              }
            } else {
              run(() => setDryRun(true));
            }
          }}
          className="mt-2 rounded-lg border border-stone-400 bg-white px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900"
        >
          {settings.dry_run ? "Go live" : "Back to dry run"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
