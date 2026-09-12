import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv, serverEnv } from "@/lib/env";
import { retryingFetch } from "@/lib/supabase/retry";

/** Routes reachable without signing in. Everything else is gated. */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/error", "/privacy"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Refreshing the auth token means writing new cookies onto a real response,
  // so the response object has to exist before Supabase is called.
  let response = NextResponse.next({ request });

  const env = publicEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // A one-second Supabase hiccup must not read as "not signed in".
      global: { fetch: retryingFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Revalidates the token against Supabase and refreshes it if needed. Do not
  // swap this for getSession(): that trusts the cookie without checking it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // Second line of defence behind Supabase's disabled sign-ups: even a valid
  // session for the wrong address gets thrown out.
  if (user && user.email?.toLowerCase() !== serverEnv().ALLOWED_EMAIL.toLowerCase()) {
    await supabase.auth.signOut();

    const denied = request.nextUrl.clone();
    denied.pathname = "/login";
    denied.search = "?error=not_allowed";
    return NextResponse.redirect(denied);
  }

  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Come back here after signing in.
    login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }

  if (user && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and image files — those never need
     * an auth check and running the proxy on them wastes requests.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
