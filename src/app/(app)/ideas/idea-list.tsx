"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPacific } from "@/lib/time";
import { createIdea, updateIdea, deleteIdea, promoteIdea } from "./actions";

type Idea = {
  id: string;
  caption: string;
  created_at: string;
  covers: string[];
};

export function IdeaList({ ideas }: { ideas: Idea[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const run = (action: () => Promise<{ error?: string } | void>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) setError(result.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  };

  return (
    <section>
      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-semibold">Jot something down</h2>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (draft.trim()) run(async () => { const r = await createIdea(draft); setDraft(""); return r; });
            }
          }}
          rows={3}
          placeholder="A caption idea, a shoot to revisit, a line you overheard…"
          className="mt-2 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={pending || !draft.trim()}
            onClick={() => run(async () => { const r = await createIdea(draft); setDraft(""); return r; })}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          >
            Save idea
          </button>
          <span className="text-xs text-stone-400 dark:text-stone-500">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {ideas.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          No ideas yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
            >
              {editing === idea.id ? (
                <form
                  action={(formData) =>
                    run(() => updateIdea(idea.id, String(formData.get("caption") ?? "")))
                  }
                >
                  <textarea
                    name="caption"
                    defaultValue={idea.caption}
                    rows={3}
                    autoFocus
                    className="w-full rounded border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950"
                  />
                  <div className="mt-1.5 flex gap-2 text-xs">
                    <button type="submit" disabled={pending} className="font-medium">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-stone-500">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm">{idea.caption || <span className="text-stone-400">(empty)</span>}</p>

                  {idea.covers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {idea.covers.map((src, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={index}
                          src={src}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-stone-400 dark:text-stone-500">
                      {formatPacific(idea.created_at)}
                    </span>

                    <button
                      type="button"
                      onClick={() => setEditing(idea.id)}
                      className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => promoteIdea(idea.id))}
                      className="font-medium text-stone-700 hover:underline dark:text-stone-300"
                    >
                      Make it a post
                    </button>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm("Delete this idea?")) run(() => deleteIdea(idea.id));
                      }}
                      className="ml-auto text-red-600 hover:underline dark:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
