"use client";

import { useCallback, useState } from "react";

/**
 * Drag to reorder a list of ids.
 *
 * Shared by the carousel strip and the grid preview: both are "put these in the
 * order they should appear", and having one implementation means dragging feels
 * the same in both rather than subtly different.
 *
 * Built on the browser's own drag events rather than tracking pointers by hand.
 * That buys the drag image, the cursor, autoscrolling near the edge of the
 * window and Escape-to-cancel for free — all of which have to be rebuilt, badly,
 * by anything using raw pointer events.
 *
 * The list reorders live as you drag over it, so what you see under the cursor
 * is already the result. The alternative — a gap that opens and a reorder that
 * happens on drop — makes you predict the outcome instead of seeing it.
 *
 * Arrow buttons stay alongside wherever this is used. Dragging is not reachable
 * by keyboard, and a list that can ONLY be dragged is a list some people cannot
 * reorder at all.
 */
export function useDragReorder(
  ids: readonly string[],
  onChange: (next: string[]) => void,
  /**
   * Called once when the drag finishes, for anything expensive.
   *
   * `onChange` fires on every tile crossed, which is right for redrawing and
   * wrong for saving — a drag across a grid would otherwise be a dozen writes,
   * most of them describing an arrangement nobody asked for.
   */
  onCommit?: (final: string[]) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [latest, setLatest] = useState<string[] | null>(null);

  const start = useCallback((id: string) => {
    setDragging(id);
  }, []);

  const enter = useCallback(
    (id: string) => {
      setOver(id);
      if (!dragging || dragging === id) return;

      const from = ids.indexOf(dragging);
      const to = ids.indexOf(id);
      if (from < 0 || to < 0) return;

      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, dragging);
      setLatest(next);
      onChange(next);
    },
    [dragging, ids, onChange],
  );

  const end = useCallback(() => {
    // Only when something actually moved: picking a tile up and putting it back
    // is not a change, and should not be written as one.
    if (latest && dragging) onCommit?.(latest);

    setDragging(null);
    setOver(null);
    setLatest(null);
  }, [latest, dragging, onCommit]);

  /**
   * Spread onto each item. `preventDefault` on dragOver is what marks an
   * element as a valid drop target — without it the browser refuses the drop
   * and animates the item snapping back, even though the reorder already
   * happened.
   */
  const itemProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = "move";

        /*
         * Set the payload ourselves.
         *
         * A tile is a link wrapping an image, so left to itself the browser
         * would drag the URL or the picture. Writing our own data first
         * replaces that — which is why the link no longer has to be marked
         * undraggable to stay out of the way.
         *
         * Marking it undraggable is in fact what broke this: an element with
         * draggable="false" under the cursor stops the drag beginning at all,
         * however willing its parent is, and the link covered the whole tile.
         */
        event.dataTransfer.setData("text/plain", id);
        start(id);
      },
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDragEnter: () => enter(id),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        end();
      },
      onDragEnd: end,
    }),
    [start, enter, end],
  );

  return { dragging, over, itemProps };
}

/** Move one item by hand, for the arrow buttons that sit beside the dragging. */
export function moveBy(ids: readonly string[], index: number, delta: number): string[] {
  const to = index + delta;
  if (to < 0 || to >= ids.length) return [...ids];

  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}
