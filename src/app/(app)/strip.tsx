"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatPacific } from "@/lib/time";
import { NOTEBOOK_LABELS, type Notebook } from "@/lib/notebooks";
import { loadStrip, type StripTile } from "./strip-actions";

/**
 * The grid and your notes, kept beside whatever you are doing.
 *
 * Before this, both were PLACES YOU WENT: to check where a post would land, or
 * to read something you jotted down, you left the post you were writing — with
 * unsaved work sitting behind a "leave site?" prompt. Now they are things you
 * glance at.
 *
 * IT LIVES IN THE SHELL, not in a page. Next keeps a layout mounted while the
 * page inside it changes, so the strip is fetched ONCE, keeps its scroll and
 * its tab, and does not flicker when you open a post. Putting it in the pages
 * instead would have meant every page rendering the grid as well as itself —
 * two pages' work per request, on the budget that is already the thing that
 * breaks.
 *
 * Closed by default, and remembered. It is reference, not furniture: most
 * visits do not need it, and nothing should be paid for until it is asked for.
 */

const KEY = "app-strip";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/*
 * Read straight from storage rather than into state in an effect. The shell
 * renders on the server, where there is no localStorage, so an effect would
 * paint it closed for a frame and then snap it open.
 */
function isOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "open";
  } catch {
    // A browser set to block site data throws on the read itself.
    return false;
  }
}

function setOpen(open: boolean) {
  try {
    window.localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // Not remembered for next time. Still open now, which is what was asked.
  }

  for (const listener of listeners) listener();
}

type Tab = "grid" | Notebook;

export function Strip() {
  // Closed on the server, because the server cannot know; the browser's own
  // answer arrives before the first paint.
  const open = useSyncExternalStore(subscribe, isOpen, () => false);

  const [tab, setTab] = useState<Tab>("grid");
  const [tiles, setTiles] = useState<StripTile[] | null>(null);
  const [notes, setNotes] = useState<Record<Notebook, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await loadStrip();
    if (result.error) setError(result.error);
    else {
      setTiles(result.tiles ?? []);
      setNotes(result.notes ?? null);
    }

    setLoading(false);
  }, []);

  const toggle = () => setOpen(!open);

  /*
   * Fetch whenever it is open and empty — not only when it is opened.
   *
   * Opening it used to be the only thing that loaded it, which worked exactly
   * once. Being open is REMEMBERED, so every later visit rendered the strip
   * with nothing in it and no way to notice: no spinner, no empty state, just
   * a blank column that stayed blank until you closed and reopened it.
   *
   * The condition is what keeps it cheap. It runs on the first render where
   * the strip is open and there is nothing to show, and never again for the
   * rest of the visit — the shell does not remount between pages.
   */
  useEffect(() => {
    /*
     * `set-state-in-effect` is off for this line on purpose.
     *
     * The rule exists to catch state set during render cascading into another
     * render, which is a real bug and not this: this is fetching data the
     * server deliberately did not send, on the one render where it is needed.
     * The alternative the rule wants — deriving it — is not available, because
     * there is nothing to derive it from until the request comes back.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && !tiles && !loading && !error) void load();
  }, [open, tiles, loading, error, load]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        title="Show the grid and your ideas"
        style={{ writingMode: "vertical-rl" }}
        /* Pinned to the right edge of the sidebar, not the window — on the
           window it sat on top of the navigation it is supposed to sit beside.
           `left-56` is the sidebar's own width. */
        className="fixed left-56 top-28 z-20 hidden rounded-r-md border border-l-0 border-stone-300 bg-white px-1.5 py-4 text-xs tracking-wide text-stone-500 shadow-sm transition hover:text-stone-900 md:block dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
      >
        Grid &amp; ideas
      </button>
    );
  }

  /*
   * Sized to the screen rather than to a number.
   *
   * At a fixed 14rem the tiles came out about ninety pixels on a wide monitor
   * — a thumbnail of a thumbnail, too small to judge how two photos sit
   * together, which is the entire reason to look at a grid. It now takes a
   * share of the window, floored so it stays usable on a laptop and capped so
   * it never crowds the work beside it.
   */
  return (
    <aside className="sticky top-0 hidden h-screen w-[clamp(17rem,24vw,32rem)] shrink-0 overflow-y-auto border-r border-stone-200 px-4 py-4 md:block dark:border-stone-800">
      <div className="flex items-center gap-1">
        <Tabber current={tab} value="grid" onSelect={setTab}>
          Grid
        </Tabber>
        <Tabber current={tab} value="idea_bank" onSelect={setTab}>
          Ideas
        </Tabber>
        <Tabber current={tab} value="strategy" onSelect={setTab}>
          Strategy
        </Tabber>

        <button
          type="button"
          onClick={toggle}
          aria-label="Hide the strip"
          className="ml-auto rounded px-1.5 py-1 text-xs text-stone-400 transition hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
        >
          ×
        </button>
      </div>

      <div className="mt-3">
        {loading && (
          <p className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">
            Loading…
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {error}{" "}
            <button type="button" onClick={() => void load()} className="underline">
              Try again
            </button>
          </p>
        )}

        {!loading && !error && tab === "grid" && tiles && <MiniGrid tiles={tiles} />}

        {!loading && !error && tab !== "grid" && notes && (
          <Lines html={notes[tab]} label={NOTEBOOK_LABELS[tab]} />
        )}
      </div>
    </aside>
  );
}

