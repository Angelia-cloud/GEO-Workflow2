# Workflow 2 — requirements check (30 Sep 2026)

Sources checked: the architecture diagram (Architecture Diagram 11_09_26, Workflow 2 + layers 1–4) and the
InterContinental Coogee GEO Report (Aug 2026, presented Sep 2026). The Google Drive folder could not be opened from
this session, so anything that lives only there isn't covered here.

Legend: ✅ met before · 🔧 was missing or broken, now built · ⚠️ partly met / needs your input

## Architecture diagram — Workflow 2

| Requirement | Before | Now |
|---|---|---|
| Input: Rankscale Excel/CSV export → saved into backend | ⚠️ backend flow existed but its 4 API routes were never registered (404), and the React upload page stopped at "validate" | 🔧 routes wired; full validate → mapping review → confirm → save screen, import history |
| Measurements & processing: validates, checks for alerts | ⚠️ validates only | 🔧 alerts run automatically after every save |
| Auto Alert: flags sharp score drops | ❌ not built | 🔧 whole set, neutral set, per engine, per intent; saved as reviewable insights |
| Insights: agent, min evidence rule; output insight + evidence | ⚠️ insights + evidence package in the API, no evidence rule, list-only UI | 🔧 min-evidence rule (≥10 answers), evidence drawer (engines, competitors, sources, answers) |
| Insights → human review (approve / reject / edit) | ❌ | 🔧 |
| Diagnosis: agent, rule-based cause → 3 possible causes | ⚠️ LLM only | 🔧 rule check first (content gap / competitor / unclear); free rule-only mode; passed to the LLM as RULE_CHECK |
| Diagnosis → human review | ⚠️ API only, no UI in React | 🔧 approve / reject / edit in the answer drawer |
| Recommendation: maps to cause → next action; output recommendation + cause | ⚠️ drafts saved, React page read-only | 🔧 approve / reject / edit, lens + cause shown, owner, due date, start, mark done |
| Reporting & next action: logs before/after outcome; outcome logging saves before/after score | ❌ | 🔧 recommendation_outcomes table, refreshed after each upload, shown in Recommendations + report |
| Learning memory: stores what changed, at which step and why; corrections in / rule updates out | ❌ (only a generic audit log) | 🔧 learning_memory table; latest corrections fed to the diagnosis agent; Settings view with a per-item switch |
| Layer 3: agent_versions (step, prompt/rule text, created_at) | ❌ | 🔧 automatic, diagnoses link to their version |
| Layer 3: feedback (before/after score) | ❌ | 🔧 via recommendation_outcomes |
| Layer 3: events table | ❌ | ⚠️ not built — sits with Workflow 1 (client goals / events) |
| Output: dashboard landing page based on John's slide deck + Angie's version, export PDF | ⚠️ Report tab covered most sections; PDF printed the whole app shell | 🔧 report rebuilt section-by-section against the deck (below); print hides the app shell. "Angie version" not seen — send it and I'll align |
| React UI served by FastAPI | ❌ `/` always served the legacy UI despite the README | 🔧 serves `frontend/dist` when built |

## Aug 2026 report — section by section

| Deck page | Before | Now |
|---|---|---|
| 2 Executive overview: trend vs baseline, good news / qualification / monitor next | ✅ | ✅ monitor-next note also prints |
| 3 Performance overview: Metric · Current · Movement · Interpretation + engine view callout | ⚠️ no interpretation, no callout | 🔧 both, plus baseline column |
| 12 "Show baseline, current, movement and target together wherever possible" | ❌ targets stored but never shown | 🔧 target + vs-target columns appear once a "Target" benchmark exists (Settings) |
| 4 Performance across prompt sets (two questions + current answer) | ⚠️ counts only | 🔧 questions and computed current answers |
| 5 Current competitive position + interpretation box | ⚠️ table only | 🔧 interpretation generated (leader, clearest threat by intent, volatility note) |
| 6 13 Aug benchmark vs current + implication | ⚠️ no implication | 🔧 |
| 7 Intent-level wins / competitors stronger + implication | ✅ | ✅ |
| 8 Why AI chooses: Relevance / Clarity / Credibility | ⚠️ raw diagnosis counts | 🔧 three lens cards with the deck's questions, diagnosis + action counts, example |
| 9 Appendix A measurement method | ❌ | 🔧 |
| 13 KPI cards + visibility by engine and by intent with %Δ | ⚠️ intent table missing on the report | 🔧 |
| 14 Engagement & conversion (pending GTM/GA4) | ✅ | ✅ |
| 15 Source intelligence table + "top 10 cited, top 10 missing, cited pages by cluster, competitor sources" | ⚠️ the four lists existed, the playbook table didn't | 🔧 playbook table with live action triggers (e.g. owned-site share < 15%, editorial sources citing rivals only) |

## Still open

- **Real-data check.** Everything was tested on the one-week sample and a synthetic 4-week copy. Upload your full
  Rankscale export and confirm the Aug numbers match the deck (40.47 / 42.34 / #2.03 / 88.8 full set; 27.93 neutral).
- **Baseline figures** are back-calculated from the deck's % movements (`is_derived`). Replace them with the originals if you have them.
- **Targets**: none set yet — add them in Settings (label "Target").
- **Workflow 1 routes** (`/api/onboarding/*`) are also missing from `app/main.py`; the onboarding tests fail for that reason. Not touched here.
- **Alert thresholds** (15% / 3 points / 7-day window) are a starting point — agree them with Truc.
