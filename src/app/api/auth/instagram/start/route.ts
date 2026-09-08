import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { authorizeUrl } from "@/lib/meta";

export const dynamic = "force-dynamic";

/**
 * Send the user to Facebook to authorise the app.
 *
 * The `state` value is generated here and stored in a short-lived cookie, then
 * checked on the way back. Without it, anyone could hand you a crafted
 * callback URL and connect THEIR Instagram account to your scheduler.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${serverEnv().APP_URL}/login`);

  const { data: secrets } = await supabaseAdmin()
    .from("app_secrets")
    .select("ig_app_id")
    .single();

  if (!secrets?.ig_app_id) {
    return NextResponse.redirect(
      `${serverEnv().APP_URL}/settings?error=${encodeURIComponent("Add your Meta App ID and App Secret first.")}`,
    );
  }

  const state = crypto.randomUUID();
  const jar = await cookies();

  jar.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = `${serverEnv().APP_URL}/api/auth/instagram/callback`;

  return NextResponse.redirect(authorizeUrl(secrets.ig_app_id, redirectUri, state));
}
