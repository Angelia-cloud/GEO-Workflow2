# Komosion GEO — Prompt & Rankscale workspace

The human-in-the-loop GEO system for Komosion's hotel clients (pilot: InterContinental Sydney Coogee Beach).

**Stack:** React 19 (Vite) · Python (FastAPI) · Postgres (Supabase) · Groq GPT-OSS 20B for the agents (Anthropic/OpenAI optional). Every agent has a rule-based fallback, so the whole app works without an LLM key.

- **Phase 1 · Prompt** — client brief + kickoff transcript → intents → prompts per AI engine → Google Sheet / CSV for Rankscale.
- **Phase 2 · Rankscale** — upload the Rankscale export → records saved per client and loaded as measurements → auto alerts → client report (with "Ask this report").
- **Workflow 2 · Team review** — from the report, **Team review** opens the monthly review: approve insights & alerts → diagnoses (possible explanations) → recommendations with owner and due date → outcome log.

## Structure

```
GEO-Workflow2/
├── docs/                        data spec, diagnosis framework, prompt generation
├── frontend/                    React app (Vite)
│   ├── index.html
│   ├── vite.config.js           dev proxy: /api → VITE_API_TARGET (default http://127.0.0.1:8000)
│   └── src/
│       ├── main.jsx, App.jsx    app shell: sign-in, client picker, Prompt / Rankscale areas, library, settings
│       ├── api/client.js        fetch wrapper (VITE_API_BASE, ApiError)
│       ├── assets/, styles/     logo, assistant avatar, Poppins, app.css
│       ├── lib/samples.js       downloadable synthetic transcript / Rankscale CSV
│       └── features/
│           ├── auth/            team sign-in (GET /api/team)
│           ├── clients/         client directory (/api/clients) and picker
│           ├── prompt/          Phase 1 wizard (rendered in an isolated iframe) + its API client
│           ├── rankscale/       upload, import history, saved files
│           ├── reports/         client report, live monthly report (`reports/live/`: navigation, header, vital signs, action plan, SVG progress charts, competitor comparison, findings, methodology, appendix; styles in `report.css` scoped under `.rp`), opportunity assessment form (`opportunities/`), report assistant
│           ├── review/          Workflow 2 review: findings, diagnoses, recommendations, evidence, outcomes
│           ├── library/         saved transcripts, prompt sheets, uploads and reports
│           ├── settings/        settings page
│           └── workflow/        Phase 2 step host and navigation
└── backend/
    ├── app/
    │   ├── main.py              FastAPI app: routers + serves frontend/dist (SPA fallback)
    │   ├── settings.py          .env loading, upload limit, LLM status
    │   ├── db.py                Postgres connection
    │   ├── routers/             system, clients, library, rankscale, prompt_setup, assistant,
    │   │                        measurements, dashboard, review, report
    │   └── services/            clients, library, rankscale_history, prompt_setup, google_sheets,
    │                            review_flow, ingest, loader, import_review, insights, workflow2, report
    ├── agents/
    │   ├── llm.py               one interface for Groq / Anthropic / OpenAI (+ stub for tests)
    │   ├── prompt_setup/        Phase 1: intent mapper, prompt writer, single-prompt rewrite (+ rules)
    │   ├── prompt_generation/   Intent Mapper → Prompt Writer → Prompt QA (scores Phase 1 prompts too)
    │   ├── diagnosis/           why the hotel did / didn't appear; drafts recommendations
    │   └── report_assistant/    answers questions using only the report's sections, with citations
    ├── db/                      SQL migrations (run in order, below)
    ├── sample_data/             a one-week slice of the Coogee export
    ├── scripts/                 convert_rankscale.py (stand-alone converter)
    └── tests/                   end-to-end tests against a real Postgres
```

## 1. Database (once)

In the Supabase SQL Editor (or `psql`), run in order:

