# Spec: Day-Aligned Quarter Comparison (Trends Tab)

Status: Draft — ready for implementation
Owner: Emily McAndrew
Related file: `index.html` (Trends tab module, ~line 4959–5358)

## Problem

The Trends summary table (`renderTrendSummaryTable`, index.html:5122) shows a
delta column between each pair of adjacent quarters (e.g. "Q2 → Q3"). Today
that delta is:

```
trGetVal(q, mkt, metric) = pvAggregate(AN_STAGES rows for that quarter, metric)
```

`AN_STAGES` holds each quarter's **full cumulative total** — there's no
day-level cutoff. When the later quarter is still in flight (e.g. Q3 started
Jul 1 and today is Jul 29 — 29 days in), the comparison is:

- Q2 = full ~91-day total
- Q3 = ~29-day-to-date total

The resulting delta % is not meaningful — Q3 will always look artificially
down simply because it hasn't finished yet, not because performance is
actually worse.

## Goal

When comparing a completed quarter against the **currently live** quarter,
align the comparison to the same number of elapsed days, so the delta
reflects "Q2 through day 29" vs "Q3 through day 29" instead of "all of Q2" vs
"Q3 so far."

## Decisions (confirmed with Emily)

1. **Comparison basis: cumulative through day N**, not a single day's raw
   number. E.g. "total orders in Q2's first 29 days" vs "total orders in Q3's
   first 29 days" — not just Q2's Day 29 vs Q3's Day 29 in isolation. This
   matches how pacing is normally read and avoids single-day noise (weekday
   effects, one bad delivery day).

2. **Day counting: calendar days since the quarter's start date.** Day 1 =
   the quarter's first calendar date (Jul 1 for Q3). Day N = N calendar days
   later, counting every day since quarter start whether or not it has data
   (a no-data day contributes $0 for that day, it isn't skipped). This means
   the "day count" is just `today − quarter start + 1`, not a count of rows
   with data.

3. **Raw column values stay as full totals.** The Q2 column always shows
   Q2's true full-quarter total, same as today. Only the delta computation
   (and its label/tooltip) changes to use the day-aligned comparison. We are
   not changing what the Q2 or Q3 columns display — avoids the same quarter
   showing different numbers depending on which column it's next to.

4. **Fallback when daily data isn't loaded:** `trDailyData` is only
   populated if BigQuery exposes a usable date column (see
   `tryLoadTrendDailyData`, index.html:5200) — this is not guaranteed; the
   code already has a "Daily view unavailable" notice path for when it
   fails. If daily data isn't available, keep today's behavior exactly
   (full-quarter vs to-date delta), but add a small note/tooltip on the
   affected delta cell indicating it's not day-aligned because daily
   breakdown data isn't loaded.

## Which quarter counts as "live"

There's currently no "is this quarter live" concept in the code — quarter
calendar bounds are only hardcoded ad hoc in a couple of unrelated places
(e.g. index.html:4622, used for the one-sheeter label). This spec introduces
a single shared source of truth:

```js
const TR_QUARTER_BOUNDS = {
  Q1: { start: '2026-01-01', end: '2026-03-31' },
  Q2: { start: '2026-04-01', end: '2026-06-30' },
  Q3: { start: '2026-07-01', end: '2026-09-30' },
};
```

A quarter is "live" if today's date falls within `[start, end]` inclusive.
At most one quarter is live at a time. Only the delta column whose
**right-hand (later) quarter is live** gets day-aligned; every other column
(comparisons entirely between completed quarters) keeps the existing
full-total-vs-full-total behavior unchanged.

Elapsed day count for the live quarter:
`daysLive = (today − liveQuarterStart) in days + 1`, clamped to the
quarter's total day count if that's ever exceeded (shouldn't happen in
practice, just a safety clamp).

## Behavior spec

For the summary table's delta cell between quarter A (earlier) and quarter B
(later, in `qs` order — see `TR_QS`):

- **If B is not live** (both A and B are completed quarters): no change.
  Delta = `pctChange(totalA_full, totalB_full)`, same as today.

- **If B is live and daily data is loaded (`trDailyData.length > 0`):**
  1. Compute `daysLive` for quarter B as above.
  2. Compute quarter A's day-clipped cumulative total: sum `trDailyData` rows
     where `r.q === A`, `r.mkt` matches the row's market filter, and the
     row's day falls within A's first `daysLive` calendar days (i.e.
     `r.day <= addDays(A.start, daysLive - 1)`), aggregated the same way
     `pvAggregate` aggregates today (so rate metrics like CTR/LPVR/CVR are
     recomputed from summed numerator/denominator over that clipped range,
     not averaged blindly).
  3. Compute quarter B's total the same way it's computed today (its
     to-date total, which is already effectively "through day `daysLive`"
     since B is live and has no data past today).
  4. Delta = `pctChange(totalA_clipped, totalB_todate)`.
  5. The **displayed Q(A) column value stays the full-quarter total**
     (decision #3) — only the number used inside the delta % differs from
     what's shown in the column to its left.
  6. Add a small inline label under/beside the delta, e.g.
     `vs Q2 Day 1–29`, and/or a title/tooltip attribute on the `<td>`
     explaining "Q2 compared through its first 29 days to match Q3's
     progress," so the delta doesn't look like a mismatch against the
     visibly-full Q2 column next to it.

- **If B is live and daily data is NOT loaded:** no change to the math
  (fall back to full-quarter vs to-date, same as today), but mark the delta
  cell with a note (e.g. a small muted icon/tooltip: "Not day-aligned —
  daily data unavailable for this quarter") so it's clear the comparison is
  apples-to-oranges rather than silently misleading.

## Scope notes / things intentionally NOT changing

- The **chart** (`trBuildSvg`) and its own QoQ delta annotations
  (index.html:5084–5099) are a separate rendering path from the summary
  table. This spec covers the **summary table only** unless Emily wants the
  chart's inline delta labels updated too — flagging this as a follow-up
  question before implementation, not assumed in scope.
- The Daily/Quarterly granularity toggle, date-range filter, and market
  filter behavior are unchanged.
- No change to how `AN_STAGES` full-quarter totals are computed or sourced.

## Open question before implementation

Should the chart's own QoQ delta labels (the small ▲/▼ % text drawn between
points in `trBuildSvg`, index.html:5084–5099) get the same day-aligned
treatment, or is this limited to the table underneath the chart? Table-only
is the simpler, lower-risk first cut — recommend starting there and
revisiting the chart labels separately once the table version is confirmed
to look right.
