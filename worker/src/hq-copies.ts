import { processForInstagram, type Crop, type CropAspect } from "./lib/image.js";
import { isCropAspect } from "../../src/lib/crop";
import type { SourceProfile } from "./lib/colour.js";

/**
 * Colour-safe Instagram copies for HQ (HQ's SPEC-STUDIO 45, piece 5).
 *
 * HQ took over the posts, but Sharp still cannot run on Cloudflare, and this
 * repo's Actions minutes are free. So HQ starts this workflow with the ids of
 * the photos it wants, and for each one this asks HQ for the full-size
 * original, makes the copy with exactly the pipeline the Scheduler's own
 * uploads use (one Sharp pass: crop, a real ICC conversion to sRGB, 1,440
 * wide, sRGB embedded, a missing profile flagged), and hands the copy and its
 * thumbnail back to HQ. Nothing here touches Supabase.
 *
 *   HQ_URL          https://hq.wilderpines.com
 *   HQ_RESIZER_KEY  the key HQ checks (a GitHub secret here, a Cloudflare secret there)
 *   IDS             comma-separated photo ids, from the workflow's input
 */

/** The whole batch must finish well inside the workflow's timeout. */
const TIME_BUDGET_MS = 12 * 60 * 1000;
const PROFILES = new Set<SourceProfile>(["srgb", "p3", "adobe-rgb"]);

type Fetch = typeof fetch;

export function parseIds(raw: string | undefined): string[] {
  return [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9-]{8,64}$/.test(s)))].slice(0, 50);
}

export function parseCrop(raw: string | null): Crop | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Record<string, unknown>;
    const ok = ["x", "y", "w", "h"].every((k) => typeof c[k] === "number" && Number.isFinite(c[k] as number));
    if (!ok) return null;
    const box = { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
    if (box.w <= 0 || box.h <= 0 || box.x < 0 || box.y < 0 || box.x + box.w > 1.0001 || box.y + box.h > 1.0001) return null;
    return box;
  } catch {
    return null;
  }
}

/** One photo: original in, copy out. Returns an error message, or null when it worked. */
export async function copyOne(hq: string, key: string, id: string, fetchFn: Fetch = fetch): Promise<string | null> {
  const headers = { "x-hq-resizer-key": key, "User-Agent": "scheduler-resizer" };
  const res = await fetchFn(`${hq}/api/ig-copies/original?id=${encodeURIComponent(id)}`, { headers });
  if (!res.ok) return `HQ did not send the original (${res.status})`;
  const input = Buffer.from(await res.arrayBuffer());
  const crop = parseCrop(res.headers.get("x-crop"));
  const aspectRaw = res.headers.get("x-aspect") ?? "";
  const aspect: CropAspect | null = isCropAspect(aspectRaw) ? aspectRaw : null;
  const assumedRaw = (res.headers.get("x-assumed-profile") ?? "") as SourceProfile;
  const assumed = PROFILES.has(assumedRaw) ? assumedRaw : null;

  const out = await processForInstagram(input, crop, assumed, crop ? null : aspect);

  const put = (part: "thumb" | "full", body: Buffer, extra: Record<string, string> = {}) =>
    fetchFn(`${hq}/api/ig-copies/copy?id=${encodeURIComponent(id)}&part=${part}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "image/jpeg", ...extra },
      body: new Uint8Array(body),
    });
  const thumb = await put("thumb", out.thumb);
  if (!thumb.ok) return `HQ did not take the thumbnail (${thumb.status})`;
  const full = await put("full", out.data, {
    "x-width": String(out.width),
    "x-height": String(out.height),
    "x-profile": (out.sourceColorProfile ?? "").replace(/[^\x20-\x7e]/g, "").slice(0, 120),
    "x-missing-profile": out.missingColorProfile ? "1" : "0",
  });
  if (!full.ok) return `HQ did not take the copy (${full.status})`;
  return null;
}

async function main() {
  const hq = String(process.env.HQ_URL ?? "").replace(/\/+$/, "");
  const key = String(process.env.HQ_RESIZER_KEY ?? "");
  const ids = parseIds(process.env.IDS);
  if (!/^https:\/\//.test(hq) || !key) throw new Error("Missing HQ_URL or HQ_RESIZER_KEY.");
  if (!ids.length) {
    console.log("No photos asked for.");
    return;
  }
  const started = Date.now();
  let done = 0;
  const failed: string[] = [];
  // One at a time: Sharp is memory-hungry and a runner is small.
  for (const id of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      failed.push(`${id}: out of time`);
      continue;
    }
    try {
      const error = await copyOne(hq, key, id);
      if (error) failed.push(`${id}: ${error}`);
      else done++;
    } catch (e) {
      failed.push(`${id}: ${(e as Error).message}`);
    }
  }
  console.log(`Made ${done} of ${ids.length} copies.`);
  if (failed.length) {
    console.error(failed.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("hq-copies.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
