import type { NoteKind } from "@/lib/database.types";

/**
 * Two notebooks, and only two.
 *
 * STRATEGY is what you are trying to do — the voice, the themes, the things
 * worth saying. IDEA BANK is the pile: half-lines, things that happened,
 * anything that might become a caption one day.
 *
 * Kept here rather than beside the action that writes them, because a
 * "use server" file may only export async functions — a plain constant in one
 * turns every page importing it into a build failure. Both the Notes page and
 * the panel in the composer need these names, and neither needs the action.
 */
export const NOTEBOOKS = ["strategy", "idea_bank"] as const;

export type Notebook = NoteKind;

export const NOTEBOOK_LABELS: Record<Notebook, string> = {
  strategy: "Strategy",
  idea_bank: "Idea bank",
};

export function isNotebook(value: string): value is Notebook {
  return (NOTEBOOKS as readonly string[]).includes(value);
}
