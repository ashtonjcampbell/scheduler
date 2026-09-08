import { z } from "zod";

/**
 * Worker configuration, supplied by GitHub Actions secrets.
 *
 * The service-role key bypasses Row Level Security completely, which is why it
 * lives here and never anywhere the browser can reach.
 */
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

let cache: z.infer<typeof schema> | null = null;

export function env() {
  if (cache) return cache;

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Worker is missing configuration: ${missing}`);
  }

  cache = parsed.data;
  return cache;
}
