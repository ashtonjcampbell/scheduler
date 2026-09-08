"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/database.types";
import { updateSettings } from "./actions";

export function GeneralSettings({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [min, setMin] = useState(settings.hashtag_min);
  const [max, setMax] = useState(settings.hashtag_max);
  const [archive, setArchive] = useState(settings.archive_published_after_days);
  const [originals, setOriginals] = useState(settings.keep_originals_days);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateSettings({
        hashtag_min: min,
        hashtag_max: max,
        archive_published_after_days: archive,
        keep_originals_days: originals,
      });
      if (result.error) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Preferences</h2>

      <div className="mt-3 space-y-4">
        <div>
          <p className="text-sm font-medium">Hashtags per post</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            A nudge, not a rule. Instagram&apos;s hard limit is 30 either way.
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={30}
              value={min}
              onChange={(event) => setMin(Number(event.target.value))}
              className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
            />
            <span className="text-stone-500">to</span>
            <input
              type="number"
              min={0}
              max={30}
              value={max}
              onChange={(event) => setMax(Number(event.target.value))}
              className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Keep originals for</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            How long a photo can still be re-cropped without re-compressing it.
            0 keeps originals forever, at the cost of storage.
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={365}
              value={originals}
              onChange={(event) => setOriginals(Number(event.target.value))}
              className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
            />
            <span className="text-stone-500">days</span>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Drop full-size files after posting</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Once a post has been live this long, its full-size file is removed
            and the thumbnail kept — Instagram has its own copy by then. 0
            keeps everything.
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={365}
              value={archive}
              onChange={(event) => setArchive(Number(event.target.value))}
              className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
            />
            <span className="text-stone-500">days after publishing</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>

        {saved && <span className="text-xs text-stone-500 dark:text-stone-400">Saved</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </section>
  );
}
