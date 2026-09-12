/**
 * Fetch that tries again when Supabase blinks.
 *
 * Two failures seen in one evening, both lasting about a second, both shown to
 * the user as a red box on a page that would have loaded perfectly a moment
 * later:
 *
 *   "Could not load the media bank: JWT issued at future"
 *   "Could not read settings: Gateway Timeout"
 *
 * The first is the interesting one. The proxy refreshes the session before a
 * request, and the page then queries with a token minted a fraction of a second
 * ago. Supabase's auth server and its database are different machines, so if
 * the database's clock is even one second behind, that brand-new token looks
 * like it was issued in the future and is refused. Waiting a moment and asking
 * again is the entire fix — the clocks have not moved apart, the token has
 * simply aged into being valid.
 *
 * WAITING IS FREE HERE. Cloudflare bills CPU time, not wall-clock time, so a
 * sleep costs nothing against the request budget. Only reads are retried:
 * a 5xx does not say whether a write landed before the gateway gave up.
 */

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Short, because a page render is waiting behind this. */
const RETRY_DELAYS_MS = [400, 1200];

/**
 * Worth another try despite the 401.
 *
 * Deliberately narrow. Every other 401 means the session is genuinely no good,
 * and retrying those would only delay the login screen.
 */
function isClockSkew(body: string): boolean {
  return body.includes("issued at future") || body.includes("JWTIssuedAtFuture");
}

export async function retryingFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD";

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length;

    try {
      const response = await fetch(input, init);

      if (!retryable || last || response.ok) return response;

      if (response.status === 401) {
        // Clone before reading: the original body must stay unconsumed for
        // whoever receives it if this turns out not to be worth retrying.
        const body = await response.clone().text();
        if (!isClockSkew(body)) return response;
      } else if (!TRANSIENT_STATUS.has(response.status)) {
        return response;
      }
    } catch (error) {
      // A refused connection or dropped socket never reached Supabase, so this
      // is safe to repeat whatever the method was.
      if (last) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
