"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the device says.
 *
 * THREE STATES, NOT TWO. A plain on/off switch has to pick a meaning for "off"
 * and gets it wrong half the time — a phone that switches itself to dark in
 * the evening should take the app with it unless told otherwise. "System" is
 * the default and stays the default until someone actually disagrees with it.
 *
 * The choice is written to the root element as `data-theme`, which is what the
 * CSS in globals.css reads, and remembered per browser. Applying it before the
 * page paints is the job of the small script in the root layout — doing it
 * here would show a flash of the wrong theme first.
 */

const KEY = "theme";

export type Theme = "light" | "dark" | "system";

/** The script in the root layout writes the same key; keep them in step. */
export const THEME_KEY = KEY;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    // A browser set to block site data throws on the read itself.
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;

  // Nothing stamped means "follow the device", which is what the CSS treats as
  // the unset case — so system REMOVES the attribute rather than setting one.
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  try {
    if (theme === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered for next time. Still applied now.
  }

  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  // "system" on the server, because the server cannot know; the script in the
  // layout has already stamped the real answer before React starts.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5 dark:border-stone-800"
    >
      <Option current={theme} value="light" label="Light">
        ☀
      </Option>
      <Option current={theme} value="system" label="Match the device">
        ◐
      </Option>
      <Option current={theme} value="dark" label="Dark">
        ☾
      </Option>
    </div>
  );
}

function Option({
  current,
  value,
  label,
  children,
}: {
  current: Theme;
  value: Theme;
  label: string;
  children: React.ReactNode;
}) {
  const selected = current === value;

  return (
    <button
      type="button"
      onClick={() => apply(value)}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={
        selected
          ? "flex h-6 w-7 items-center justify-center rounded bg-stone-200 text-xs dark:bg-stone-700"
          : "flex h-6 w-7 items-center justify-center rounded text-xs text-stone-400 transition hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
      }
    >
      {children}
    </button>
  );
}
