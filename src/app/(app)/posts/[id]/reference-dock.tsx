"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { NOTEBOOK_LABELS, type Notebook } from "@/lib/notebooks";
import { loadReference, type Reference } from "./reference-actions";

/**
 * Your notes, beside the caption you are writing.
 *
 * Writing a caption means looking at something you jotted down days ago, and
 * until now that meant leaving the composer, finding it, remembering it, and
 * coming back — with unsaved work sitting behind a "leave site?" prompt. So
 * the notes come to the composer instead.
 *
 * IT SPLITS THE PAGE rather than floating over it. An overlay would cover the
 * caption, which is the one thing that must stay visible: the entire point is
 * reading the note and the caption at the same time.
 *
 * Read-only here. Editing the same notebook in two places invites the question
 * of which copy wins, and the Notes page already does it properly — so this
 * shows, selects and inserts, and links there for writing.
 *
 * Everything it inserts is the owner's own writing, moved from one box to
 * another. Nothing here composes anything.
 */

/*
 * Whether the panel is open, remembered per browser.
 *
 * Kept outside React rather than read into state in an effect. The page is
 * rendered on the server, where there is no localStorage, so an effect that
 * read the preference and then set state would render the panel closed for a
 * frame and snap it open. Subscribing to the value instead means the server
 * renders "closed", the browser's first paint already knows better, and there
 * is no flicker to explain.
 */
const KEY = "composer-reference";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "open";
  } catch {
    // A browser set to block site data throws on the read itself. Closed is
    // the right default, and the panel still opens for this visit.
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

export function ReferenceDock({ children }: { children: React.ReactNode }) {
  // Closed on the server, because the server cannot know; the browser's own
  // answer arrives before the first paint.
  const open = useSyncExternalStore(subscribe, isOpen, () => false);

  const [tab, setTab] = useState<Notebook>("idea_bank");
  const [data, setData] = useState<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await loadReference();
    if (result.error) setError(result.error);
    else setData(result.data ?? null);

    setLoading(false);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);

    // Fetched the first time it is opened, and kept for the rest of the visit.
    if (next && !data && !loading) void load();
  };

  if (!open) {
    return (
      <div>
        {children}

        <button
          type="button"
          onClick={toggle}
          className="fixed right-0 top-1/3 z-20 rounded-l-md border border-r-0 border-stone-300 bg-white px-2 py-3 text-xs font-medium text-stone-600 shadow-sm transition hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          style={{ writingMode: "vertical-rl" }}
          title="Show your notes beside the caption"
        >
          Notes
        </button>
      </div>
    );
  }

  const html = data?.[tab] ?? "";

  return (
    <div className="lg:flex lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1">{children}</div>

      <aside className="mt-5 w-full shrink-0 lg:sticky lg:top-20 lg:mt-0 lg:w-80">
        <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-1 border-b border-stone-200 px-2 py-2 dark:border-stone-800">
            <Tab current={tab} value="idea_bank" onSelect={setTab}>
              {NOTEBOOK_LABELS.idea_bank}
            </Tab>
            <Tab current={tab} value="strategy" onSelect={setTab}>
              {NOTEBOOK_LABELS.strategy}
            </Tab>

            <button
              type="button"
              onClick={toggle}
              className="ml-auto rounded px-2 py-1 text-xs text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Hide
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3 lg:max-h-[calc(100vh-14rem)]">
            {loading && (
              <p className="py-6 text-center text-xs text-stone-500 dark:text-stone-400">
                Loading…
              </p>
            )}

            {error && (
              <p className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error}{" "}
                <button type="button" onClick={() => void load()} className="underline">
                  Try again
                </button>
              </p>
            )}

            {!loading && !error && data && <Lines html={html} />}
          </div>

          <div className="border-t border-stone-200 px-3 py-2 dark:border-stone-800">
            <Link
              href="/ideas"
              className="text-xs text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
            >
              Edit on the Notes page →
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Tab({
  current,
  value,
  onSelect,
  children,
}: {
  current: Notebook;
  value: Notebook;
  onSelect: (value: Notebook) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-current={current === value ? "true" : undefined}
      className={
        current === value
          ? "rounded bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
          : "rounded px-2.5 py-1 text-xs text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      }
    >
      {children}
    </button>
  );
}

/**
 * The notebook, one block at a time, each one insertable on its own.
 *
 * A whole notebook is the wrong unit: a caption borrows one line from it, not
 * the lot. Splitting on block boundaries means every paragraph and every
 * bullet is its own thing to take, which is how the idea bank is used —
 * scanning for the one line that fits this photo.
 */
function Lines({ html }: { html: string }) {
  const blocks = toBlocks(html);

  if (blocks.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-stone-500 dark:text-stone-400">
        Nothing written here yet.{" "}
        <Link href="/ideas" className="underline underline-offset-2">
          Start it
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {blocks.map((block, index) => (
        <li key={index}>
          <button
            type="button"
            onClick={() => insert(block)}
            title="Click to put this in the caption"
            className="w-full rounded px-2 py-1.5 text-left text-xs leading-relaxed text-stone-700 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            {block}
          </button>
        </li>
      ))}
    </ul>
  );
}

/*
 * Put the text into the caption where the cursor is.
 *
 * Sent as an event rather than wired through props: the caption lives deep
 * inside the composer's own state, and threading a callback up through it
 * would mean rebuilding how that component is put together for one button.
 */
function insert(text: string) {
  window.dispatchEvent(new CustomEvent("caption:insert", { detail: text }));
}

/**
 * A notebook's blocks as plain text.
 *
 * Captions are plain text — Instagram strips formatting — so the markup has
 * to come off before anything is inserted, or tags would land in the caption.
 *
 * THE BROWSER DOES THE PARSING. Stripping tags and unpicking entities by hand
 * looks like six replaces and is not: an em dash typed into the notebook came
 * out as the literal text "&mdash;", because the list of entities to undo is
 * long and I had written six of them. `textContent` knows all of it, and is
 * the same parser that produced the markup in the first place.
 */
function toBlocks(html: string): string[] {
  if (!html.trim()) return [];

  // Only ever runs in the browser: the panel's content arrives from an action
  // the reader triggered, so there is nothing to render on the server.
  if (typeof document === "undefined") return [];

  const root = document.createElement("div");
  root.innerHTML = html;

  const blocks = root.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote");

  // A notebook with no block tags at all — a bare line of text — is still one
  // block worth offering.
  if (blocks.length === 0) {
    const text = root.textContent?.trim() ?? "";
    return text ? [text] : [];
  }

  return [...blocks]
    .map((block) => block.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
}
