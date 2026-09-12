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
  const [
    post,
    postPhotos,
    postTags,
    photoTags,
    photos,
    tags,
    library,
    categories,
    settings,
  ] = await Promise.all([
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
    // Only ready photos can be ATTACHED: an unprocessed one has no file for
    // Instagram to fetch, and a trashed one is on its way out. Photos already
    // on this post are fetched separately below, whatever their state.
    supabase
      .from("photos")
      .select("*")
      .is("deleted_at", null)
      .eq("status", "ready")
      .order("created_at", { ascending: false }),
    supabase.from("photo_usage").select("photo_id, usage"),
    supabase
      .from("hashtags")
      .select("*")
      .order("post_count", { ascending: false, nullsFirst: false }),
    supabase.from("hashtag_categories").select("*").order("name"),
    supabase
      .from("app_settings")
      .select("hashtag_min, hashtag_max, default_recipe_id")
      .single(),
  ]);

  if (post.error || !post.data) notFound();

  /*
   * Photos already on this post, in whatever state they are in.
   *
   * Cropping sends a photo back through processing, which briefly takes it out
   * of the "ready" library above — and a photo silently vanishing from a post
   * because you cropped it is alarming in exactly the wrong way. It stays on
   * screen, marked as working, and the post is blocked from publishing until
   * it is done.
   */
  const attachedIds = (postPhotos.data ?? []).map((p) => p.photo_id);
  const attached = attachedIds.length
    ? await supabase.from("photos").select("*").in("id", attachedIds)
    : null;

  const knownIds = new Set((photos.data ?? []).map((p) => p.id));
  const libraryPhotos = [
    ...(photos.data ?? []),
    ...(attached?.data ?? []).filter((p) => !knownIds.has(p.id)),
  ];

  // The saved "how many from which categories", so the shuffle opens set to
  // it rather than empty. A second round trip because it depends on the first.
  const defaultRecipeId = settings.data?.default_recipe_id ?? null;
  const defaultItems = defaultRecipeId
    ? await supabase
        .from("hashtag_recipe_items")
        .select("category_id, count")
        .eq("recipe_id", defaultRecipeId)
    : null;

  const defaultCounts = Object.fromEntries(
    (defaultItems?.data ?? []).map((item) => [item.category_id, item.count]),
  );

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
        libraryPhotos={libraryPhotos}
        usage={tags.data ?? []}
        library={library.data ?? []}
        categories={categories.data ?? []}
        guide={{
          min: settings.data?.hashtag_min ?? 3,
          max: settings.data?.hashtag_max ?? 10,
        }}
        defaultCounts={defaultCounts}
      />
    </div>
  );
}
