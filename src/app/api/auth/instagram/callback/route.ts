import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { exchangeCode, toLongLived, findInstagramAccount } from "@/lib/meta";

export const dynamic = "force-dynamic";

/** Where Facebook sends the user back. */
export async function GET(request: NextRequest) {
  const { APP_URL } = serverEnv();
  const settings = (message: string) =>
    NextResponse.redirect(`${APP_URL}/settings?error=${encodeURIComponent(message)}`);

  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${APP_URL}/login`);

  const params = request.nextUrl.searchParams;

  // Facebook reports a refusal here rather than as an HTTP error.
  const denied = params.get("error_description") ?? params.get("error");
  if (denied) return settings(`Facebook said: ${denied}`);

  const code = params.get("code");
  const state = params.get("state");

  const jar = await cookies();
  const expected = jar.get("ig_oauth_state")?.value;
  jar.delete("ig_oauth_state");

  if (!code) return settings("Facebook did not send an authorisation code.");
  if (!state || !expected || state !== expected) {
    return settings("That sign-in did not start from here, so it was refused.");
  }

  const supabase = supabaseAdmin();
  const { data: secrets } = await supabase
    .from("app_secrets")
    .select("ig_app_id, ig_app_secret")
    .single();

  if (!secrets?.ig_app_id || !secrets.ig_app_secret) {
    return settings("Add your Meta App ID and App Secret first.");
  }

  try {
    const redirectUri = `${APP_URL}/api/auth/instagram/callback`;

    const shortLived = await exchangeCode(
      secrets.ig_app_id,
      secrets.ig_app_secret,
      redirectUri,
      code,
    );

    const longLived = await toLongLived(secrets.ig_app_id, secrets.ig_app_secret, shortLived);
    const account = await findInstagramAccount(longLived.token);

    // Tokens go to app_secrets, which has no RLS policies at all — so the
    // browser can never read them back, only the worker can.
    const { error: secretError } = await supabase
      .from("app_secrets")
      .update({
        ig_access_token: account.pageAccessToken,
        ig_user_access_token: longLived.token,
      })
      .eq("id", true);

    if (secretError) return settings(`Could not save the connection: ${secretError.message}`);

    await supabase
      .from("app_settings")
      .update({
        ig_user_id: account.igUserId,
        ig_username: account.igUsername,
        ig_page_id: account.pageId,
        ig_page_name: account.pageName,
        ig_connected_at: new Date().toISOString(),
        ig_token_expires_at: longLived.expiresAt?.toISOString() ?? null,
      })
      .eq("id", true);

    return NextResponse.redirect(
      `${APP_URL}/settings?connected=${encodeURIComponent(account.igUsername || account.igUserId)}`,
    );
  } catch (error) {
    return settings(error instanceof Error ? error.message : "Could not connect to Instagram.");
  }
}
