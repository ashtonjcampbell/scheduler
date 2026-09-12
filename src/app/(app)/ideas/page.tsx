import { supabaseServer } from "@/lib/supabase/server";
import { Notebook } from "./notepad";
import { NOTEBOOK_LABELS } from "@/lib/notebooks";

export const metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

/**
 * Two notebooks.
 *
 * This was a list of titled notes plus a list of ideas-as-posts, which meant
 * naming things, choosing between them and deciding which list a thought
 * belonged in — filing, in place of writing. In practice there are two
 * things worth keeping: what you are trying to do, and the pile.
 *
 * Both are readable from the composer while you write a caption, which is the
 * moment they are actually for.
 */
export default async function NotesPage() {
  const supabase = await supabaseServer();

  const { data: notes, error } = await supabase
    .from("notes")
    .select("kind, content_html");

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load your notes: {error.message}
      </p>
    );
  }

  const byKind = new Map((notes ?? []).map((n) => [n.kind, n.content_html]));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Notes</h1>
      </div>

      <Notebook
        kind="strategy"
        label={NOTEBOOK_LABELS.strategy}
        html={byKind.get("strategy") ?? ""}
      />

      <Notebook
        kind="idea_bank"
        label={NOTEBOOK_LABELS.idea_bank}
        html={byKind.get("idea_bank") ?? ""}
      />
    </div>
  );
}
