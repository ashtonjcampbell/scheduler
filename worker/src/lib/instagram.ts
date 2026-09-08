/**
 * The Instagram Content Publishing API.
 *
 * Publishing is a three-step dance, not a single upload:
 *
 *   1. Create a "container" per image. Instagram FETCHES the image from a URL
 *      we give it — it never accepts an upload — which is why processed
 *      photos live in a publicly readable bucket.
 *   2. Wait for the container to report FINISHED. Instagram downloads and
 *      transcodes asynchronously, and publishing early fails.
 *   3. Publish the container.
 *
 * A carousel adds a step: each image becomes a child container, then those
 * children go into one carousel container which is what actually gets
 * published.
 */

/**
 * Graph API version.
 *
 * Meta retires versions roughly two years after release, and a retired one
 * fails with an unhelpful error. Overridable so it can be moved without a code
 * change when that happens.
 */
const API_VERSION = process.env.IG_API_VERSION ?? "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Instagram's own ceiling: 100 published posts per rolling 24 hours. */
export const DAILY_PUBLISH_LIMIT = 100;

export interface PublishRequest {
  igUserId: string;
  accessToken: string;
  /** Publicly reachable URLs. Instagram fetches these itself. */
  imageUrls: string[];
  caption: string;
  /** Posted as the first comment immediately after publishing, if present. */
  firstComment: string | null;
  /** Per-image user tags, indexed to match imageUrls. */
  userTags?: Array<Array<{ username: string; x: number; y: number }>>;
}

export interface PublishResult {
  mediaId: string;
  permalink: string | null;
}

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
    /** True when retrying later might succeed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

async function call(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "POST",
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE}${path}`);

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    ...(method === "POST"
      ? {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params).toString(),
        }
      : {}),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = body.error as { message?: string; code?: number; type?: string } | undefined;

    // Rate limits and transient server errors are worth another attempt;
    // a bad request or a revoked token is not.
    const retryable =
      response.status >= 500 || response.status === 429 || error?.code === 4 || error?.code === 32;

    throw new InstagramError(
      error?.message ?? `Instagram returned ${response.status}`,
      body,
      retryable,
    );
  }

  return body;
}

/** How long to keep asking whether a container is ready. */
const CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;
const CONTAINER_POLL_MS = 3000;

/**
 * Wait for Instagram to finish downloading and processing an image.
 *
 * Publishing a container that is still IN_PROGRESS fails, so this is not
 * optional politeness — it is part of the protocol.
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + CONTAINER_TIMEOUT_MS;

  for (;;) {
    const body = await call(
      `/${containerId}`,
      { fields: "status_code,status", access_token: accessToken },
      "GET",
    );

    const status = String(body.status_code ?? "");

    if (status === "FINISHED") return;

    if (status === "ERROR" || status === "EXPIRED") {
      throw new InstagramError(
        `Instagram could not process the image (${status})`,
        body,
        false,
      );
    }

    if (Date.now() > deadline) {
      throw new InstagramError(
        "Instagram is still processing the image after five minutes",
        body,
        true,
      );
    }

    await sleep(CONTAINER_POLL_MS);
  }
}

export async function publish(
  request: PublishRequest,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PublishResult> {
  const { igUserId, accessToken, imageUrls, caption, firstComment, userTags } = request;

  if (imageUrls.length === 0) throw new InstagramError("A post needs at least one image");
  if (imageUrls.length > 10) {
    throw new InstagramError("Instagram carousels are capped at 10 images");
  }

  let creationId: string;

  if (imageUrls.length === 1) {
    const body = await call("/" + igUserId + "/media", {
      image_url: imageUrls[0]!,
      caption,
      access_token: accessToken,
      ...(userTags?.[0]?.length ? { user_tags: JSON.stringify(userTags[0]) } : {}),
    });

    creationId = String(body.id);
    await waitForContainer(creationId, accessToken, sleep);
  } else {
    // Each image first becomes a child container.
    const children: string[] = [];

    for (const [index, imageUrl] of imageUrls.entries()) {
      const body = await call("/" + igUserId + "/media", {
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: accessToken,
        ...(userTags?.[index]?.length ? { user_tags: JSON.stringify(userTags[index]) } : {}),
      });

      children.push(String(body.id));
    }

    for (const child of children) {
      await waitForContainer(child, accessToken, sleep);
    }

    const body = await call("/" + igUserId + "/media", {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
      access_token: accessToken,
    });

    creationId = String(body.id);
    await waitForContainer(creationId, accessToken, sleep);
  }

  const published = await call("/" + igUserId + "/media_publish", {
    creation_id: creationId,
    access_token: accessToken,
  });

  const mediaId = String(published.id);

  // The first comment is a separate call after publishing — there is no way to
  // send it with the post. A failure here leaves the post up without its
  // hashtags, which is worth reporting but not worth failing the post over.
  if (firstComment) {
    await call(`/${mediaId}/comments`, {
      message: firstComment,
      access_token: accessToken,
    });
  }

  let permalink: string | null = null;
  try {
    const info = await call(
      `/${mediaId}`,
      { fields: "permalink", access_token: accessToken },
      "GET",
    );
    permalink = typeof info.permalink === "string" ? info.permalink : null;
  } catch {
    // Cosmetic only — the post is already live.
  }

  return { mediaId, permalink };
}

/**
 * How many posts have gone out in the last 24 hours, according to Instagram.
 *
 * Checked before publishing because exceeding the limit fails the call, and a
 * scheduled post failing at its slot is worse than one waiting for the next.
 */
export async function publishingLimitRemaining(
  igUserId: string,
  accessToken: string,
): Promise<number> {
  const body = await call(
    `/${igUserId}/content_publishing_limit`,
    { fields: "quota_usage,config", access_token: accessToken },
    "GET",
  );

  const row = (body.data as Array<{ quota_usage?: number; config?: { quota_total?: number } }>)?.[0];
  const used = row?.quota_usage ?? 0;
  const total = row?.config?.quota_total ?? DAILY_PUBLISH_LIMIT;

  return Math.max(0, total - used);
}

/**
 * Extend a long-lived token.
 *
 * Instagram's long-lived tokens last 60 days and can be refreshed once they
 * are at least 24 hours old. Without this the app silently stops publishing
 * two months after setup.
 */
export async function refreshLongLivedToken(
  accessToken: string,
): Promise<{ token: string; expiresInSeconds: number }> {
  const body = await call(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      fb_exchange_token: accessToken,
      client_id: process.env.IG_APP_ID ?? "",
      client_secret: process.env.IG_APP_SECRET ?? "",
    },
    "GET",
  );

  const token = body.access_token;
  if (typeof token !== "string") {
    throw new InstagramError("Instagram did not return a refreshed token", body);
  }

  return {
    token,
    expiresInSeconds: Number(body.expires_in ?? 60 * 24 * 60 * 60),
  };
}
