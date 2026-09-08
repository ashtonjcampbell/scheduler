"use client";

import { useTransition } from "react";
import { createPost } from "./actions";

export function NewPostButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => createPost())}
      className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
    >
      {pending ? "Creating…" : "New post"}
    </button>
  );
}
