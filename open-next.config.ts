import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext adapts the Next.js build into a Cloudflare Worker.
 *
 * No cache overrides are configured: every page in this app is either
 * per-request dynamic or behind auth, so there is nothing worth caching at the
 * edge, and skipping it keeps us clear of paid KV/R2 bindings.
 */
export default defineCloudflareConfig();
