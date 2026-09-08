"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

/**
 * Send the magic link.
 *
 * The address is checked against the allowlist here rather than relying on
 * Supabase alone, so a wrong address gets an honest answer instead of an email
 * that will not work.
 */
export async function sendMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const { ALLOWED_EMAIL, APP_URL } = serverEnv();

  if (email !== ALLOWED_EMAIL.toLowerCase()) {
    return {
      status: "error",
      message: "That address is not set up for this app.",
    };
  }

  const supabase = await supabaseServer();
  const next = String(formData.get("next") ?? "/");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      // This is a single-user app with sign-ups disabled; the account is
      // created once, by hand, in the Supabase dashboard.
      shouldCreateUser: false,
    },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  return { status: "sent" };
}
