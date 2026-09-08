import { supabaseServer } from "@/lib/supabase/server";
import { HashtagLibrary } from "./hashtag-library";

export const metadata = { title: "Hashtag library" };
export const dynamic = "force-dynamic";

export default async function HashtagsPage() {
  const supabase = await supabaseServer();

  const [{ data: categories, error: catError }, { data: tags, error: tagError }] =
    await Promise.all([
      supabase
        .from("hashtag_categories")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("hashtags")
        .select("*")
        .order("post_count", { ascending: false, nullsFirst: false }),
    ]);

  const error = catError ?? tagError;
  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load the hashtag library: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hashtag library</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
          Your saved tags, grouped by category. Retired tags stay here for
          reference but are never offered when building a post.
        </p>
      </div>

      <HashtagLibrary categories={categories ?? []} tags={tags ?? []} />
    </div>
  );
}
