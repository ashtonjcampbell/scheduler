# Ideas not yet built

Parked deliberately, with what is actually feasible written down so it does not
have to be re-researched later.

## Hashtag research

Wanting to find tags, see their popularity, and discover related ones. Three
separate problems with three different answers.

### Refreshing volumes — feasible

Instagram's Hashtag Search API returns a tag's `media_count`: the same number
the spreadsheet held, straight from Instagram rather than typed in by hand.
Stored volumes go stale, and stale volumes quietly corrupt every decision the
shuffle's volume band makes.

**The catch:** Meta limits an app to roughly **30 unique hashtags per rolling
7 days** per Instagram account. That is a hard cap, so a bulk refresh of a
95-tag library is not possible in one go.

It does, however, fit the existing cron perfectly: refresh the 30
least-recently-checked tags each week and the whole library stays current on a
rolling three-week cycle, at no cost and with no effort. Worth doing once the
Instagram connection exists.

### Checking a tag before saving it — feasible

The same endpoint answers "does this tag exist and how big is it" for one tag
at a time. Useful when adding a tag by hand — but every lookup spends one of
the 30 weekly slots, so it must be deliberate, not a keystroke-by-keystroke
search.

### Finding related tags — partly feasible

Instagram has no "related hashtags" endpoint. What it does have is **top media
for a hashtag**, and those captions contain the hashtags real accounts used
alongside it. Harvesting co-occurring tags from that is genuine observed data
about what pairs with what — not a guess, and not generation.

Also bounded by the 30-per-7-days cap, so it would be a slow, deliberate
"research this tag" action rather than an always-on suggestion engine.

**Not an option:** third-party hashtag research services. They are paid, which
breaks the free-tier rule, and scraping Instagram breaks their terms.

**Also not an option:** having a model invent or suggest hashtags. That is the
project's absolute rule (see AGENTS.md). Everything above reports numbers
Instagram itself publishes, or tags that real posts actually used. Nothing is
generated.

## Reinterpreting a missing colour profile — BUILT

This was listed here as hard. It is now done; the note is kept because the
reasoning is worth not relitigating.

Sharp converts FROM an embedded profile and has no way to reinterpret a file
that has none. Two routes work: splice a profile into the file (verified, but
format-specific — an APP2 marker for JPEG, an iCCP chunk for PNG), or do the
transform directly. The direct route was chosen because it is
format-independent and, crucially, checkable: the maths is asserted against
Sharp own lcms conversion and agrees to within one level out of 255.

See worker/src/lib/colour.ts.
