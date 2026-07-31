# Spec: Creative Performance Scoring (Creatives tab, Phase 1)

Status: Draft — ready for implementation
Owner: Emily McAndrew
Related file: `index.html` (new module, inserted near the end of the existing
Creatives tab module, ~line 4606)

## Problem

Emily has a metrics glossary (CTR, LPVR, CVR, TDOR, video/social engagement
metrics, Benchmark Groups, Composite Score, Peer Rank — plus a Fatigue
Monitor and Recommendations engine deferred to a later phase) that describes
a creative-level performance scoring system. None of this exists in
`cricket-dashboard` today: the Creatives tab only shows Flashtalking/BigQuery
delivery data (`AN_CREATIVES`), which is quarter-level, has no Creative ID,
no Publisher/Funnel/Ad Type dimensions, and no video/social columns. The new
system is for a different, platform-agnostic creative export format
(Meta/Pandora/Spotify/Reddit-style crosstabs).

## Goal

Add a "Performance Scoring" sub-view inside the existing Creatives tab
(confirmed with Emily: same tab, not a new nav item) that lets her upload a
creative performance crosstab export, optionally join a Creative-ID Lookup
Table, and see per-creative CTR/LPVR/CVR/TDOR/video/social metrics compared
against Benchmark Groups, with a weighted Composite Score and Peer Rank.

This is Phase 1 only. Fatigue Monitor, Recommendations, and AIPE are
deferred — see "Deferred to Phase 2" below.

## Decisions (confirmed with Emily)

1. **Same tab, new sub-view.** A toggle inside `#tab-creatives` switches
   between "Creative Library" (existing card grid, untouched) and
   "Performance Scoring" (new). The two features are fully independent —
   different data, different storage, different UI — they just share a nav
   entry point.
2. **Phase the build.** This pass covers upload + Lookup Table join + core
   metrics + Benchmark Groups + Composite Score + Peer Rank. Fatigue
   Monitor + Recommendations + AIPE come later.
3. **Build from the glossary's column names now.** No real sample export
   file was available at build time — the parser is written against the
   column names/synonyms in the glossary, forgiving of case/whitespace, and
   will be corrected against a real file afterward.

## Data model

### Upload formats

**Creative_DownloadCrosstab** — required columns (any of the listed
synonyms, matched case/whitespace-insensitively):

| Field | Accepted headers |
|---|---|
| Creative ID | `Creative Id`, `Creative ID` |
| Publisher | `Publisher`, `Group` |
| Funnel | `Funnel` |
| Ad Type | `Ad Type` |
| Date Breakdown | `Date Breakdown` |
| Impressions | `Impressions` |
| Clicks | `Clicks` |
| Landing Page Visits | `Landing Page Visits` |
| Total Device Orders | `Total Device Orders` |

Optional enrichment columns (resolve to `null`/absent when not found — this
is itself meaningful, see Social ER below):

