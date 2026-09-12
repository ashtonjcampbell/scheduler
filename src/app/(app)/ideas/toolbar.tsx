"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

/**
 * Formatting for the notebooks, the same set HQ uses.
 *
 * Deliberately not the caption's toolbar, because a caption has no formatting
 * — Instagram strips it. This is for thinking, where a heading and a bullet
 * are how a pile of half-thoughts becomes something you can scan.
 *
 * WHAT THE BUTTONS SHOW is read through `useEditorState`, which subscribes to
 * the editor's own transactions. Reading `editor.isActive()` during render
 * instead looks like it works and quietly does not: the editor changes without
 * React knowing, so the buttons keep whatever state they had at the last
 * unrelated re-render.
 */
export function Toolbar({ editor }: { editor: Editor | null }) {
  /*
   * Split in two so the hook below never mounts against a null editor.
   *
   * `useEditor` returns null on its first render and the editor on the next.
   * Subscribing with that null subscribed to nothing, and it did not pick the
   * editor up when it arrived — the toolbar simply never appeared, with no
   * error to go on. Mounting Buttons only once there is an editor means the
   * subscription is made against a real one.
   */
  if (!editor) return null;

  return <Buttons editor={editor} />;
}

function Buttons({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            highlight: e.isActive("highlight"),
            heading: e.isActive("heading", { level: 2 }),
            quote: e.isActive("blockquote"),
            bullets: e.isActive("bulletList"),
            numbers: e.isActive("orderedList"),
            checks: e.isActive("taskList"),
            link: e.isActive("link"),
          }
        : null,
  });

  if (!state) return null;

  /*
   * Act on mousedown, not click.
   *
   * Clicking a button takes focus out of the editor first, which collapses the
   * selection — so by the time a click handler runs there is nothing selected
   * to embolden. Preventing the default on mousedown keeps the cursor where it
   * was.
   */
  const keep = (event: React.MouseEvent) => event.preventDefault();

  const link = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link to where?", existing ?? "https://");

    // Cancelled. Leave whatever was there alone.
    if (href === null) return;

    if (href.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  return (
    /*
      Stuck to the top of the window while the notebook scrolls past it.

      A notebook is long, and the formatting you want is usually for the line
      you are on — which on a phone is the line the toolbar had scrolled a
      screen and a half above. Opaque rather than translucent, because text
      sliding visibly under it reads as a rendering fault.
    */
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-[7px] border-b border-stone-200 bg-white px-2 py-1.5 dark:border-stone-800 dark:bg-stone-950">
      <Button on={state.bold} keep={keep} onPress={() => editor.chain().focus().toggleBold().run()} label="Bold" hint="Ctrl+B">
        <span className="font-semibold">B</span>
      </Button>

      <Button on={state.italic} keep={keep} onPress={() => editor.chain().focus().toggleItalic().run()} label="Italic" hint="Ctrl+I">
        <span className="italic font-serif">I</span>
      </Button>

      <Button on={state.underline} keep={keep} onPress={() => editor.chain().focus().toggleUnderline().run()} label="Underline" hint="Ctrl+U">
        <span className="underline underline-offset-2">U</span>
      </Button>

      <Button on={state.strike} keep={keep} onPress={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough">
        <span className="line-through">S</span>
      </Button>

      <Button on={state.highlight} keep={keep} onPress={() => editor.chain().focus().toggleHighlight().run()} label="Highlight">
        <span className="rounded-sm bg-amber-300/70 px-1 text-stone-900">H</span>
      </Button>

      <Divider />

      <Button on={state.heading} keep={keep} onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Heading">
        <span className="font-display text-[13px]">H</span>
      </Button>

      <Button on={state.quote} keep={keep} onPress={() => editor.chain().focus().toggleBlockquote().run()} label="Quote">
        &ldquo;
      </Button>

      <Divider />

      <Button on={state.bullets} keep={keep} onPress={() => editor.chain().focus().toggleBulletList().run()} label="Bullets">
        •
      </Button>

      <Button on={state.numbers} keep={keep} onPress={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list">
        <span className="text-[11px] tabular-nums">1.</span>
      </Button>

      <Button on={state.checks} keep={keep} onPress={() => editor.chain().focus().toggleTaskList().run()} label="Checkboxes">
        ☑
      </Button>

      <Divider />

      <Button on={state.link} keep={keep} onPress={link} label="Link">
        <span className="text-[13px]">🔗</span>
      </Button>

      <Button on={false} keep={keep} onPress={() => editor.chain().focus().setHorizontalRule().run()} label="Dividing line">
        <span className="text-[13px] leading-none">―</span>
      </Button>
    </div>
  );
}

function Button({
  on,
  keep,
  onPress,
  label,
  hint,
  children,
}: {
  on: boolean;
  keep: (event: React.MouseEvent) => void;
  onPress: () => void;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={keep}
      onClick={onPress}
      aria-pressed={on}
      aria-label={label}
      title={hint ? `${label}  (${hint})` : label}
      className={
        on
          ? "flex h-7 w-7 items-center justify-center rounded bg-stone-200 text-sm text-stone-900 dark:bg-stone-700 dark:text-stone-100"
          : "flex h-7 w-7 items-center justify-center rounded text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      }
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-stone-200 dark:bg-stone-700" />;
}
