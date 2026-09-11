"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPacific } from "@/lib/time";
import type { PostStatus } from "@/lib/database.types";
import { useDragReorder } from "@/components/use-drag-reorder";
import { reorderQueue } from "../queue/actions";

export type Tile = {
  id: string;
  title: string | null;
  caption: string;
  status: PostStatus;
  was_dry_run: boolean;
  at: string | null;
  cover: string | null;
  photos: number;
};

export type LiveTile = {
  id: string;
  permalink: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  caption: string | null;
  media_type: string | null;
};

/**
 * The grid, with queued posts draggable into a different order.
 *
 * TWO ORDERS MEET HERE, and they run opposite ways. The grid is newest-first,
 * the way Instagram shows a profile, so the top-left tile is whatever publishes
 * LAST. The queue is next-first, so position 0 is whatever publishes SOONEST.
 * Dragging therefore reverses before it saves; getting that backwards would
 * quietly turn the schedule upside down.
 *
 * What moves is the POST, not the slot. Each queued tile keeps the time it had
 * — those come from the weekly timetable and belong to the position in the
 * grid, not to whatever is sitting in it. Dragging swaps which post lands on
 * which date, which is the question being asked when someone rearranges a grid.
 *
 * Only queued posts move. A scheduled post is pinned to an exact instant by
 * hand and a published one already happened, so neither is the queue's to
 * shuffle; both stay put and the queued posts rearrange around them.
 */
export function GridBoard({
  planned,
  live,
  username,
}: {
  planned: Tile[];
  live: LiveTile[];
  username: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const queuedIds = planned.filter((t) => t.status === "queued").map((t) => t.id);
  const fromServer = queuedIds.join(",");

  // Held locally so a drag redraws instantly; the server hears about it once,
  // on drop.
  const [order, setOrder] = useState<string[]>(queuedIds);
  const [basis, setBasis] = useState(fromServer);

  // Whenever the server's idea of the queue changes — a post queued elsewhere,
  // a reorder saved, a failure rolled back — start again from that. Adjusting
  // during render rather than in an effect avoids a frame showing the old set.
  if (basis !== fromServer) {
    setBasis(fromServer);
    setOrder(queuedIds);
  }

  const commit = (next: string[]) => {
    setError(null);

    startTransition(async () => {
      // Newest-first on screen, next-first in the queue.
      const result = await reorderQueue([...next].reverse());
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const { dragging, itemProps } = useDragReorder(order, setOrder, commit);

  const byId = new Map(planned.map((t) => [t.id, t]));

  // Walk the layout, substituting the dragged order into the slots that queued
  // posts occupy. Everything else keeps its place.
  let slot = 0;
  const laidOut = planned.map((tile) => {
    if (tile.status !== "queued") return { tile, occupant: tile };
    const occupant = byId.get(order[slot++] ?? tile.id) ?? tile;
    return { tile, occupant };
  });

  return (
    <div className="space-y-3">
      {queuedIds.length > 1 && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Drag a queued post to move it — the dates stay put and the posts move
          between them.
        </p>
      )}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className={pending ? "mx-auto max-w-md opacity-60" : "mx-auto max-w-md"}>
        <div className="grid grid-cols-3 gap-0.5">
          {laidOut.map(({ tile, occupant }) => {
            const draggable = tile.status === "queued";

            return (
              <div
                key={tile.id}
                {...(draggable ? itemProps(occupant.id) : {})}
                className={
                  draggable
                    ? dragging === occupant.id
                      ? "relative aspect-[4/5] cursor-grabbing opacity-40"
                      : "relative aspect-[4/5] cursor-grab"
                    : "relative aspect-[4/5]"
                }
              >
                <Link
                  href={`/posts/${occupant.id}`}
                  // A link inside a draggable element starts its own drag of the
                  // URL, which cancels the reorder before it begins.
                  draggable={false}
                  title={`${occupant.title ?? firstLine(occupant.caption) ?? "Untitled"}${
                    tile.at ? ` — ${formatPacific(tile.at)}` : ""
                  }`}
                  className="group block h-full w-full overflow-hidden bg-stone-100 dark:bg-stone-950"
                >
                  {occupant.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={occupant.cover}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className={
                        occupant.status === "published"
                          ? "h-full w-full object-cover"
                          : "h-full w-full object-cover opacity-70 transition group-hover:opacity-100"
                      }
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-stone-400">
                      no photo
                    </span>
                  )}

                  {occupant.photos > 1 && (
                    <span className="absolute right-1 top-1 rounded bg-stone-900/70 px-1 text-[9px] font-medium text-white">
                      ⧉ {occupant.photos}
                    </span>
                  )}

                  <StatusDot status={occupant.status} dryRun={occupant.was_dry_run} />

                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/80 to-transparent px-1 pb-0.5 pt-3 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                    {tile.at ? formatPacific(tile.at) : "preview draft"}
                  </span>
                </Link>
              </div>
            );
          })}

          {/* Already live. Same grid, same flow — no heading, no row break. */}
          {live.map((item) => (
            <a
              key={item.id}
              href={item.permalink ?? "#"}
              target="_blank"
              rel="noreferrer"
              title={item.caption ?? `Already on @${username ?? "instagram"}`}
              className="relative block aspect-[4/5] overflow-hidden bg-stone-100 dark:bg-stone-950"
            >
              {/* A reel's media_url is the video file, which no <img> can
                  show. Its thumbnail_url is the still Instagram puts on the
                  grid, so that comes first. */}
              {item.media_type === "VIDEO" && (
                <span
                  aria-hidden
                  title="Reel"
                  className="absolute right-1 top-1 text-[11px] leading-none text-white drop-shadow"
                >
                  ▶
                </span>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.thumbnail_url ?? item.media_url ?? ""}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status, dryRun }: { status: PostStatus; dryRun: boolean }) {
  const colour =
    status === "published"
      ? dryRun
        ? "bg-amber-500"
        : "bg-emerald-500"
      : status === "preview_draft"
        ? "bg-stone-400"
        : "bg-sky-500";

  return (
    <span
      className={`absolute left-1 top-1 h-2 w-2 rounded-full ring-1 ring-white/70 ${colour}`}
      title={dryRun ? "Published in dry run — not really posted" : status}
    />
  );
}

function firstLine(caption: string): string | null {
  const line = caption.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