| Field | Accepted headers |
|---|---|
| Video Completes | `100% Video Completes`, `VCOMP` |
| VV25 | `VV25`, `Video Views To 25 Percent` |
| Social Engagements | `Social Engagements`, `Engagements` |
| Campaign Name | `Campaign Name` (stored now, unused until Phase 2's AIPE) |

If any of the 8 required columns can't be found, the upload **hard-fails**
with a specific message (e.g. "Couldn't find a 'Landing Page Visits'
column") rather than silently defaulting missing values to 0 — this is a
primary metric input, not an optional enrichment, and silent zeroing would
quietly corrupt every downstream metric.

**Lookup Table** — any CSV/XLSX with a `Creative ID` (or `Creative Id`)
column. Every other column becomes an extra filterable dimension, joined
onto Performance Scoring rows by Creative ID.

### Dataset Type

Explicit selector at upload time: **Daily** (row per creative × publisher ×
funnel × date), **Monthly** (aggregated to month), or **Summary** (full-
period totals, no date breakdown). Not auto-detected — a wrong guess would
silently misclassify data, and this is a simple explicit choice for the
user to make correctly. Each dataset type is stored and scored
independently.

### Scoring-row grain

A "creative" for benchmarking/scoring purposes is the tuple **(Creative ID,
Publisher, Funnel, Ad Type)**, summed across every Date Breakdown row
currently in scope (all days for Daily, all months for Monthly, the single
period for Summary — further narrowed by whatever Publisher/Funnel/Ad
Type/search/Lookup filters are active). If the same Creative ID legitimately
appears under two Ad Types, that's two distinct scoring rows — this is what
makes "every creative belongs to exactly one Benchmark Group" true.

**Raw counts are always summed first, then divided once** — metrics are
never computed by averaging per-day/per-row rates.

## Metric formulas

| Metric | Formula | Null when |
|---|---|---|
| CTR | Clicks ÷ Impressions | Impressions = 0 |
| LPVR | Landing Page Views ÷ Impressions | Impressions = 0 |
| CVR | Total Device Orders ÷ Landing Page Views | Landing Page Views = 0 |
| TDOR | Total Device Orders ÷ Impressions | Impressions = 0 |
| VCR 100% | Video Completes ÷ Impressions | Impressions = 0 **or** Video Completes = 0 |
| VVR 25% | VV25 ÷ Impressions | Impressions = 0 **or** VV25 = 0 |
| Rate of Completion | Video Completes ÷ VV25 (raw counts) | VV25 = 0 |
| Social ER | Social Engagements ÷ Impressions | Impressions = 0, or the Social Engagements column wasn't found anywhere in this upload |

Notes:

- **TDOR is computed directly** (`Orders / Impressions`), not as
  `CVR × LPVR` — this keeps TDOR defined even when CVR is null (LPV = 0)
  but Impressions > 0. The identity `TDOR ≈ CVR × LPVR` (when both are
  defined) is used only as a sanity check in verification, never as the
  implementation.
- **Rate of Completion** is computed from the raw `Video Completes` and
  `VV25` counts, not from dividing `VCR100% / VVR25%` — mathematically
  equivalent when both are defined (the Impressions denominators cancel),
  but safer: computing it as a ratio-of-ratios would incorrectly produce
  `null / valid` in edge cases the raw-count division doesn't have.
- **Social ER's two null conditions are different in kind.** Impressions=0
  on a row that has the column is a real 0% and should display as such.
  The column being **absent from the whole upload** is a dataset-level
  condition — the Social ER column (and its benchmark) should be hidden
  entirely for that dataset, not shown as null on every row.

## Benchmark Groups

**Benchmark Group** = Publisher × Funnel × Ad Type. Every scoring row
belongs to exactly one.

**Benchmark value** for a metric = the **median** across benchmark-group
members that have a non-null value for that metric (median, not mean —
creative performance data is right-skewed). **N/A** when zero members have
a valid value (e.g. an all-Static Ad Type group → VCR100%/VVR25%/Rate of
Completion all N/A, since Static creatives have no video data).

Groups with fewer than 2 members are still shown, but flagged (e.g. a
tooltip: "only 1 creative in this group — treat with caution").

Benchmarks needed: Benchmark CTR, LPVR, CVR, TDOR, VCR100%, VVR25%, Rate of
Completion, Social ER (when the column exists in this dataset).

## Composite Score & Peer Rank

**Peer Group** = Publisher × Funnel (broader than Benchmark Group — no Ad
Type split).

**Percentile Rank** (computed only for TDOR, CVR, LPVR, CTR) = the fraction
of peer-group rows with a non-null value **≤** this row's value, among rows
that have a non-null value for that metric. A row with a null value for a
metric gets `null` percentile for that metric, and is excluded from the
ranking pool entirely for it (it neither ranks nor affects others'
denominator).

**Composite Score** = `100 × (0.35×TDORpct + 0.30×CVRpct + 0.20×LPVRpct + 0.15×CTRpct)`.

**If any of the 4 required percentiles is null, Composite Score is null**
for that row (shown as "N/A — insufficient data" with a tooltip naming the
missing metric). Weight is **not** silently redistributed across the
remaining metrics when one is missing — a partial score computed from fewer
inputs would look identical to a full score, which risks overstating
confidence in thin data. If this default turns out to be too strict in
practice (e.g. most Static creatives end up unscored because video metrics
aren't part of the composite anyway — actually Static rows are unaffected
since the composite only uses TDOR/CVR/LPVR/CTR, all of which come from the
required columns), we can revisit.

**Peer Rank** = 1-based ordinal position by Composite Score descending,
among peer-group rows that have a score. Displayed as "position / total-
scored" (e.g. "2 / 3") — the denominator is the count of *scored* peers,
not the group's full member count, since unscored rows can't be
meaningfully interleaved into the ordering.

## Lookup Table join

- Uploading a Lookup Table **fully replaces** the previous one (it's a
  reference table, not incremental data — unlike the crosstab upload,
  there's no "fill in the gaps" merge).
- The join happens **at render time only**, by Creative ID — never baked
  into the stored crosstab rows, and the joined columns are never part of
  the Benchmark/Peer Group keys (those stay strictly Publisher × Funnel ×
  Ad Type).
- Re-uploading a new crosstab file just updates the stored dataset (upsert
  by `Creative ID | Publisher | Funnel | Ad Type | Date Breakdown`, so new
  dates merge in and re-uploaded dates overwrite, last upload wins); the
  previously uploaded Lookup Table keeps auto-joining against it with no
  extra action needed.
- A Creative ID present in the crosstab but absent from the Lookup Table
  just shows blank/"—" for the extra dimension columns — it's still fully
  scoreable on the core metrics.

## Scope notes

- This sub-view is fully independent from the existing Flashtalking
  Creatives card grid (`AN_CREATIVES`, `crCardHTML`, `renderCreatives`) —
  no shared state, no shared storage key, no shared rendering code.
- New localStorage keys: `crkt_ps_crosstab_v1` (the three dataset-type
  arrays) and `crkt_ps_lookup_v1` (the lookup table).
- The Glossary tab gets a new `scoring` category with entries for the new
  terms (mechanical addition, reuses the existing term-array/render code).

## Deferred to Phase 2

Fatigue Monitor (Baseline/Current/ΔPct, 7-day rolling average, OLS
regression + confidence interval for decay detection, CUSUM changepoint
detection, Half-Life projection, Confidence Tier, Refresh Priority Score),
the Recommendations engine (Keep / Keep+Refresh / Monitor / Rotate Out /
Reduce / Cut / Deprioritize / Refresh Now), and AIPE campaign-tactic
classification. All of these need per-creative-per-day time series, which
this phase's Daily dataset type already stores — so Phase 2 builds on top
of this data model rather than reworking it.
