import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Scheduler
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Sign in to manage your Instagram queue.
        </p>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
