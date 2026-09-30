# GEO Automation Platform (V1)

This is the human-in-the-loop GEO system for the InterContinental Sydney Coogee Beach pilot.

**Stack:** React (Vite) + Python (FastAPI) + Supabase (Postgres) + Groq running GPT-OSS 20B for the agents.

- **Workflow 1:** upload a Rankscale export → validate and clean it → save it to Supabase → dashboard.
- **Diagnosis agent:** explains why the hotel did or didn't appear in an answer and proposes draft recommendations. People review them.
- **Upstream prompt-generation agents** (3): produce new prompts to track, exported as a file to import into Rankscale.

```
geo-platform/
├── app/                    FastAPI backend and Python business logic
│   ├── main.py             all API endpoints
│   ├── ingest.py           file parsing, cleaning, validation
│   └── loader.py           transactional load into Supabase
├── frontend/               React + JSX application, Vite build and API client
│   └── src/                app shell, reusable components and workflow pages
├── app/static/             retained legacy HTML/CSS/JS frontend and shared styles
├── agents/
│   ├── llm.py              one interface for Groq (default) / Anthropic / OpenAI, plus a test stub
│   ├── diagnosis/          diagnosis agent: input brief, system prompt, output schema
│   └── prompt_generation/  Intent Mapper → Prompt Writer → Prompt QA, plus property briefs
├── db/                     SQL migrations and scripts (run in the Supabase SQL Editor)
├── docs/                   data spec, diagnosis framework, prompt-generation design
├── scripts/convert_rankscale.py   stand-alone converter (no server needed)
├── sample_data/            a one-week slice of the Coogee export for tests
└── tests/                  end-to-end tests against a real Postgres
```

## 1. Set up Supabase (once)

In the SQL Editor, run these in order:

| Step | File | What it does |
|---|---|---|
| 1 | `db/00_drop_all.sql` | *Only if you've set it up before.* Deletes the old GEO tables. Use `00_reset.sql` instead to keep a backup. |
| 2 | `db/01_schema.sql` | Creates all tables, keys, triggers and security policies |
| 3 | `db/02_staging_table.sql` | Creates the holding table the import uses internally |
| 4 | `db/06_dashboard_views.sql` | Creates the views the dashboard reads |
| 5 | `db/07_report.sql` | Adds the monthly-report model: neutral prompt set, tracked competitors, benchmarks, source categories, report notes |
| 6 | `db/08_import_review.sql` | Adds per-upload review rows so validation/mapping can wait for human confirmation before measurement save |
| 7 | `db/09_workflow2.sql` | Workflow 2 additions: auto alerts, insight review, learning memory, agent versions, outcome logging |
| 8 | `db/10_import_performance.sql` | Adds the measurement batch index used to keep import maintenance scoped and fast |

Run `db/08_import_review.sql` after the existing schema/report scripts when upgrading an existing database. It adds review-only row storage and UUID mapping columns to the transient staging table; it does not alter measurement, prompt, intent, engine, or competitor tables.

Then load data one of two ways:
- **Recommended:** start the app (below) and use the **Upload data** tab with the file exactly as Rankscale downloads it.
- **Manual:** convert the file with `python scripts/convert_rankscale.py export.csv`, import the result into `stg_rankscale_export` in Table Editor, then run `db/03_load_rankscale.sql`.

The React **Data & Uploads** workflow uses the explicit `POST /api/import-reviews` → mapping review → confirmed `/save` flow. It requires `db/08_import_review.sql` on the database first. It persists parsed rows in `import_review_rows`, resolves property/prompt/engine/competitor IDs for review, then runs the existing transactional RankScale loader after explicit confirmation. The older `/api/imports` direct-load endpoint remains available for existing integrations.
| POST | `/api/import-reviews` | Validate and create a pending RankScale mapping review without writing measurements |
| GET | `/api/import-reviews/{batch_id}` | Resume a pending mapping review |
| PUT | `/api/import-reviews/{batch_id}/mapping` | Resolve property, prompt, engine and competitor mappings; record review acknowledgements |
| POST | `/api/import-reviews/{batch_id}/save` | Require explicit confirmation, then save mapped rows through the existing transaction |

After the first load, you can run `db/04_coogee_example.sql` (the worked Coogee test case) and `db/05_verify.sql` (the acceptance checks).

