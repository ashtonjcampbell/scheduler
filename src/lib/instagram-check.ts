import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Ask Instagram whether a post is still there.
 *
 * Used before forgetting a published post's record. The record is the only
 * proof of what actually went out, so removing one on someone's say-so would
 * make the grid quietly stop matching the profile it is meant to mirror —
 * asking is cheap, and the answer is not a matter of opinion.
 *
 * Reads the token through the admin client because `app_secrets` has no read
 * policy, which is what keeps Instagram tokens out of the browser. The token
 * never leaves this function.
 */
export async function isStillOnInstagram(
  mediaId: string,
): Promise<{ stillLive: boolean; error?: string }> {
  const admin = supabaseAdmin();

  const { data: secrets } = await admin
    .from("app_secrets")
    .select("ig_access_token")
    .single();

  const token = secrets?.ig_access_token;
  if (!token) {
    return { stillLive: false, error: "Instagram is not connected, so this cannot be checked." };
  }

  const version = process.env.IG_API_VERSION ?? "v23.0";

  try {
    const response = await fetch(
      `https://graph.facebook.com/${version}/${mediaId}?fields=id&access_token=${token}`,
      { headers: { "User-Agent": "ig-scheduler" } },
    );

    if (response.ok) return { stillLive: true };

    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: number; message?: string };
    };

    /*
     * Code 100 is "nonexistent object" — a deleted post. Anything else is a
     * question we could not get an answer to (expired token, rate limit, Meta
     * having a moment), and "we could not ask" must never be read as "it is
     * gone". Erring the other way would delete the record of a live post.
     */
    if (body.error?.code === 100) return { stillLive: false };

    return {
      stillLive: false,
      error: `Could not check with Instagram: ${body.error?.message ?? response.status}. Nothing was removed.`,
    };
  } catch (error) {
    return {
      stillLive: false,
      error: `Could not reach Instagram: ${error instanceof Error ? error.message : String(error)}. Nothing was removed.`,
    };
  }
}