| File | What it does |
|---|---|
| `db/00_drop_all.sql` | *Only when rebuilding.* Drops the GEO tables (`00_reset.sql` keeps a backup) |
| `db/01_schema.sql` | Tables, keys, triggers, security policies |
| `db/02_staging_table.sql` | Staging table used by the import |
| `db/06_dashboard_views.sql` | Dashboard views |
| `db/07_report.sql` | Report model: neutral prompt set, competitors, benchmarks, source categories |
| `db/08_import_review.sql` | Review rows for mapped imports |
| `db/09_workflow2.sql` | Auto alerts, insight review, learning memory, agent versions, outcomes |
| `db/10_import_performance.sql` | Measurement batch index |
| `db/11_workspace.sql` | **New.** Client fields (client name, team, target audience, goals), team members, library entries/files, Rankscale import history; seeds the four clients and Vy Huynh |
| `db/13_monthly_imports.sql` | Monthly import provenance (source file, upload time, status) |
| `db/14_commercial_validation.sql` | Client-confirmed business priorities per intent and saved opportunity assessments |
| `db/12_data_provenance.sql` | Flags synthetic import batches and excludes them from `v_measurements_flat` (rows are kept). See `docs/data_reconciliation_sept_2026.md` |

`db/03_load_rankscale.sql` is run by the app on every upload. `04_coogee_example.sql` and `05_verify.sql` are optional checks.

## 2. Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                    # fill in DATABASE_URL (+ GROQ_API_KEY for AI mode)

cd ../frontend
npm install
npm run build                                           # → frontend/dist, served by FastAPI

