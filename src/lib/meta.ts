/**
 * Connecting an Instagram account through Facebook Login.
 *
 * The chain is longer than it looks. The login dialog returns a code for a
 * short-lived USER token; that is exchanged for a long-lived user token; that
 * lists the Facebook Pages you administer; each Page may have an Instagram
 * business account attached; and publishing then uses the PAGE token, not the
 * user token.
 *
 * Getting any link wrong produces an empty account list rather than an error,
 * which is why each step here reports what it actually found.
 */

/** Overridable: Meta retires versions after roughly two years. */
export const META_API_VERSION = process.env.IG_API_VERSION ?? "v23.0";

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Exactly the permissions this app uses, and no more.
 *
 * Asking for anything unused makes an App Review harder to justify, and there
 * is nothing here the app does not actually call.
 */
export const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  // Reads how posts performed, so the app can say which slots actually earn
  // their place instead of guessing. Read-only: it cannot change anything.
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
] as const;

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const url = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  return url.toString();
}

export class MetaError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "MetaError";
  }
}

async function graph(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { "User-Agent": "ig-scheduler" } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new MetaError(error?.message ?? `Meta returned ${response.status}`, body);
  }

  return body;
}

/** Swap the login code for a short-lived user token. */
export async function exchangeCode(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
): Promise<string> {
  const body = await graph("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const token = body.access_token;
  if (typeof token !== "string") throw new MetaError("No access token came back", body);

  return token;
}

/** Turn a short-lived user token into one that lasts about 60 days. */
export async function toLongLived(
  appId: string,
  appSecret: string,
  shortLived: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const body = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLived,
  });

  const token = body.access_token;
  if (typeof token !== "string") throw new MetaError("No long-lived token came back", body);

  const seconds = Number(body.expires_in ?? 0);

  return {
    token,
    expiresAt: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
  };
}

export interface ConnectedAccount {
  pageId: string;
  pageName: string;
  /** Publishing uses this, not the user token. */
  pageAccessToken: string;
  igUserId: string;
  igUsername: string;
}

/**
 * Find the Instagram business account behind the user's Pages.
 *
 * An empty result almost always means the Instagram account is not linked to
 * the Page, or is not a professional account — so the message says that rather
 * than "not found".
 */
export async function findInstagramAccount(
  userAccessToken: string,
): Promise<ConnectedAccount> {
  const pages = await graph("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userAccessToken,
  });

  const list = (pages.data ?? []) as Array<{
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string; username?: string };
  }>;

  if (list.length === 0) {
    throw new MetaError(
      "No Facebook Pages came back. The account you signed in with must administer the Page your Instagram account is linked to.",
    );
  }

  const withInstagram = list.find((page) => page.instagram_business_account?.id);

  if (!withInstagram?.instagram_business_account) {
    throw new MetaError(
      `Found ${list.length} Page${list.length === 1 ? "" : "s"} (${list
        .map((p) => p.name)
        .join(", ")}), but no Instagram business account is linked to any of them. ` +
        "Check that Instagram is a Professional account and linked to the Page.",
    );
  }

  return {
    pageId: withInstagram.id,
    pageName: withInstagram.name,
    pageAccessToken: withInstagram.access_token,
    igUserId: withInstagram.instagram_business_account.id,
    igUsername: withInstagram.instagram_business_account.username ?? "",
  };
}
