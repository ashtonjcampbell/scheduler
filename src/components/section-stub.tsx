export function SectionStub({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
        {description}
      </p>
      <p className="mt-6 inline-block rounded-md border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
        Being built in {phase}.
      </p>
    </div>
  );
}
