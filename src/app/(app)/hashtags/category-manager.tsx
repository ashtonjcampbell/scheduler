"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Hashtag, HashtagCategory } from "@/lib/database.types";
import { addCategory, renameCategory, deleteCategory } from "./actions";

export function CategoryManager({
  categories,
  tags,
}: {
  categories: HashtagCategory[];
  tags: Hashtag[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  };

  const countIn = (id: string) => tags.filter((t) => t.category_id === id).length;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-sm font-semibold">Categories</h2>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        What the shuffle draws from. Deleting one keeps its tags — they just
        become uncategorised.
      </p>

      <form
        className="mt-3 flex gap-2"
        action={() => {
          if (!name.trim()) return;
          run(async () => {
            const result = await addCategory(name);
            if (!result.error) setName("");
            return result;
          });
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New category"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium transition hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Add
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <ul className="mt-3 space-y-1">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center gap-2 text-sm">
            {editing === category.id ? (
              <form
                className="flex flex-1 gap-1"
                action={(formData) =>
                  run(() =>
                    renameCategory(category.id, String(formData.get("name") ?? "")),
                  )
                }
              >
                <input
                  name="name"
                  defaultValue={category.name}
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-sm dark:border-stone-700 dark:bg-stone-950"
                />
                <button type="submit" disabled={pending} className="text-xs font-medium">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="text-xs text-stone-500"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="flex-1 truncate">{category.name}</span>
                <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
                  {countIn(category.id)}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(category.id)}
                  className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const count = countIn(category.id);
                    const warning = count
                      ? `Delete "${category.name}"? Its ${count} tag${count === 1 ? "" : "s"} will become uncategorised.`
                      : `Delete "${category.name}"?`;
                    if (confirm(warning)) run(() => deleteCategory(category.id));
                  }}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  Delete
                </button>
              </>
            )}
          </li>
        ))}

        {categories.length === 0 && (
          <li className="text-xs text-stone-500 dark:text-stone-400">
            No categories yet.
          </li>
        )}
      </ul>
    </div>
  );
}
