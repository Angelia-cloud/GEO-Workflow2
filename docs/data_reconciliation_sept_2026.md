# Data reconciliation: September 2026 report vs Supabase vs live API

> **Update (Oct 2026):** the Coogee data was reset and re-imported from the two RankScale CSVs (Sep export 1,814 and Oct export 1,543 new measurements; 3,357 total). The September report is no longer a static page: all figures come from live Supabase measurements by Sydney calendar month (September detection 47.74%). The previously published 48.5% figure is retained only as history and cannot be reproduced from stored data.

Property: InterContinental Sydney Coogee Beach (`9ff3cbe8-bbb5-4e8e-8eb0-11e0e8737e45`). Investigated in Stage 1.
The published September report (`PreparedReport.jsx`) has **not** been changed.

## 1. Figures side by side

| Source | Detection | Answers | Period | Matching definition |
|---|---|---|---|---|
| Published September report | 48.5% (879 mentions) | 1,814 | "1-30 September", 22 questions, 6 assistants | Not documented in the data |
| Supabase, RankScale batch only (verified) | **43.9%** (796) | 1,814 | 19 Aug - 16 Sep 2026 UTC (20 Aug - 17 Sep Sydney) | RankScale `brand_found` |
| Same rows, any hotel alias | 47.6% (863) | 1,814 | same | `brand_found_any_alias` (Shutters, Rick Stein, Eliva Spa, old Crowne Plaza names) |
| Live `/api/report` before the fix | 45.06% | rolling 30 days to 2 Oct | 3 Sep - 2 Oct | RankScale match, **including synthetic rows** |

## 2. Why they differed

1. **Synthetic test data was mixed into production measurements** (`measurements.import_batch` is free text):
   - `889c8d26-e332-40de-9ae5-0ca2fd2bc27b`: 600 rows from `Rankscale_major_impact_synthetic_600_rows.csv`, responses start "SYNTHETIC TEST RESULT:", 100% brand found, dated 1-13 Sep.
   - `65ddf4af-6fb8-4187-8b71-ce34e9e896d5`: 54 "Lantern Bay" rows, 3 extra prompts/intents, dated 1 Jul and 2 Oct. These pushed the live report's end date to 2 Oct, so its rolling 30-day window and rate were contaminated.
   - `rankscale_records` (the Upload page's "Saved history") also holds these 54 Lantern Bay rows for Coogee. It is a separate store and does not feed the chatbot or `/api/report`.
2. **The real batch** `rankscale:2026-09-24` has exactly 1,814 rows, matching the published answer count. So the published "September" figure covers the whole export (19 Aug - 16 Sep), not calendar September.
3. **Matching definition.** `/api/report` defaults to RankScale's own match (43.9%); counting aliases gives 47.6%.
4. **Unexplained gap.** Neither definition gives the published 879 (RankScale -83, alias -16). The published figure may include human-reviewed matches; the stored rows cannot reproduce it.
5. **Not reproducible:** published July (843/1,848) and August (767/1,750). Supabase has no real measurements before 19 Aug 2026.
6. **Timezone.** Report days use Australia/Sydney, so the same rows show as 20 Aug - 17 Sep.
7. The published "Claude setting changed 31 Aug" is a methodology note; the real data has Claude from 19 Aug.

## 3. What changed

- `db/12_data_provenance.sql` adds `import_batch_provenance` and flags the two synthetic batches. `v_measurements_flat` now excludes any batch flagged other than `verified`, so every view, report, review queue and the chatbot uses verified data. **No rows were deleted or edited**; unflag a batch by changing its `data_origin`.
- After the change Coogee has 1,814 answers, 22 prompts, 6 assistants, 19 Aug - 16 Sep 2026.
- The report's prompt count now only counts prompts that have verified measurements (was 25, now 22).
- Chatbot context is built on the server (`app/services/report_context.py`) and states the period and metric definitions; it ignores anything the browser sends. `POST /api/report-assistant/ask` (client-supplied context) now returns 410.

## 4. Open items

- Confirm with the analyst how 879 was derived (human review? different export?).
- 20 stored insights and 4 alerts were generated before the exclusion; regenerate them (`/api/insights/generate`) once the team agrees, as that rewrites stored rows.
- Three recommendations titled "Publish page" with detail "do it" are test records; they are filtered out of the chatbot but remain in the table.
- The 16 "Pre-schema baseline" benchmark rows are back-calculated (`is_derived`); the chatbot says so.

## Status of the published 48.5% figure

The 879 / 48.5% September figure cannot be reproduced from the stored RankScale measurements under any tested filter. It is kept here as the published history only; the dashboard reports the stored measurements (September: 866 of 1,814 answers, 47.74%).
