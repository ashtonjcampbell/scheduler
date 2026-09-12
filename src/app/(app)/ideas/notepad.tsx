"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
    extensions: [StarterKit],
    content: html,
    // Rendering the editor on the server produces markup React then has to
    // reconcile against what ProseMirror builds, which warns and can drop
    // content. It is a client-only surface by nature.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-sm max-w-none min-h-[18rem] p-4 text-sm leading-relaxed outline-none [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2",
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

      <div className="mt-2 overflow-hidden rounded-lg border border-stone-300 bg-white focus-within:border-stone-500 dark:border-stone-700 dark:bg-stone-950">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
