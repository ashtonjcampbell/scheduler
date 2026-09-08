/**
 * Shown until Instagram is connected and dry run is switched off in Settings.
 * Deliberately loud: the whole app looks and behaves identically in dry run,
 * so this banner is the only thing distinguishing "posted" from "pretended".
 */
export function DryRunBanner() {
  return (
    <div className="border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p className="mx-auto max-w-6xl px-6 py-2 text-xs">
        <strong className="font-semibold">Dry run.</strong> Posts are simulated
        and logged — nothing is sent to Instagram. Turn this off in Settings
        once your account is connected.
      </p>
    </div>
  );
}
