"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Toolbar } from "./toolbar";
import { TypingShortcuts } from "./typing-shortcuts";
import { saveNotebook } from "./actions";
// Aliased: the component below is also called Notebook, which is the right
// name for both and only a problem if they collide.
import type { Notebook as Kind } from "@/lib/notebooks";

/**
 * One notebook: a rich-text box that saves itself.
 *
 * Deliberately rich text, unlike captions. An Instagram caption is plain text
 * and the composer says so, but thinking wants headings, bold and lists —
 * and keeping the two visibly different avoids writing a caption here and
 * wondering where the formatting went.
 *
 * SAVING IS AUTOMATIC, a second and a half after you stop typing. There is no
 * save button and no unsaved state to lose, because a notebook is scratch
 * paper: the thing that must never happen is closing the tab and finding the
 * thought gone.
 */
export function Notebook({
  kind,
  label,
  html,
}: {
  kind: Kind;
  label: string;
  html: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the debounce can be cleared without re-running anything,
  // and so a pending save survives a re-render.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (nextHtml: string, json: unknown) => {
      setState("saving");

      const result = await saveNotebook(kind, nextHtml, json);

      if (result.error) {
        setError(result.error);
        setState("error");
        return;
      }

      setError(null);
      setState("saved");
    },
    [kind],
  );

  const editor = useEditor({
    /*
     * StarterKit already carries bold, italic, underline, strike, headings,
     * quotes, lists, rules and links. Highlight and checkboxes are the two
     * HQ has that it does not.
     */
    extensions: [
      StarterKit,
      Highlight,
      TypingShortcuts,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: html,
    // Rendering the editor on the server produces markup React then has to
    // reconcile against what ProseMirror builds, which warns and can drop
    // content. It is a client-only surface by nature.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          [
            "max-w-none min-h-[18rem] p-4 text-sm leading-relaxed outline-none",
            "[&_h1]:font-display [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg first:[&_h1]:mt-0",
            "[&_h2]:font-display [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-base first:[&_h2]:mt-0",
            "[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold",
            "[&_p]:mb-2.5",
            "[&_ul]:mb-2.5 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:mb-2.5 [&_ol]:ml-5 [&_ol]:list-decimal",
            // Tiptap wraps each list item in its own <p>, so a bullet was
            // paying the paragraph margin AND the list margin — a full blank
            // line between items that no list wants.
            "[&_li]:mb-0.5 [&_li>p]:mb-0",
            // A nested list should not open a gap above itself either.
            "[&_li>ul]:mt-0.5 [&_li>ul]:mb-0 [&_li>ol]:mt-0.5 [&_li>ol]:mb-0",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-stone-500 dark:[&_blockquote]:border-stone-700 dark:[&_blockquote]:text-stone-400",
            "[&_hr]:my-4 [&_hr]:border-stone-200 dark:[&_hr]:border-stone-800",
            "[&_mark]:rounded-sm [&_mark]:bg-amber-300/60 [&_mark]:px-0.5 [&_mark]:text-inherit",
            "[&_a]:text-stone-900 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-stone-100",
            "[&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:text-[0.9em] dark:[&_code]:bg-stone-800",
            // Checkboxes: the marker is the box, so the bullet has to go.
            "[&_ul[data-type=taskList]]:ml-0 [&_ul[data-type=taskList]]:list-none",
            "[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2",
            "[&_li[data-type=taskItem]_input]:mt-1 [&_li[data-type=taskItem]_input]:accent-emerald-600",
          ].join(" "),
      },
    },
    onUpdate: ({ editor: instance }) => {
      setState("idle");

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void save(instance.getHTML(), instance.getJSON());
      }, 1500);
    },
  });

  /*
   * Write whatever is pending before the tab goes away.
   *
   * The debounce means the last second and a half of typing is only in the
   * browser, and closing a tab is exactly when someone has just finished a
   * thought. Not a guarantee — a browser may kill the request as the page
   * goes — but it turns "always lost" into "almost always saved", and
   * navigating within the app (the common case) flushes cleanly on unmount.
   */
  useEffect(() => {
    const flush = () => {
      if (!timer.current || !editor) return;

      clearTimeout(timer.current);
      timer.current = null;
      void save(editor.getHTML(), editor.getJSON());
    };

    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [editor, save]);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base">{label}</h2>

        <span
          className={
            state === "error"
              ? "shrink-0 text-xs text-red-700 dark:text-red-400"
              : "shrink-0 text-xs text-stone-400 dark:text-stone-500"
          }
        >
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved"}
          {state === "error" && (error ?? "Could not save")}
        </span>
      </div>

      {/*
        NO `overflow-hidden` HERE, however much the rounded corners want it.

        An ancestor with `overflow: hidden` becomes the scroll container that a
        sticky child sticks inside — so the toolbar was pinned to the top of
        this box, which does not scroll, and therefore never moved at all. It
        looked exactly like sticky being ignored.

        The corners are kept by rounding the toolbar's own top edge instead.
      */}
      <div className="mt-2 rounded-lg border border-stone-300 bg-white focus-within:border-stone-500 dark:border-stone-700 dark:bg-stone-950">
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
