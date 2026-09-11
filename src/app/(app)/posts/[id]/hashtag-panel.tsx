"use client";

import { useMemo, useState, useTransition } from "react";
import type { Hashtag, HashtagCategory } from "@/lib/database.types";
import { drawHashtags, rerollOne, type DrawableTag } from "@/lib/shuffle";
import { normaliseTag, parseTagBlock, isValidParse, MAX_HASHTAGS_PER_POST } from "@/lib/hashtags";
import { saveDefaultMix } from "../../hashtags/actions";

export type PickedTag = { tag: string; hashtagId: string | null };

/**
 * The shuffle panel. Draws at random from the photographer's own library —
 * nothing is generated or suggested by a model. Everything it produces is
 * editable afterwards: this is a shortcut, not a constraint.
 */
export function HashtagPanel({
  library,
  categories,
  picked,
  onChange,
  inlineTags,
  guide,
  defaultCounts,
}: {
  library: Hashtag[];
  categories: HashtagCategory[];
  picked: PickedTag[];
  onChange: (tags: PickedTag[]) => void;
  /** Hashtags typed into the caption body — shown so the count makes sense. */
  inlineTags: string[];
  guide: { min: number; max: number };
  /** The saved default mix, so a new post opens ready to shuffle. */
  defaultCounts: Record<string, number>;
}) {
  // Starts at the saved default rather than empty, which is the whole point of
  // having one — the mix is the same on almost every post.
  const [counts, setCounts] = useState<Record<string, number>>(defaultCounts);
  const [savingDefault, startSavingDefault] = useTransition();

  // Held locally as well as passed in: after saving, the prop is stale until
  // the page reloads, and the button would keep offering to save what it just
  // saved.
  const [currentDefault, setCurrentDefault] = useState(defaultCounts);
  const [maxPosts, setMaxPosts] = useState<string>("");
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [oneOff, setOneOff] = useState("");
  const [shortfall, setShortfall] = useState<string | null>(null);

  const pool = useMemo<DrawableTag[]>(
    () =>
      library.map((h) => ({
        id: h.id,
        tag: h.tag,
        category_id: h.category_id,
        post_count: h.post_count,
        active: h.active,
      })),
    [library],
  );

  const byId = useMemo(() => new Map(pool.map((t) => [t.id, t])), [pool]);
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const availableIn = (categoryId: string) =>
    pool.filter((t) => t.active && t.category_id === categoryId).length;

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  // Compared as normalised pairs so {a:2, b:1} and {b:1, a:2} are the same
  // mix — key order in an object means nothing.
  const sameAsDefault = useMemo(() => {
    const flatten = (mix: Record<string, number>) =>
      Object.entries(mix)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, n]) => `${id}:${n}`)
        .join(",");

    return flatten(counts) === flatten(currentDefault) && total > 0;
  }, [counts, currentDefault, total]);

  const setCount = (categoryId: string, value: number) => {
    setCounts((prev) => {
      const next = { ...prev };
      if (value <= 0) delete next[categoryId];
      else next[categoryId] = value;
      return next;
    });
  };

  const shuffle = () => {
    setShortfall(null);

    // Locked tags survive the shuffle; everything else is redrawn.
    const lockedLibraryIds = picked
      .filter((p) => p.hashtagId && locked.has(p.hashtagId))
      .map((p) => p.hashtagId!)
      .filter((id) => byId.has(id));

    const { picked: drawn, shortfalls } = drawHashtags({
      pool,
      counts,
      maxPosts: maxPosts ? Number(maxPosts) : null,
      locked: lockedLibraryIds,
    });

    // One-off tags are the user's own additions, not part of the draw, so a
    // shuffle must never quietly discard them.
    const oneOffs = picked.filter((p) => p.hashtagId === null);

    onChange([...drawn.map((t) => ({ tag: t.tag, hashtagId: t.id })), ...oneOffs]);

    if (shortfalls.length > 0) {
      setShortfall(
        shortfalls
          .map(
            (s) =>
              `${categoryName.get(s.categoryId) ?? "category"}: wanted ${s.wanted}, only ${s.got} available`,
          )
          .join(" · "),
      );
    }
  };

  const reroll = (entry: PickedTag) => {
    if (!entry.hashtagId) return;

    const target = byId.get(entry.hashtagId);
    if (!target) return;

    const current = picked
      .map((p) => (p.hashtagId ? byId.get(p.hashtagId) : null))
      .filter((t): t is DrawableTag => !!t);

    const swapped = rerollOne(current, target, pool, {
      maxPosts: maxPosts ? Number(maxPosts) : null,
    });

    const replacement = swapped.find((t) => !current.some((c) => c.id === t.id));
    if (!replacement) return;

    onChange(
      picked.map((p) =>
        p.hashtagId === entry.hashtagId
          ? { tag: replacement.tag, hashtagId: replacement.id }
          : p,
      ),
    );
  };

  const removeTag = (entry: PickedTag) =>
    onChange(picked.filter((p) => p.tag.toLowerCase() !== entry.tag.toLowerCase()));

  const addOneOff = () => {
    const parsed = parseTagBlock(oneOff).filter(isValidParse);
    if (parsed.length === 0) return;

    const have = new Set(picked.map((p) => p.tag.toLowerCase()));
    const additions: PickedTag[] = [];

    for (const { tag } of parsed) {
      if (have.has(tag.toLowerCase())) continue;

      // A typed tag that happens to be in the library is linked to it, so it
      // is treated as a library tag rather than a duplicate one-off.
      const match = pool.find((t) => t.tag.toLowerCase() === tag.toLowerCase());
      additions.push({ tag: match?.tag ?? tag, hashtagId: match?.id ?? null });
      have.add(tag.toLowerCase());
    }

    onChange([...picked, ...additions]);
    setOneOff("");
  };

  const toggleLock = (hashtagId: string | null) => {
    if (!hashtagId) return;

    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(hashtagId)) next.delete(hashtagId);
      else next.add(hashtagId);
      return next;
    });
  };

  const effectiveCount = picked.length + inlineTags.filter(
    (t) => !picked.some((p) => p.tag.toLowerCase() === t.toLowerCase()),
  ).length;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Hashtags</h2>
        <span
          className={
            effectiveCount > MAX_HASHTAGS_PER_POST
              ? "text-xs font-medium tabular-nums text-red-600 dark:text-red-400"
              : "text-xs tabular-nums text-stone-500 dark:text-stone-400"
          }
        >
          {effectiveCount} · aim {guide.min}–{guide.max}
        </span>
      </div>

      {/* --- the chosen set ------------------------------------------------ */}
      {picked.length === 0 && inlineTags.length === 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          None yet. Shuffle from your library below, or type your own.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {picked.map((entry) => {
            const isLocked = entry.hashtagId ? locked.has(entry.hashtagId) : false;

            return (
              <li
                key={entry.tag.toLowerCase()}
                className={
                  isLocked
                    ? "flex items-center gap-1 rounded-full border border-stone-900 bg-stone-100 py-0.5 pl-2 pr-1 text-xs dark:border-stone-100 dark:bg-stone-800"
                    : "flex items-center gap-1 rounded-full border border-stone-300 py-0.5 pl-2 pr-1 text-xs dark:border-stone-700"
                }
              >
                <span className={entry.hashtagId ? "" : "italic"}>#{entry.tag}</span>

                {entry.hashtagId && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleLock(entry.hashtagId)}
                      title={isLocked ? "Unlock — allow reshuffling" : "Lock — keep through a shuffle"}
                      className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      {isLocked ? "🔒" : "🔓"}
                    </button>
                    <button
                      type="button"
                      onClick={() => reroll(entry)}
                      title="Swap for another from the same category"
                      className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      ↻
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => removeTag(entry)}
                  aria-label={`Remove #${entry.tag}`}
                  className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              </li>
            );
          })}

          {inlineTags
            .filter((t) => !picked.some((p) => p.tag.toLowerCase() === t.toLowerCase()))
            .map((tag) => (
              <li
                key={`inline-${tag.toLowerCase()}`}
                title="Typed in the caption"
                className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400"
              >
                #{tag}
              </li>
            ))}
        </ul>
      )}

      {/* --- type your own ------------------------------------------------- */}
      <div className="mt-3 flex gap-1.5">
        <input
          value={oneOff}
          onChange={(event) => setOneOff(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addOneOff();
            }
          }}
          placeholder="Add your own…"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
        />
        <button
          type="button"
          onClick={addOneOff}
          disabled={!normaliseTag(oneOff)}
          className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium disabled:opacity-40 dark:border-stone-700"
        >
          Add
        </button>
      </div>

      {/* --- shuffle ------------------------------------------------------- */}
      <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Shuffle from library
        </h3>

        <ul className="mt-2 space-y-1">
          {categories.map((category) => {
            const available = availableIn(category.id);
            const value = counts[category.id] ?? 0;

            return (
              <li key={category.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">{category.name}</span>
                <span className="tabular-nums text-stone-400 dark:text-stone-500">
                  {available}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCount(category.id, value - 1)}
                    disabled={value === 0}
                    aria-label={`One fewer from ${category.name}`}
                    className="h-5 w-5 rounded border border-stone-300 disabled:opacity-30 dark:border-stone-700"
                  >
                    −
                  </button>
                  <span className="w-4 text-center tabular-nums">{value}</span>
                  <button
                    type="button"
                    onClick={() => setCount(category.id, value + 1)}
                    disabled={value >= available}
                    aria-label={`One more from ${category.name}`}
                    className="h-5 w-5 rounded border border-stone-300 disabled:opacity-30 dark:border-stone-700"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <label className="mt-3 flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
          Skip tags bigger than
          <input
            type="number"
            value={maxPosts}
            onChange={(event) => setMaxPosts(event.target.value)}
            placeholder="any"
            min={0}
            step={100000}
            className="w-24 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs dark:border-stone-700 dark:bg-stone-950"
          />
          posts
        </label>

        <button
          type="button"
          onClick={shuffle}
          disabled={total === 0}
          className="mt-3 w-full rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {total === 0 ? "Choose how many" : `Shuffle ${total}`}
        </button>

        {shortfall && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{shortfall}</p>
        )}

        <button
          type="button"
          disabled={savingDefault || sameAsDefault}
          onClick={() =>
            startSavingDefault(async () => {
              await saveDefaultMix(counts);
              setCurrentDefault(counts);
            })
          }
          className="mt-2 text-[11px] text-stone-500 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50 dark:text-stone-400"
        >
          {savingDefault
            ? "Saving…"
            : sameAsDefault
              ? "This is your default for new posts"
              : "Make this the default for new posts"}
        </button>

        <p className="mt-2 text-[11px] text-stone-400 dark:text-stone-500">
          Picked at random from your own library. Lock the ones you want to
          keep, then shuffle again.
        </p>
      </div>
    </section>
  );
}
