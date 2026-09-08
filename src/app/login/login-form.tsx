"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { sendMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export function LoginForm() {
  const params = useSearchParams();
  const [state, action] = useActionState(sendMagicLink, initialState);

  const rejected = params.get("error") === "not_allowed";
  const next = params.get("next") ?? "/";

  if (state.status === "sent") {
    return (
      <p className="mt-8 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        Check your inbox — the sign-in link is on its way. It expires in an
        hour.
      </p>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-stone-800"
        />
      </div>

      <SubmitButton />

      {rejected && (
        <p className="text-sm text-red-600 dark:text-red-400">
          That account is not allowed to use this app.
        </p>
      )}

      {state.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
    >
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}
