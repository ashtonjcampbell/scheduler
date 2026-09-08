"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TRASH_RETENTION_DAYS } from "@/lib/photos";
import { emptyTrash } from "./actions";

export function TrashHeader({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Photos here can be put back. They&apos;re removed for good after{" "}
        {TRASH_RETENTION_DAYS} days, and they keep using storage until then.
      </p>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              `Permanently delete ${count} photo${count === 1 ? "" : "s"}? This cannot be undone.`,
            )
          ) {
            return;
          }

          setError(null);
          startTransition(async () => {
            const result = await emptyTrash();
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}
        className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "Emptying…" : "Empty trash"}
      </button>

      {error && (
        <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
