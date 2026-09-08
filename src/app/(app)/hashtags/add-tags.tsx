"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HashtagCategory } from "@/lib/database.types";
import { addTags, type AddResult } from "./actions";

/**
 * Paste in tags, however they happen to be formatted.
 *
 * The point is to lower the cost of growing the library: a tag spotted mid-post
 * should take seconds to save, and an existing set copied out of a note should
 * paste in whole rather than needing to be reformatted first.
 */
export function AddTags({ categories }: { categories: HashtagCategory[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [block, setBlock] = useState("");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [result, setResult] = useState<AddResult | null>(null);

  const submit = () => {
    if (!block.trim()) return;

    setResult(null);
    startTransition(async () => {
      const outcome = await addTags(block, categoryId === "none" ? null : categoryId);
      setResult(outcome);

      // Keep anything that failed so it can be fixed in place; clear the rest.
      if (!outcome.error) {
        setBlock(outcome.rejected.map((r) => r.input).join(" "));
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Add tags</h2>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        One or many. Spaces, commas or new lines all work, with or without the #.
      </p>

      <textarea
        value={block}
        onChange={(event) => setBlock(event.target.value)}
        onKeyDown={(event) => {
          // Enter submits; Shift+Enter for a new line, as in most chat boxes.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="#mtbaker #northcascades pnwelopement"
        className="mt-3 w-full rounded-lg border border-stone-300 bg-white p-2 font-mono text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950"
        >
          <option value="none">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={submit}
          disabled={pending || !block.trim()}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      {result && <Outcome result={result} />}
    </div>
  );
}

function Outcome({ result }: { result: AddResult }) {
  if (result.error) {
    return (
      <p className="mt-3 text-xs text-red-600 dark:text-red-400">{result.error}</p>
    );
  }

  return (
    <div className="mt-3 space-y-1 text-xs">
      {result.added > 0 && (
        <p className="text-emerald-700 dark:text-emerald-400">
          Added {result.added} tag{result.added === 1 ? "" : "s"}.
        </p>
      )}

      {result.duplicates.length > 0 && (
        <p className="text-stone-500 dark:text-stone-400">
          Already in the library: {result.duplicates.map((t) => `#${t}`).join(" ")}
        </p>
      )}

      {result.rejected.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          Left in the box to fix —{" "}
          {result.rejected.map((r) => `${r.input} (${r.error.toLowerCase()})`).join(", ")}
        </p>
      )}

      {result.added === 0 && result.duplicates.length === 0 && result.rejected.length === 0 && (
        <p className="text-stone-500 dark:text-stone-400">Nothing to add.</p>
      )}
    </div>
  );
}
