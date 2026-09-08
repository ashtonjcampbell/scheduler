import { serviceClient, log } from "./lib/supabase.js";

/**
 * Extend the Instagram access token before it expires.
 *
 * Long-lived user tokens last about 60 days. Without this the app simply stops
 * publishing two months after setup, and the only symptom is posts quietly
 * failing — which is why this runs weekly rather than close to the deadline:
 * six consecutive failures would have to go unnoticed before anything breaks,
 * and each one emails you.
 *
 * The Page token used for publishing is derived from the user token, so it is
 * re-fetched afterwards rather than assumed to still be valid.
 */

const API_VERSION = process.env.IG_API_VERSION ?? "v23.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

async function graph(path: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { "User-Agent": "ig-scheduler" } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta returned ${response.status}`);
  }

  return body;
}

async function main() {
  const supabase = serviceClient();

  const [{ data: settings }, { data: secrets }] = await Promise.all([
    supabase.from("app_settings").select("ig_user_id, ig_page_id, dry_run").single(),
    supabase
      .from("app_secrets")
      .select("ig_app_id, ig_app_secret, ig_user_access_token")
      .single(),
  ]);

  if (!settings?.ig_user_id || !secrets?.ig_user_access_token) {
    console.log("Instagram is not connected — nothing to refresh.");
    return;
  }

  if (!secrets.ig_app_id || !secrets.ig_app_secret) {
    await log("error", "Cannot refresh the Instagram token: app credentials are missing");
    return;
  }

  try {
    const refreshed = await graph("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: secrets.ig_app_id,
      client_secret: secrets.ig_app_secret,
      fb_exchange_token: secrets.ig_user_access_token,
    });

    const userToken = refreshed.access_token;
    if (typeof userToken !== "string") {
      throw new Error("Meta did not return a refreshed token");
    }

    const seconds = Number(refreshed.expires_in ?? 60 * 24 * 60 * 60);
    const expiresAt = new Date(Date.now() + seconds * 1000);

    // The publishing token is a PAGE token derived from the user token, so it
    // is fetched again rather than assumed to have survived the refresh.
    const pages = await graph("/me/accounts", {
      fields: "id,access_token",
      access_token: userToken,
    });

    const list = (pages.data ?? []) as Array<{ id: string; access_token: string }>;
    const page = list.find((p) => p.id === settings.ig_page_id) ?? list[0];

    if (!page) {
      throw new Error("The refreshed token no longer lists the Facebook Page");
    }

    await supabase
      .from("app_secrets")
      .update({ ig_user_access_token: userToken, ig_access_token: page.access_token })
      .eq("id", true);

    await supabase
      .from("app_settings")
      .update({ ig_token_expires_at: expiresAt.toISOString() })
      .eq("id", true);

    const days = Math.round(seconds / 86400);
    console.log(`Token refreshed — good for about ${days} more days.`);
    await log("info", `Instagram access refreshed, valid for about ${days} days`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await log("error", `Could not refresh the Instagram token: ${message}`);

    // Fail the job so GitHub emails. A silent failure here is exactly how a
    // scheduler stops working two months later with no explanation.
    throw error;
  }
}

await main();
