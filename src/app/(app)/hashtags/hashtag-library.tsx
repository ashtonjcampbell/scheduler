"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Hashtag, HashtagCategory } from "@/lib/database.types";
import { AddTags } from "./add-tags";
import { CategoryManager } from "./category-manager";
import {
  setTagActive,
  deleteTag,
  updateTag,
  updateMany,
  deleteMany,
} from "./actions";

type Filter = "all" | "active" | "retired";

export function HashtagLibrary({
  categories,
  tags,
}: {
  categories: HashtagCategory[];
  tags: Hashtag[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return tags.filter((tag) => {
      if (needle && !tag.tag.toLowerCase().includes(needle)) return false;
      if (category === "uncategorised" && tag.category_id !== null) return false;
      if (category !== "all" && category !== "uncategorised" && tag.category_id !== category) {
        return false;
      }
      if (filter === "active" && !tag.active) return false;
      if (filter === "retired" && tag.active) return false;
      return true;
    });
  }, [tags, search, category, filter]);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeCount = tags.filter((t) => t.active).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <AddTags categories={categories} />
        <CategoryManager categories={categories} tags={tags} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tags"
          className="w-48 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
        />

        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({tags.filter((t) => t.category_id === c.id).length})
            </option>
          ))}
          <option value="uncategorised">
            Uncategorised ({tags.filter((t) => t.category_id === null).length})
          </option>
        </select>

        <div className="flex rounded-lg border border-stone-300 p-0.5 dark:border-stone-700">
          {(["all", "active", "retired"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={
                filter === value
                  ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                  : "rounded-md px-2.5 py-1 text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }
            >
              {value === "all" ? "All" : value === "active" ? "In use" : "Retired"}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-stone-500 dark:text-stone-400">
          {visible.length} shown · {activeCount} in use · {tags.length} total
        </span>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-xs dark:border-stone-700 dark:bg-stone-900">
          <span className="font-medium">{selected.size} selected</span>

          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateMany([...selected], { active: false }))}
            className="rounded px-2 py-1 hover:bg-stone-200 disabled:opacity-50 dark:hover:bg-stone-800"
          >
            Retire
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateMany([...selected], { active: true }))}
            className="rounded px-2 py-1 hover:bg-stone-200 disabled:opacity-50 dark:hover:bg-stone-800"
          >
            Bring back
          </button>

          <select
            disabled={pending}
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              run(() =>
                updateMany([...selected], {
                  category_id: value === "none" ? null : value,
                }),
              );
              event.target.value = "";
            }}
            className="rounded border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
          >
            <option value="">Move to…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Uncategorised</option>
          </select>

          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Permanently delete ${selected.size} tag(s)?`)) {
                run(() => deleteMany([...selected]));
              }
            }}
            className="ml-auto rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          {tags.length === 0 ? "No tags yet — add some above." : "Nothing matches."}
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {visible.map((tag) => (
            <li
              key={tag.id}
              className={
                tag.active
                  ? "flex flex-wrap items-center gap-3 bg-white px-3 py-2 text-sm dark:bg-stone-900"
                  : "flex flex-wrap items-center gap-3 bg-stone-50 px-3 py-2 text-sm dark:bg-stone-950"
              }
            >
              <input
                type="checkbox"
                checked={selected.has(tag.id)}
                onChange={() => toggle(tag.id)}
                aria-label={`Select ${tag.tag}`}
                className="accent-stone-900 dark:accent-stone-100"
              />

              <span
                className={
                  tag.active
                    ? "font-medium"
                    : "font-medium text-stone-400 line-through dark:text-stone-600"
                }
              >
                #{tag.tag}
              </span>

              <span className="text-xs text-stone-500 dark:text-stone-400">
                {tag.category_id
                  ? (categoryName.get(tag.category_id) ?? "—")
                  : "uncategorised"}
              </span>

              <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
                {tag.post_count === null ? "—" : formatVolume(tag.post_count)}
              </span>

              {tag.notes && (
                <span
                  className="max-w-xs truncate text-xs italic text-stone-400 dark:text-stone-500"
                  title={tag.notes}
                >
                  {tag.notes}
                </span>
              )}

              <div className="ml-auto flex items-center gap-2 text-xs">
                <select
                  disabled={pending}
                  value={tag.category_id ?? "none"}
                  onChange={(event) =>
                    run(() =>
                      updateTag(tag.id, {
                        category_id:
                          event.target.value === "none" ? null : event.target.value,
                      }),
                    )
                  }
                  className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs dark:border-stone-700 dark:bg-stone-950"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="none">uncategorised</option>
                </select>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setTagActive(tag.id, !tag.active))}
                  className="text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  {tag.active ? "Retire" : "Bring back"}
                </button>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Permanently delete #${tag.tag}?`)) {
                      run(() => deleteTag(tag.id));
                    }
                  }}
                  className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 2,700,000 reads far quicker as 2.7M when scanning a list. */
function formatVolume(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}
