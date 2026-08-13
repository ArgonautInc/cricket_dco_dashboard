# Spec: One-Sheeter Redesign (matching the reference PDF)

Status: Implemented
Owner: Emily McAndrew
Related file: `index.html` (One-Sheeter module — data layer, insight/rec
drafting, HTML templating, and the preview/export UI)

## Problem

Emily provided a real example one-sheeter
(`CRKT_Q3_2026_DCO_One-Sheeter_7.31.pdf`) and wanted the dashboard's
auto-generated One-Sheeter rebuilt to match its layout, metrics, and
section order. The prior version was simpler (6 KPI tiles, a basic
per-quarter breakdown table, 3 Top-5 tables) and — critically — silently
ignored the Overview tab's date-range filter (`ovDateFrom`/`ovDateTo`),
always aggregating whole quarters even when a specific date window was
selected.

## Decisions confirmed with Emily

- **Post-Click Destination Shift**: omitted entirely. No data source for
  it exists anywhere in this codebase (would require a new
  landing-page-destination tracking dimension not present in BigQuery or
  any upload path).
- **Key Insights / Recommendations**: auto-drafted from data, but rendered
  as editable content in the preview before export — the reference PDF's
  narrative (e.g. "Lean Into the S26 Ultra on Creative Versions") reads
  like hand-written campaign context that isn't derivable from numbers
  alone.
- **Multi-quarter comparison baseline**: when more than one quarter is
  selected (e.g. Overview's default Q1+Q2+Q3), the whole selection's
  totals are compared against the earliest selected quarter alone — an
  explicit, deliberate superset-vs-subset comparison, not a bug.
- **Header block**: also made editable in the preview (added after the
  initial build, same pattern as Insights/Recommendations) — Emily wanted
  the ability to hand-adjust the title/period label/prepared-by line too.

## Data gaps and how they were resolved

- **Landing Page Visits (raw count)**: didn't exist anywhere — only the
  `gmLpvr` ratio, on both `AN_STAGES` and `AN_CREATIVES`. Derived as
  `Math.round(imps * gmLpvr)`.
- **CPO (Cost Per Order)**: no such concept existed anywhere in the file.
  Derived as `spend / gmOrd`, returning `null` (not `0` or `Infinity`)
  when there are no orders.
- **TDOR at the creative level**: `AN_CREATIVES` has no `gmTdor` field
  (only stage rows do) — derived directly as `gmOrd / imps` per creative.
- **Creative-level Frequency**: confirmed unrecoverable from any data path
  in this codebase (not the static array, not live BigQuery, not the
  day-level breakdown query) — the reference PDF's Top-5-LPVR table has a
  "FREQ." column that was intentionally **omitted** rather than
  fabricated or shown as a misleading blank.
- **Funnel Efficiency table**: needed `spend`/`cpc` fields the date-filtered
  path of `computeStages()` doesn't return — built from
  `effectiveStageRows(dateFrom, dateTo)` instead, which always carries
  those fields regardless of whether day-level data is loaded.

## Methodology

### Period label

Three cases: a single full quarter, a single quarter with a date range
(showing whole calendar months remaining after the range, e.g. "Q3: July 3,
2026 – July 30, 2026 (August & September remaining)"), and a multi-quarter
selection (reuses the existing `qsLabel()` helper, e.g. "Q1 + Q2 + Q3").

### Comparison engine

- One quarter selected: compares against the immediately-prior quarter via
  a `{Q2:'Q1', Q3:'Q2'}` map. Q1 alone has no prior — the whole comparison
  box is hidden in that case.
- Multiple quarters selected: compares against the single earliest
  selected quarter alone (confirmed with Emily above).
- The previous period is **always a full quarter, never date-filtered**,
  in both cases.
- **Volume metrics** (Impressions, Clicks, Landing Page Visits, Orders,
  Total Cost) are normalized to daily pace before the percent-change is
  taken — dividing both periods' totals by their own day-count and then
  diffing is algebraically identical to a plain percent-change whenever
  the two day-counts already match, so this is applied unconditionally
  with no special-casing.
- **Rate metrics** (CTR, LPVR, CVR, TDOR, CPC, CPO) compare directly, no
  day-count involved.
- Day-count for a period uses the explicit date range if one is set;
  otherwise the full calendar-quarter span — except for whichever quarter
  is currently live, which uses elapsed-days-so-far (reusing the Trends
  tab's existing `trLiveQuarterInfo` concept) so daily pace isn't
  understated for an in-progress quarter with no date filter applied.

### Funnel Efficiency table

Segments sorted by the leading integer in their stage label (e.g.
`"1 - Mid Funnel"` before `"2 - Prospecting"` before `"10 - ..."`) —
matching this dashboard's existing stage-numbering convention and the
reference PDF's funnel-flow row order, not alphabetical or
impressions-based sorting. Each segment shows both the prior quarter's and
the current period's CPC and CPO side by side.

### Top-5 tables

Four tables, in this order: Orders, CPO (lowest first), LPVR, CTR. The CPO
table flags any creative under **25,000 impressions** as low-sample (an
asterisk + footnote) — matching the reference PDF's own stated "<25K imps"
threshold exactly, not an arbitrary number.

### Editable regions

The header block, Key Insights, and Recommendations are each rendered as
separate `contenteditable` regions in the preview (`id="oneSheetHeaderBlock"`,
`id="oneSheetInsightsList"`, `id="oneSheetRecsList"`), auto-drafted from the
computed model as a starting point. The Print/Download handlers read the
**live** (possibly hand-edited) content out of each element's `innerHTML`
at click-time — not the original auto-drafted strings — so edits actually
carry through to the exported/printed document. The final exported HTML
locks all three regions to `contenteditable="false"`.

This surfaced and fixed a real pre-existing bug: the old generated HTML
had an unconditional `window.onload = () => window.print()` script tag, so
opening the preview immediately triggered the browser's print dialog —
impossible to review or edit anything first. The new `buildOneSheetHtml`
only includes that auto-print script when explicitly building the final
export (`{autoPrint: true}`), never for the live preview.

## Verification

Every pure computation function (period day-count, LPV/TDOR/CPO
derivation, period label, comparison engine, segment aggregation, stage
sort order, creative row building, Top-N selection) was validated
standalone via `osascript -l JavaScript` against hand-built synthetic
fixtures before any HTML/DOM code was wired up — including a check that
the derived CPO ($436.12) matches the reference PDF's own stated campaign
CPO ($436), and that the period label string matches the reference PDF's
exact wording. A full integration test then validated `buildOneSheetHtml`
end-to-end against the real production code (not a reimplementation),
confirming: all expected sections render, Post-Click Destination Shift is
absent, Montserrat is used instead of Poppins, the preview never
auto-prints, and the final export's auto-print script tag closes properly
(a manual escaping error — a doubled backslash — was caught and fixed by
this check before it shipped).
