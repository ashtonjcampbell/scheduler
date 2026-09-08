export const metadata = { title: "Sign-in problem" };

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          That link didn&apos;t work
        </h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Sign-in links expire after an hour and can only be used once. Request
          a fresh one and try again.
        </p>

        {reason && (
          <p className="mt-4 rounded-lg bg-stone-100 p-3 font-mono text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400">
            {reason}
          </p>
        )}

        <a
          href="/login"
          className="mt-6 inline-block rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          Back to sign in
        </a>
      </div>
    </main>
  );
}
