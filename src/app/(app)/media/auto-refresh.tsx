"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls while photos are mid-pipeline.
 *
 * The work happens in GitHub Actions, so nothing pushes a result back to the
 * browser — without this, a finished photo would sit as "Waiting to process"
 * until the page was reloaded by hand. Mounted only while something is
 * actually in flight, so an idle media bank makes no requests at all.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      // Pointless while the tab is in the background, and it would keep a
      // phone awake.
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);

    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
