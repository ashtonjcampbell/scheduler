# Shelved

Finished work, taken out of the app but kept where it can be found.

Nothing here is lost — git holds every version of everything forever — but a
deleted file is only findable by someone who knows it once existed. These are
the ones that were removed while still working, and might be wanted back.

## insights-page.tsx.txt

The "When to post" page. Measured how every post actually performed and asked
whether the day or the hour made any difference, with sample sizes and the odds
of each result being luck.

Removed because it was one page more than the app needed, not because it was
wrong. It stopped short of claiming things the data could not support, which is
most of the value in a page like that.

**The data is still being collected.** `worker/src/sync-performance.ts` keeps
running, so `media_performance` stays current and the page would come back with
full history rather than starting from the day it returns. Its supporting
pieces are all still in place and still tested:

- `src/lib/performance.ts` — the arithmetic
- `scripts/verify-performance.ts` — `npm run verify:performance`

To restore: move this file back to `src/app/(app)/insights/page.tsx`, rename it
to `.tsx`, and put the nav entry back in `src/components/nav-links.tsx`.
