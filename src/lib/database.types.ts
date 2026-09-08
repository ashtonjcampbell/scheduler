/**
 * Hand-authored to match supabase/migrations. Once the Supabase project
 * exists, `npm run types:db` regenerates this file from the live schema —
 * do that rather than editing by hand after a migration.
 */

export type PhotoStatus = "pending" | "processing" | "ready" | "failed";

export type PostStatus =
  | "idea"
  | "rough_draft"
  | "preview_draft"
  | "queued"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type ScheduleMode = "queue" | "fixed";
export type HashtagPlacement = "caption" | "first_comment";
export type PhotoUsage = "unused" | "drafted" | "scheduled" | "posted";

export type Photo = {
  id: string;
  created_at: string;
  original_filename: string;
  upload_path: string | null;
  storage_path: string | null;
  status: PhotoStatus;
  processing_error: string | null;
  processed_at: string | null;
  claimed_at: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  source_color_profile: string | null;
  missing_color_profile: boolean;
  alt_text: string | null;
  notes: string | null;
  deleted_at: string | null;
  /** Small colour-managed version for grids and pickers. */
  thumb_path: string | null;
  /** Set when the full-size file was removed after the post went live. */
  full_removed_at: string | null;
  /** Set when the original was deleted. Null while a lossless re-crop is possible. */
  original_removed_at: string | null;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
  crop_aspect: string | null;
  /** What the file really was, when its profile had to be guessed. */
  assumed_profile: string | null;
  reprocess_requested_at: string | null;
};

export type Post = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  caption: string;
  hashtag_placement: HashtagPlacement;
  status: PostStatus;
  schedule_mode: ScheduleMode;
  scheduled_for: string | null;
  slot_id: string | null;
  queue_position: number | null;
  claimed_at: string | null;
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  was_dry_run: boolean;
};

export type PostPhoto = {
  id: string;
  post_id: string;
  photo_id: string;
  position: number;
};

export type PhotoTag = {
  id: string;
  post_photo_id: string;
  username: string;
  x: number;
  y: number;
};

export type HashtagCategory = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Hashtag = {
  id: string;
  category_id: string | null;
  tag: string;
  /** Instagram's post count for this tag — the "volume". Big, hence number. */
  post_count: number | null;
  /** Retired tags stay in the library but are never offered by the shuffle. */
  active: boolean;
  notes: string | null;
  created_at: string;
};

/** A saved "how many from which categories" set for the shuffle. */
export type HashtagRecipe = {
  id: string;
  name: string;
  min_posts: number | null;
  max_posts: number | null;
  created_at: string;
  updated_at: string;
};

export type HashtagRecipeItem = {
  recipe_id: string;
  category_id: string;
  count: number;
};

export type PostHashtag = {
  id: string;
  post_id: string;
  /** The literal tag that will be published, without the leading #. */
  tag: string;
  /** The library entry it came from, or null for a one-off. */
  hashtag_id: string | null;
  position: number;
};

export type ScheduleSlot = {
  id: string;
  weekday: number;
  local_time: string;
  active: boolean;
  created_at: string;
};

export type Note = {
  id: string;
  title: string;
  content: unknown;
  content_html: string;
  created_at: string;
  updated_at: string;
};

export type PublishLogEntry = {
  id: number;
  at: string;
  post_id: string | null;
  level: "info" | "warn" | "error";
  message: string;
  detail: unknown;
};

export type AppSettings = {
  id: boolean;
  timezone: string;
  dry_run: boolean;
  ig_username: string | null;
  ig_user_id: string | null;
  ig_token_expires_at: string | null;
  ig_connected_at: string | null;
  ig_page_id: string | null;
  ig_page_name: string | null;
  hashtag_min: number;
  hashtag_max: number;
  /** Days after publishing before the full-size file is dropped. 0 = never. */
  archive_published_after_days: number;
  /** Days an original is kept so crops stay lossless. 0 = keep forever. */
  keep_originals_days: number;
  updated_at: string;
};

/** Service-role only. Never selected from browser code. */
export type AppSecrets = {
  id: boolean;
  ig_app_id: string | null;
  ig_app_secret: string | null;
  /** Page token — this is what publishes. */
  ig_access_token: string | null;
  /** Long-lived user token — this is what the weekly refresh extends. */
  ig_user_access_token: string | null;
  updated_at: string;
};

/**
 * Shape of one table for the Supabase client's generic parameter.
 *
 * `Optional` is a plain string list rather than `keyof Row` so a shared set
 * like `Generated` can be reused across tables that only have some of those
 * columns; anything not on the row is simply ignored.
 */
type Table<Row, Optional extends string = never> = {
  Row: Row;
  Insert: Omit<Row, InsertOptional<Row, Optional>> &
    Partial<Pick<Row, InsertOptional<Row, Optional>>>;
  Update: Partial<Row>;
  Relationships: [];
};

/**
 * Columns you may leave out of an insert: the ones named in `Optional`, plus
 * every nullable column — the database is happy to default those to null, so
 * requiring the caller to spell out `x: null` would be noise.
 */
type InsertOptional<Row, Optional extends string> =
  | Extract<Optional, keyof Row>
  | NullableKeys<Row>;

type NullableKeys<Row> = {
  [K in keyof Row]-?: null extends Row[K] ? K : never;
}[keyof Row];

/** Columns the database fills in for us on insert. */
type Generated = "id" | "created_at" | "updated_at";

export type Database = {
  public: {
    Tables: {
      photos: Table<Photo, Generated | "status" | "missing_color_profile">;
      posts: Table<
        Post,
        | Generated
        | "caption"
        | "hashtag_placement"
        | "status"
        | "schedule_mode"
        | "attempt_count"
        | "was_dry_run"
      >;
      post_photos: Table<PostPhoto, "id">;
      photo_tags: Table<PhotoTag, "id">;
      hashtag_categories: Table<HashtagCategory, Generated | "sort_order">;
      hashtags: Table<Hashtag, Generated | "active">;
      hashtag_recipes: Table<HashtagRecipe, Generated>;
      hashtag_recipe_items: Table<HashtagRecipeItem, never>;
      post_hashtags: Table<PostHashtag, "id" | "position">;
      schedule_slots: Table<ScheduleSlot, Generated | "active">;
      notes: Table<Note, Generated | "title" | "content" | "content_html">;
      publish_log: Table<PublishLogEntry, "id" | "at" | "level">;
      app_settings: Table<AppSettings, keyof AppSettings>;
      app_secrets: Table<AppSecrets, keyof AppSecrets>;
    };
    Views: {
      photo_usage: {
        Row: { photo_id: string; usage: PhotoUsage };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      photo_status: PhotoStatus;
      post_status: PostStatus;
      schedule_mode: ScheduleMode;
      hashtag_placement: HashtagPlacement;
    };
    CompositeTypes: Record<string, never>;
  };
};
