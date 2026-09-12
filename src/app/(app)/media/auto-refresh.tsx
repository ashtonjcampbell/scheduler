"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls while photos are mid-pipeline, and backs off as it goes.
 *
 * The work happens in GitHub Actions, so nothing pushes a result back to the
 * browser — without this, a finished photo would sit as "Waiting to process"
 * until the page was reloaded by hand. Mounted only while something is
 * actually in flight, so an idle media bank makes no requests at all.
 *
 * IT USED TO POLL EVERY FIVE SECONDS, FOREVER. That is right for the ordinary
 * case — drop in three photos, watch them land — and badly wrong for the case
 * that actually broke things: re-cropping a whole library took about twenty
 * minutes, which at five seconds is some two hundred and forty full renders of
 * a page that loads every photo you own. Cloudflare's own numbers put every
 * resource failure this app has had inside three hours, and that was one of
 * them.
 *
 * So it starts quick and slows down. The first minute is as responsive as
 * before, and a long job settles to a check every half minute — which is
 * plenty, because nobody watches a twenty-minute job second by second.
 */

/** Milliseconds between checks, each used once before moving to the next. */
const STEPS = [5_000, 5_000, 5_000, 7_000, 7_000, 10_000, 10_000, 15_000, 20_000];

/** Where it settles for the long haul. */
const SETTLED = 30_000;

export function AutoRefresh() {
  const router = useRouter();

  // Kept in a ref so a tick can schedule the next one without re-running the
  // effect, which would reset the backoff to the beginning every time.
  const step = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      /*
       * A hidden tab is not watching, so it is not asked to render — and a
       * phone with the tab in the background is not kept awake. The clock
       * keeps running, so coming back to the tab gets a fresh page at the
       * next tick rather than waiting for a new cycle.
       */
      if (document.visibilityState === "visible") router.refresh();

      const wait = STEPS[step.current] ?? SETTLED;
      step.current += 1;

      timer = setTimeout(tick, wait);
    };

    timer = setTimeout(tick, STEPS[0]);

    return () => clearTimeout(timer);
  }, [router]);

  return null;
}
