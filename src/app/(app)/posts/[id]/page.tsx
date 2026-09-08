import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Composer } from "./composer";

export const metadata = { title: "Compose" };
export const dynamic = "force-dynamic";

export default async function ComposePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();

  // Separate queries rather than embedded selects — see the note in
  // ../page.tsx for why.
  const [post, postPhotos, postTags, photoTags, photos, tags, library, categories, settings] =
    await Promise.all([
      supabase.from("posts").select("*").eq("id", id).single(),
      supabase
        .from("post_photos")
        .select("id, photo_id, position")
        .eq("post_id", id),
      supabase
        .from("post_hashtags")
        .select("id, tag, hashtag_id, position")
        .eq("post_id", id),
      supabase.from("photo_tags").select("*").eq("post_id", id),
      // Only ready photos can be attached: an unprocessed one has no file
      // for Instagram to fetch, and a trashed one is on its way out.
      supabase
        .from("photos")
        .select("*")
        .is("deleted_at", null)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      supabase.from("photo_usage").select("photo_id, usage"),
      supabase.from("hashtags").select("*").order("post_count", { ascending: false, nullsFirst: false }),
      supabase.from("hashtag_categories").select("*").order("name"),
      supabase.from("app_settings").select("hashtag_min, hashtag_max").single(),
    ]);

  if (post.error || !post.data) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/posts"
          className="text-sm text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
        >
          ← Posts
        </Link>
      </div>

      <Composer
        post={{
          ...post.data,
          post_photos: postPhotos.data ?? [],
          post_hashtags: postTags.data ?? [],
          photo_tags: photoTags.data ?? [],
        }}
        libraryPhotos={photos.data ?? []}
        usage={tags.data ?? []}
        library={library.data ?? []}
        categories={categories.data ?? []}
        guide={{
          min: settings.data?.hashtag_min ?? 3,
          max: settings.data?.hashtag_max ?? 10,
        }}
      />
    </div>
  );
}
