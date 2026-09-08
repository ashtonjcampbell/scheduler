"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Note } from "@/lib/database.types";
import { formatPacific } from "@/lib/time";
import { saveNote, deleteNote } from "./actions";

/**
 * The freeform notepad.
 *
 * Deliberately rich text, unlike captions: Instagram captions are plain text
 * and the composer says so, but a running idea dump wants headings, bold and
 * lists. Keeping the two visibly different avoids writing a caption here and
 * wondering why the formatting vanished.
 */
export function Notepad({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  const active = notes.find((n) => n.id === activeId) ?? null;

  const [title, setTitle] = useState(active?.title ?? "Untitled");
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: active?.content_html ?? "",
    // Rendering the editor on the server produces markup React then has to
    // reconcile against what ProseMirror builds, which warns and can drop
    // content. It is a client-only surface by nature.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-sm max-w-none min-h-40 rounded-lg border border-stone-300 bg-white p-3 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950",
      },
    },
    onUpdate: () => setDirty(true),
  });

  /*
   * Switching notes is a click, not a side effect of rendering — so it is
   * handled here rather than in an effect that watches `activeId`. Syncing
   * editor content from an effect also fights the editor: it would overwrite
   * unsaved typing every time the parent re-rendered.
   */
  const selectNote = (note: Note | null) => {
    setActiveId(note?.id ?? null);
    setTitle(note?.title ?? "Untitled");
    editor?.commands.setContent(note?.content_html ?? "");
    setDirty(false);
  };

  const save = () => {
    if (!editor) return;

    setError(null);
    startTransition(async () => {
      const result = await saveNote(activeId, title, editor.getHTML(), editor.getJSON());
      if (result.error) setError(result.error);
      else {
        setActiveId(result.id ?? null);
        setDirty(false);
        router.refresh();
      }
    });
  };

  const startNew = () => selectNote(null);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Notepad</h2>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          Bold, italic and lists — unlike captions, which Instagram keeps plain
        </span>
      </div>

      {notes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => selectNote(note)}
              className={
                note.id === activeId
                  ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                  : "rounded-md border border-stone-300 px-2.5 py-1 text-xs dark:border-stone-700"
              }
            >
              {note.title}
            </button>
          ))}
          <button
            type="button"
            onClick={startNew}
            className={
              activeId === null
                ? "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                : "rounded-md border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-500 dark:border-stone-700"
            }
          >
            + New
          </button>
        </div>
      )}

      <input
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setDirty(true);
        }}
        placeholder="Note title"
        className="mt-3 w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
      />

      {editor && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Tool editor={editor} action="toggleBold" name="bold" label="B" title="Bold" />
          <Tool editor={editor} action="toggleItalic" name="italic" label="I" title="Italic" />
          <Tool editor={editor} action="toggleStrike" name="strike" label="S" title="Strikethrough" />
          <Tool editor={editor} action="toggleBulletList" name="bulletList" label="• List" title="Bulleted list" />
          <Tool editor={editor} action="toggleOrderedList" name="orderedList" label="1. List" title="Numbered list" />
          <Tool editor={editor} action="toggleBlockquote" name="blockquote" label="❝" title="Quote" />
        </div>
      )}

      <div className="mt-2">
        <EditorContent editor={editor} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !editor}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {pending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>

        {active && (
          <span className="text-xs text-stone-400 dark:text-stone-500">
            Updated {formatPacific(active.updated_at)}
          </span>
        )}

        {active && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete "${active.title}"?`)) {
                startTransition(async () => {
                  const result = await deleteNote(active.id);
                  if (result.error) setError(result.error);
                  else {
                    setActiveId(null);
                    startNew();
                    router.refresh();
                  }
                });
              }
            }}
            className="ml-auto text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Delete note
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

type Editor = NonNullable<ReturnType<typeof useEditor>>;

function Tool({
  editor,
  action,
  name,
  label,
  title,
}: {
  editor: Editor;
  action: "toggleBold" | "toggleItalic" | "toggleStrike" | "toggleBulletList" | "toggleOrderedList" | "toggleBlockquote";
  name: string;
  label: string;
  title: string;
}) {
  const on = editor.isActive(name);

  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={() => editor.chain().focus()[action]().run()}
      className={
        on
          ? "rounded border border-stone-900 bg-stone-900 px-2 py-0.5 text-xs text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
          : "rounded border border-stone-300 px-2 py-0.5 text-xs dark:border-stone-700"
      }
    >
      {label}
    </button>
  );
}
