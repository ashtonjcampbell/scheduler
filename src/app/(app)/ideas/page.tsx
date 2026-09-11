import { supabaseServer } from "@/lib/supabase/server";
import { thumbUrl } from "@/lib/photos";
import { IdeaList } from "./idea-list";
import { Notepad } from "./notepad";

export const metadata = { title: "Ideas" };
export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const supabase = await supabaseServer();

  const [{ data: ideas, error }, { data: links }, { data: photos }, { data: notes }] =
    await Promise.all([
      supabase
        .from("posts")
        .select("id, caption, created_at")
        .eq("status", "idea")
        .order("created_at", { ascending: false }),
      supabase.from("post_photos").select("post_id, photo_id, position"),
      supabase.from("photos").select("id, storage_path, thumb_path, processed_at").is("deleted_at", null),
      supabase.from("notes").select("*").order("updated_at", { ascending: false }),
    ]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load ideas: {error.message}
      </p>
    );
  }

  const photoById = new Map((photos ?? []).map((p) => [p.id, p]));

  const withCovers = (ideas ?? []).map((idea) => ({
    id: idea.id,
    caption: idea.caption,
    created_at: idea.created_at,
    covers: (links ?? [])
      .filter((l) => l.post_id === idea.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => {
        const photo = photoById.get(l.photo_id);
        return photo ? thumbUrl(photo) : null;
      })
      .filter((url): url is string => !!url),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ideas</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
          Half-formed thoughts, kept out of the way until they are worth making
          into a post. Nothing here can ever publish.
        </p>
      </div>

      <IdeaList ideas={withCovers} />
      <Notepad notes={notes ?? []} />
    </div>
  );
}