## 2. Run the app

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # then fill in DATABASE_URL and GROQ_API_KEY
npm --prefix frontend install
npm --prefix frontend run build
uvicorn app.main:app --reload
```

Open http://localhost:8000 for the React UI, or http://localhost:8000/docs for the API explorer. FastAPI serves the production bundle from `frontend/dist`; until that bundle is built, `/` falls back to the retained legacy UI in `app/static/index.html`.

For frontend development with hot reload, keep FastAPI running on port 8001 and run `npm --prefix frontend run dev`; Vite serves the React UI at http://127.0.0.1:5173 and proxies `/api` requests to FastAPI. Set `VITE_API_TARGET` to override that backend address.

The React application is organized under `frontend/src`: `App.jsx` owns the sidebar, property picker, reporting period and page selection; `components.jsx` contains shared cards, tables, badges, notices, metric grids and drawers; `api.js` centralizes REST/error handling; `pages/ReportPages.jsx` contains dashboard, intelligence, engines, competitive, intent, report and settings pages; `pages/WorkflowPages.jsx` contains uploads, evidence/diagnosis, human review and prompt generation. The older `app/static/app.js`, `ui.js`, `report.js` and `index.html` are no longer used when the React build exists, but remain available as a fallback during the migration. The existing CSS files are imported by Vite and continue to provide the UI and printable-report styling.

`DATABASE_URL` comes from Supabase → **Connect** → **Session pooler** → URI (port 5432). The app talks to Postgres directly, so it doesn't need the anon or service keys.

## The Report tab

The Report tab is the monthly Komosion GEO report, rebuilt live from Supabase. It has the same sections as the August 2026 PDF: executive overview, performance overview, prompt sets, competitive position, neutral benchmark, intent intelligence, why AI chooses, source intelligence, and engagement. Pick the period (last 30 days, a calendar month, or a custom range), choose whether to count the hotel by Rankscale's detection or by every confirmed name, and click **Print / save as PDF** to get a client-ready copy.

**Metrics** reproduce Rankscale's own numbers:

| Metric | Definition |
|---|---|
| Visibility Score | Average answer score. An answer scores 100 ÷ (1 + 0.1 × (rank − 1)) when the hotel is mentioned (rank 1 = 100, rank 2 = 90.9, rank 3 = 83.3) and 0 when it isn't. This matches the per-row scores in the Rankscale export exactly. |
| Detection Rate | % of answers that mention the hotel |
| Average Position | Average rank, counting only answers that mention the hotel |
| Top 3 | % of answers where the hotel ranks 1–3 |
| Sentiment Score | Average sentiment × 100, counting only answers that mention the hotel |

**What you can change** (all rows live in Supabase):

| To change… | Edit |
|---|---|
| The tracked competitor set, or a competitor's name variants | `competitor_groups` |
| Which prompts count as neutral (the 17-prompt set) | `neutral_exclusion_terms`: any prompt containing a listed term is brand/location-specific |
| Baselines, benchmarks and targets | `benchmarks`, or `PUT /api/report/{property_id}/benchmarks` |
| How a cited domain is grouped | `source_categories` (LIKE patterns) or `properties.own_domains` |
| "What we'll monitor next" | Type in the box on the Report tab; it saves per reporting period |

The pre-schema baseline figures were back-calculated from the movements in the Aug 2026 report (e.g. 40.47 at +16.5% → 34.74), so they're flagged `is_derived`. Replace them with the original baseline figures if you have them.

## Workflow 2 (monthly run) — what each step does

| Diagram step | Where in the app | Human-in-the-loop |
|---|---|---|
| Measurements & processing (validates, checks for alerts) | **Data & Uploads**: validate → mapping review → confirm & save. Auto alerts run straight after every save | Mapping review + explicit confirmation |
| Auto alert (flags sharp score drops) | `app/workflow2.py · detect_alerts`: last 7 days vs the average of the 3 earlier 7-day windows; ≥15% relative and ≥3 points, ≥12 answers each side. Tunable with `GEO_ALERT_*` in `.env` | Approve / reject on **Evidence & Diagnosis** |
| Insights (min evidence rule) | **Evidence & Diagnosis → Generate insights**. Gaps need ≥10 neutral answers (`GEO_MIN_EVIDENCE_ANSWERS`) | Approve / reject / edit each insight |
| Diagnosis (rule-based cause → 3 possible causes) | Rule check runs first on every diagnosis (content gap → Relevance, competitor → Credibility, unclear → Clarity/deep dive). **Rule-based** mode needs no API key; **AI agent** mode adds the LLM | Approve / reject / edit in the answer drawer |
| Recommendation (maps to cause → next action) | **Recommendations**: approve, reject with a reason, or edit; then owner, due date, start, mark done | Every decision is attributed to the reviewer name in the sidebar |
| Reporting & next action (logs before/after outcome) | Marking a recommendation done logs the prompt's Visibility Score in equal windows before/after the go-live date; refreshed after every upload. Shown on Recommendations and in the report | – |
| Learning memory (what changed, at which step and why) | Every edit and rejection is stored in `learning_memory` and the latest ones are passed to the diagnosis agent as `PAST_CORRECTIONS`. **Settings** lists them and lets you stop one feeding the agent | – |
| agent_versions | Each distinct prompt / rule text an agent runs with gets a row; diagnoses record the version they came from | – |
| Output: dashboard + report, export PDF | **Reports** follows the Aug 2026 deck (baseline, current, movement, target and interpretation; prompt-set answers; competitive interpretation; neutral benchmark implications; intent intelligence; alerts; Why AI chooses by lens; actions & outcomes; source-intelligence playbook with live triggers; engagement; method). **Export PDF** prints just the report | Editable "What we'll monitor next" per period |

New endpoints: `POST /api/diagnoses/batch`, `PUT /api/recommendations/{id}`, `GET /api/outcomes/{property_id}`, `GET /api/alerts/{property_id}`, `POST /api/alerts/{property_id}/run`, `GET /api/learning-memory/{property_id}`, `PUT /api/learning-memory/item/{id}`, `GET /api/agent-versions`; `POST /api/feedback` now also takes `target: "intelligence"` and `changes` for edits.

## 3. Weekly routine

1. Download the export from Rankscale.
2. Select the target property in **Data & Uploads**, upload the file and click **Validate & map file**.
3. Review validation errors/warnings and property, exact prompt, engine and competitor mappings. Resolve required prompt/engine mappings; confirm unmatched competitors and any invalid rows that will be skipped.
4. Click **Confirm mappings & save to Supabase**. The save is transactional and re-uploading the same file is idempotent.
5. **Evidence & Diagnosis**: review the auto alerts, generate insights for the month, then diagnose misses (rule-based for free, or the AI agent; CLI: `python -m agents.diagnosis.agent --auto 10 [--rules]`).
6. **Recommendations**: approve, reject with a reason, or edit; assign an owner and mark done when live.
7. **Reports**: pick the month, write "What we'll monitor next", and Export PDF.
5. Prompt generation tab (when you want new prompts): **Run agents** → approve → **Export approved for Rankscale** → import the file in Rankscale → Search Terms.

## API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/import-reviews` | Upload, validate and create a durable pending mapping review (no measurement writes) |
| GET | `/api/import-reviews/{batch_id}` | Resume a pending validated mapping review |
| PUT | `/api/import-reviews/{batch_id}/mapping` | Resolve property, prompt, engine and competitor mappings / acknowledgements |
| POST | `/api/import-reviews/{batch_id}/save` | Save only after explicit confirmation and readiness checks |
| POST | `/api/imports` | Legacy direct dry-run/load endpoint retained for compatibility |
| GET | `/api/imports` | Import history |
| GET | `/api/dashboard/{property_id}/kpis \| intent-engine \| weekly \| competitors \| citations \| prompts` | Dashboard data, filterable by `intent`, `engine`, `date_from`, `date_to` |
| GET | `/api/prompts/{id}/answers`, `/api/measurements/{id}` | Drill-down |
| POST | `/api/diagnoses/run` | Run the diagnosis agent on one answer |
| GET | `/api/recommendations` | Review queue |
| POST | `/api/feedback` | Approve, reject or comment on a recommendation, diagnosis, evidence row or measurement |
| POST | `/api/prompt-generation/run` | Run the three prompt agents |
| GET/POST | `/api/prompt-generation/candidates`, `/status`, `/export.csv` | Approve candidates and export the Rankscale file |