cd ../backend
uvicorn app.main:app --reload                           # http://localhost:8000  (API docs: /docs)
```

Frontend development with hot reload: keep uvicorn on port 8000 and run `npm run dev` in `frontend/` (http://127.0.0.1:5173, `/api` proxied).

### Environment (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase → Connect → Session pooler URI (port 5432) |
| `GEO_LLM_PROVIDER`, `GEO_LLM_MODEL`, `GROQ_API_KEY` (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) | Turns on AI mode for the agents. Without a key every agent runs its rule-based version and the UI says so |
| `GEO_PROMPT_SHEET_URL` | The team's prompt workbook (link shown in Phase 1) |
| `GEO_PROMPT_SHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_FILE` / `_JSON` | Optional: write approved prompts straight into the sheet (needs `google-auth requests`; share the sheet with the service account) |
| `GEO_MAX_UPLOAD_MB` | Upload limit (default 64) |
| `GEO_ALERT_*`, `GEO_MIN_EVIDENCE_ANSWERS`, `GEO_OUTCOME_WINDOW_DAYS` | Workflow 2 thresholds |

## How the app works

| Step | In the app | Backend |
|---|---|---|
| Sign in | Team account card | `GET /api/team` |
| Pick / create a client | Top-bar client picker, **Create new client** | `GET/POST/PATCH /api/clients` |
| Phase 1 · brief | Client & goals; edits save to the client | `PATCH /api/clients/{id}` |
| Phase 1 · transcript → intents | Kickoff transcript (upload or paste), **Generate intents** | `POST /api/prompt-setup/runs`, `/runs/{id}/intents` — `agents/prompt_setup` (AI) or rules |
| Phase 1 · prompts | Prompts per engine, regenerate one, QA scores | `/runs/{id}/prompts`, `/prompts/regenerate` — Prompt Writer + Prompt QA |
| Phase 1 · Google Sheets | Save & export, CSV download | `/runs/{id}/sheet`, `/complete`, `/export.csv` — writes approved intents/prompts to the DB |
| Phase 2 · upload | Import Rankscale file (overlapping exports are de-duplicated); measurements and auto alerts continue after the saved-history response | `POST /api/clients/{id}/rankscale/imports` → history + background measurement load + auto alerts |
| Report | Coogee: live report from Supabase measurements, with calendar-month and custom date-range filters, range-aware trend charts and opportunities, chatbot context, and standalone **Export HTML**. Other clients: report built from saved records. | `GET /api/monthly/{id}/months`, `GET /api/monthly/{id}/{YYYY-MM}`, `GET /api/monthly/{id}/range?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`, `GET /api/opportunities/{id}`, `GET /api/clients/{id}/rankscale` |
| Ask this report | Chat panel on every report | `POST /api/report-assistant/ask` (AI); keyword matcher when no LLM |
| Team review → findings | **Team review** button on the report (shown once a client has measurements) | `POST /api/review/{id}/prepare` (alerts + insights), `GET /api/insights/{id}`, `POST /api/feedback` |
| Team review → explanations | Possible explanations for approved findings | `POST /api/review/{id}/diagnoses` — diagnosis agent (AI or rules) |
| Team review → recommendations | Approve with owner + due date, reject with reason, edit | `/api/recommendations`, outcome logging |
| Library | Saved transcripts, prompt sheets, uploads, reports | `/api/library` (entries + original files) |

### Monthly import workflow

Upload each RankScale export (UTF-16 tab-delimited) in the Rankscale step. Months come from each measurement's own timestamp in Australia/Sydney — not from the file name or export date. After an upload the app:

1. validates and stores the rows and an import-history entry (`rankscale_imports`),
2. loads measurements in the background, skipping any observation already stored (key: prompt + engine + timestamp), so re-uploading a file or overlapping exports never duplicates data and earlier months are never deleted,
3. recalculates findings and recommendations for every month in the file and clears the monthly and chatbot caches,
4. makes new months appear in the report's month selector. The custom date-range filter uses the same stored measurements and metric definitions as calendar-month reporting.

A month is labelled *partial* when its data starts or ends more than two days from the month boundary; custom ranges use the same two-day boundary tolerance against the selected dates. The chatbot answers for the selected reporting period from server-built context. Exported HTML embeds the rendered report styles and SVG charts for offline viewing. Commercial priorities stay "Commercial validation required" until the hotel confirms them. Intent and engine name mappings are in `docs/name_mappings.md`.

### Report metrics

| Metric | Definition |
|---|---|
| Visibility Score | Average answer score: 100 ÷ (1 + 0.1 × (rank − 1)) when the hotel is mentioned, 0 when not (matches Rankscale) |
| Detection Rate | % of answers that mention the hotel |
| Average Position | Average rank, only answers that mention the hotel |
| Sentiment Score | Average sentiment × 100, only answers that mention the hotel |

## Tests

```bash
cd backend
DATABASE_URL=postgresql://…  python -m pytest -q
```

They run against a real database (use a test project or local Postgres): file validation, loads and idempotent reloads, workspace endpoints (clients, library, Rankscale history, Phase 1 prompt setup in rule-based and stubbed-AI mode, report assistant), the team-review flow, the report formula and the agent pipelines (stub LLM — no API cost).

## Adding a hotel

Use **Create new client** in the app (or insert into `properties`). Uploads are mapped to the client they are made for, so the export's `brand_reference` doesn't need to match. Add every name AI engines use for the hotel to `properties.aliases` so mentions are recognised.

## Docs

- `docs/name_mappings.md` — intent and engine alias mappings used by monthly comparisons
- `docs/data_spec.md` — every Rankscale column and where it goes
- `docs/diagnosis_framework.md` — diagnosis agent inputs, prompt and outputs
- `docs/prompt_generation.md` — the prompt agents and the Rankscale round trip
- `docs/workflow2_requirements_check.md` — Workflow 2 requirements

## Groq free-tier limits

GPT-OSS 20B on the free plan allows 30 requests / 8K tokens per minute and 200K tokens per day — roughly 25 diagnoses a day. The client waits and retries on per-minute limits. Raise `GEO_LLM_REASONING` / `GEO_LLM_MAX_OUTPUT` on a paid plan.