function Tabber({
  current,
  value,
  onSelect,
  children,
}: {
  current: Tab;
  value: Tab;
  onSelect: (value: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
      className={
        current === value
          ? "rounded bg-stone-900 px-2.5 py-1 text-sm text-white dark:bg-stone-100 dark:text-stone-900"
          : "rounded px-2.5 py-1 text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      }
    >
      {children}
    </button>
  );
}

/** The grid, small. Same order as the page: newest first, the way Instagram draws it. */
function MiniGrid({ tiles }: { tiles: StripTile[] }) {
  if (tiles.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">
        Nothing planned yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-0.5">
      {tiles.map((tile) => (
        <Link
          key={tile.id}
          href={`/posts/${tile.id}`}
          title={`${firstLine(tile.caption) ?? "No caption"}${
            tile.ready && tile.at ? ` — ${formatPacific(tile.at)}` : " — draft"
          }`}
          className="relative block aspect-[4/5] overflow-hidden bg-stone-100 dark:bg-stone-950"
        >
          {tile.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tile.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}

          <span
            className={
              tile.ready
                ? "absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-sky-500 ring-1 ring-white/70"
                : "absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-stone-400 ring-1 ring-white/70"
            }
          />
        </Link>
      ))}
    </div>
  );
}

/**
 * A notebook, one block at a time, each one insertable on its own.
 *
 * A whole notebook is the wrong unit — a caption borrows one line from it, not
 * the lot. Splitting on block boundaries makes every paragraph and bullet its
 * own thing to take, which is how the idea bank actually gets used.
 */
function Lines({ html, label }: { html: string; label: string }) {
  const blocks = toBlocks(html);

  if (blocks.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">
        {label} is empty.{" "}
        <Link href="/ideas" className="underline underline-offset-2">
          Start it
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-1">
        {blocks.map((block, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => insert(block)}
              title="Click to put this in the caption"
              className="w-full rounded px-2 py-1.5 text-left text-sm leading-relaxed text-stone-600 transition hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              {block}
            </button>
          </li>
        ))}
      </ul>

      <Link
        href="/ideas"
        className="mt-3 block text-xs text-stone-400 underline-offset-2 hover:underline dark:text-stone-500"
      >
        Edit on the Ideas page →
      </Link>
    </>
  );
}

/*
 * Put the text into the caption where the cursor is.
 *
 * An event rather than a prop: the caption is state deep inside the composer,
 * the strip is in the shell above it, and threading a callback down through a
 * layout for one button is not worth what it costs. The composer listens when
 * it is on screen; nothing happens when it is not.
 */
function insert(text: string) {
  window.dispatchEvent(new CustomEvent("caption:insert", { detail: text }));
}

/**
 * A notebook's blocks as plain text.
 *
 * Captions are plain text — Instagram strips formatting — so the markup comes
 * off before anything is inserted.
 *
 * THE BROWSER DOES THE PARSING. Undoing entities by hand looks like six
 * replaces and is not: an em dash typed into a notebook came out as the
 * literal "&mdash;", because the list is long and I had written six of it.
 * `textContent` knows all of them, and is the same parser that wrote the
 * markup in the first place.
 */
function toBlocks(html: string): string[] {
  if (!html.trim() || typeof document === "undefined") return [];

  const root = document.createElement("div");
  root.innerHTML = html;

  const found = [...root.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote")];

  /*
   * ONE ENTRY PER BLOCK, not one per tag.
   *
   * The editor wraps each list item's text in its own paragraph, so a bullet
   * is both an <li> and a <p> — and matching on both listed every bullet
   * twice. Anything sitting inside another match is therefore dropped: the
   * outer element already carries its text.
   */
  const blocks = found.filter(
    (element) => !found.some((other) => other !== element && other.contains(element)),
  );

  // A notebook with no block tags at all — a bare line — is still one block.
  if (blocks.length === 0) {
    const text = root.textContent?.trim() ?? "";
    return text ? [text] : [];
  }

  return blocks
    .map((block) => block.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