## Tests

```bash
DATABASE_URL=postgresql://…  python -m pytest -q
```

These run against a real database: file validation, a full load, an idempotent reload, and both agent pipelines (with a stub LLM, so no API cost). Point them at a **test** project or a local Postgres, not production.

## Adding another hotel

1. Insert a row into `properties` with its name, website, `aliases` (every name engines use, including outlets), `ignored_names` and `own_domains`.
2. Add a brief in `agents/prompt_generation/briefs/`.
3. Upload that hotel's Rankscale export. Rows are matched to the property through `brand_reference`.

For Coogee, `db/03_load_rankscale.sql` also resets the property's alias list on every load, so edit the list there (not only in the table).

## Docs

- `docs/data_spec.md`: every CSV column, whether it's kept, where it goes, how it's cleaned, and where it appears on the dashboard
- `docs/diagnosis_framework.md`: the diagnosis agent's inputs, prompt and outputs
- `docs/prompt_generation.md`: the three upstream agents and the Rankscale round trip

## Groq free-tier limits

GPT-OSS 20B on Groq's free plan allows 30 requests and 8K tokens per minute, and 200K tokens per day. One diagnosis uses about 4–8K tokens, so plan on **roughly 25 diagnoses a day**; the client waits and retries automatically when it hits the per-minute limit. A prompt-generation run of 30 prompts uses about 8 calls. For more volume, upgrade the Groq plan and raise `GEO_LLM_REASONING` and `GEO_LLM_MAX_OUTPUT` in `.env`.
