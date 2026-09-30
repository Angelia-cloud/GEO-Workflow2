"""GEO Automation Platform — FastAPI backend.

Run:  uvicorn app.main:app --reload        then open http://localhost:8000
Docs: http://localhost:8000/docs           (interactive API explorer)
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

from . import loader  # noqa: E402
from .db import connect, fetch_all, fetch_one  # noqa: E402
from .ingest import parse_rankscale  # noqa: E402

MAX_UPLOAD_MB = int(os.environ.get("GEO_MAX_UPLOAD_MB", "50"))
STATIC = Path(__file__).parent / "static"
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app = FastAPI(title="GEO Automation Platform", version="1.1")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def index():
    """The React build when it exists (npm --prefix frontend run build), otherwise the legacy UI."""
    if (DIST / "index.html").is_file():
        return FileResponse(DIST / "index.html")
    return FileResponse(STATIC / "index.html")


def _after_load(property_id: str | None) -> dict:
    """Workflow 2 follow-ups once new measurements are saved: auto alerts + outcome refresh."""
    if not property_id:
        return {}
    from .workflow2 import detect_alerts, refresh_outcomes
    try:
        alerts = detect_alerts(property_id)
        refresh_outcomes(property_id)
        return {"alerts": len(alerts.get("alerts", [])), "alerts_checked": alerts.get("checked", False),
                "alerts_note": alerts.get("reason")}
    except Exception as e:  # never fail an upload because a follow-up check failed
        return {"alerts_error": str(e)}


@app.get("/api/health")
def health():
    row = fetch_one("select count(*) as properties from properties")
    return {"ok": True, **row}


# ---------------------------------------------------------------------------
# Workflow 1a — file import gateway
# ---------------------------------------------------------------------------
@app.post("/api/imports")
async def import_rankscale(file: UploadFile = File(...),
                           dry_run: bool = Form(False),
                           uploaded_by: str | None = Form(None)):
    """Upload a Rankscale export. dry_run=true validates only (nothing is written)."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
    rows, rep = parse_rankscale(raw, file.filename or "upload.csv")
    if rep.ok and rows:
        with connect() as conn:
            loader.check_brand_references(conn, rows, rep)
    if not rep.ok:
        batch = None if dry_run else loader.record_rejected(rep, uploaded_by)
        raise HTTPException(422, {"message": rep.errors[0]["message"], "batch_id": batch, "report": rep.as_dict()})
    if dry_run:
        return {"status": "validated", "report": rep.as_dict()}
    try:
        result = loader.load_rows(rows, rep, uploaded_by)
    except Exception as e:  # surface DB errors to the UI in plain words
        raise HTTPException(500, {"message": f"Loading failed and nothing was saved: {e}",
                                  "report": rep.as_dict()}) from e
    follow = {}
    for prop in fetch_all("select id from properties"):
        follow = _after_load(str(prop["id"])) or follow
    return {"status": "loaded", **result, "report": rep.as_dict(), "follow_up": follow}


# ---------------------------------------------------------------------------
# Workflow 2 · Measurements — validate → map → human review → save
# ---------------------------------------------------------------------------
@app.post("/api/import-reviews")
async def create_import_review(file: UploadFile = File(...), property_id: str | None = Form(None),
                               uploaded_by: str | None = Form(None)):
    """Validate a Rankscale export and hold it for mapping review. Nothing is written to measurements."""
    from .import_review import create_review
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
    try:
        result = create_review(raw, file.filename or "upload.csv", property_id or None, uploaded_by)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if result.get("status") == "invalid":
        raise HTTPException(422, {"message": (result["validation"].get("errors") or [{"message": "File is not valid"}])[0]["message"],
                                  "report": result["validation"]})
    return result


@app.get("/api/import-reviews/{batch_id}")
def get_import_review(batch_id: str):
    from .import_review import get_review
    try:
        return get_review(batch_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class MappingUpdate(BaseModel):
    property_id: str | None = None
    confirm_property: bool | None = None
    prompt_resolutions: dict[str, str] | None = None
    engine_resolutions: dict[str, str] | None = None
    competitor_resolutions: dict[str, str] | None = None
    confirm_unmatched_competitors: bool | None = None
    accept_invalid_rows: bool | None = None


@app.put("/api/import-reviews/{batch_id}/mapping")
def update_import_mapping(batch_id: str, body: MappingUpdate):
    from .import_review import resolve_review
    try:
        return resolve_review(batch_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class SaveReview(BaseModel):
    confirmed: bool = False
    uploaded_by: str | None = None


@app.post("/api/import-reviews/{batch_id}/save")
def save_import_review(batch_id: str, body: SaveReview):
    from .import_review import save_review
    if not body.confirmed:
        raise HTTPException(400, "Tick the confirmation before saving: the mappings will be written to Supabase.")
    try:
        result = save_review(batch_id, body.uploaded_by)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Saving failed and nothing was written: {e}") from e
    pid = (result.get("report", {}).get("mapping", {}).get("property", {}) or {}).get("selected_id")
    return {**result, "follow_up": _after_load(pid)}


@app.get("/api/imports")
def list_imports(limit: int = 20):
    return fetch_all("""select id, filename, uploaded_by, status, rows_in_file, rows_valid, rows_rejected,
                               measurements_added, mentions_added, evidence_added, created_at
                        from import_batches order by created_at desc limit %s""", (limit,))


@app.get("/api/imports/{batch_id}")
def get_import(batch_id: str):
    row = fetch_one("select * from import_batches where id = %s", (batch_id,))
    if not row:
        raise HTTPException(404, "batch not found")
    return row


# ---------------------------------------------------------------------------
# Workflow 1b — dashboard
# ---------------------------------------------------------------------------
@app.get("/api/properties")
def properties():
    return fetch_all("select id, name, location, website_url, aliases from properties order by name")


def _filters(property_id: str, intent: str | None = None, engine: str | None = None,
             date_from: date | None = None, date_to: date | None = None) -> tuple[str, dict]:
    where = ["property_id = %(pid)s"]
    p: dict = {"pid": property_id}
    if intent:
        where.append("intent = %(intent)s"); p["intent"] = intent
    if engine:
        where.append("engine = %(engine)s"); p["engine"] = engine
    if date_from:
        where.append("measured_at >= %(df)s"); p["df"] = date_from
    if date_to:
        where.append("measured_at < %(dt)s::date + 1"); p["dt"] = date_to
    return " and ".join(where), p


@app.get("/api/dashboard/{property_id}/kpis")
def kpis(property_id: str, intent: str | None = None, engine: str | None = None,
         date_from: date | None = None, date_to: date | None = None):
    w, p = _filters(property_id, intent, engine, date_from, date_to)
    return fetch_one(f"""
        select count(*) as answers, count(distinct prompt_id) as prompts, count(distinct engine) as engines,
               min(measured_at)::date as first_measured, max(measured_at)::date as last_measured,
               round(avg(brand_found::int), 3) as found_rate_rankscale,
               round(avg(brand_found_any_alias::int), 3) as found_rate_any_alias,
               round(avg(own_brand_rank) filter (where brand_found_any_alias), 2) as avg_rank_when_found,
               round(avg(own_brand_sentiment) filter (where brand_found_any_alias), 3) as avg_sentiment_when_found,
               count(*) filter (where brand_found_any_alias and not brand_found) as missed_by_rankscale
        from v_measurements_flat where {w}""", p)


@app.get("/api/dashboard/{property_id}/intent-engine")
def intent_engine(property_id: str, date_from: date | None = None, date_to: date | None = None):
    w, p = _filters(property_id, date_from=date_from, date_to=date_to)
    return fetch_all(f"""
        select intent, engine, count(*) as answers,
               round(avg(brand_found_any_alias::int), 3) as found_rate,
               round(avg(brand_found::int), 3) as found_rate_rankscale,
               round(avg(own_brand_rank) filter (where brand_found_any_alias), 2) as avg_rank_when_found
        from v_measurements_flat where {w} group by intent, engine order by intent, engine""", p)


@app.get("/api/dashboard/{property_id}/weekly")
def weekly(property_id: str, intent: str | None = None, engine: str | None = None):
    w, p = _filters(property_id, intent, engine)
    return fetch_all(f"""
        select week_start, count(*) as answers,
               round(avg(brand_found_any_alias::int), 3) as found_rate,
               round(avg(brand_found::int), 3) as found_rate_rankscale
        from v_measurements_flat where {w} group by week_start order by week_start""", p)


@app.get("/api/dashboard/{property_id}/competitors")
def competitors(property_id: str, intent: str | None = None, engine: str | None = None,
                date_from: date | None = None, date_to: date | None = None, limit: int = 10):
    w, p = _filters(property_id, intent, engine, date_from, date_to)
    p["limit"] = limit
    return fetch_all(f"""
        with f as (select * from v_measurements_flat where {w}),
        total as (select count(*) n from f)
        select c.name as competitor, count(distinct f.measurement_id) as answers,
               round(count(distinct f.measurement_id)::numeric / nullif((select n from total), 0), 3) as share,
               round(avg(mm.rank), 2) as avg_rank,
               count(distinct f.measurement_id) filter (where mm.rank = 1) as ranked_first
        from f join measurement_mentions mm on mm.measurement_id = f.measurement_id and not mm.is_own_brand
        join competitors c on c.id = mm.competitor_id
        group by c.name order by answers desc limit %(limit)s""", p)


@app.get("/api/dashboard/{property_id}/citations")
def citations(property_id: str, intent: str | None = None, engine: str | None = None,
              attributed_to: Literal["own_brand", "competitor", "unattributed"] | None = None, limit: int = 15):
    w, p = _filters(property_id, intent, engine)
    p["limit"] = limit
    extra = ""
    if attributed_to:
        extra = "and e.attributed_to = %(att)s"; p["att"] = attributed_to
    return fetch_all(f"""
        select e.domain, count(*) as citations, count(distinct e.measurement_id) as answers,
               count(*) filter (where e.attributed_to = 'own_brand') as for_hotel,
               count(*) filter (where e.attributed_to = 'competitor') as for_competitors,
               count(*) filter (where e.attributed_to = 'unattributed') as unattributed,
               bool_or(e.domain = any(pr.own_domains)) as is_own_domain
        from evidence e
        join (select measurement_id from v_measurements_flat where {w}) f on f.measurement_id = e.measurement_id
        join properties pr on pr.id = e.property_id
        where e.domain is not null {extra}
        group by e.domain order by citations desc limit %(limit)s""", p)


@app.get("/api/dashboard/{property_id}/prompts")
def prompt_scorecard(property_id: str, intent: str | None = None):
    p: dict = {"pid": property_id}
    extra = ""
    if intent:
        extra = "and intent = %(intent)s"; p["intent"] = intent
    return fetch_all(f"""select * from v_prompt_scorecard where property_id = %(pid)s {extra}
                         order by found_rate, answers desc""", p)


@app.get("/api/prompts/{prompt_id}/answers")
def prompt_answers(prompt_id: str, limit: int = 60):
    return fetch_all("""select measurement_id, engine, measured_at, brand_found, brand_found_any_alias,
                               own_brand_rank, own_brand_sentiment, brands_total
                        from v_measurements_flat where prompt_id = %s
                        order by measured_at desc, engine limit %s""", (prompt_id, limit))


@app.get("/api/measurements/{measurement_id}")
def measurement_detail(measurement_id: str):
    m = fetch_one("""select f.*, m.response_text, m.own_brand_name_mentioned, m.own_brand_sentiment_reason,
                            m.web_search_queries
                     from v_measurements_flat f join measurements m on m.id = f.measurement_id
                     where f.measurement_id = %s""", (measurement_id,))
    if not m:
        raise HTTPException(404, "measurement not found")
    m["mentions"] = fetch_all("""select rank, brand_name_raw, is_own_brand, sentiment, sentiment_reason,
                                        positive_keywords, negative_keywords
                                 from measurement_mentions where measurement_id = %s order by rank""",
                              (measurement_id,))
    m["evidence"] = fetch_all("""select e.id, e.evidence_type, e.attributed_to, c.name as competitor, e.domain,
                                        e.url, e.confidence_score, e.confidence_level, e.verification_status
                                 from evidence e left join competitors c on c.id = e.competitor_id
                                 where e.measurement_id = %s
                                 order by e.attributed_to, e.domain""", (measurement_id,))
    m["diagnoses"] = fetch_all("""select id, diagnosis_type, severity, root_cause, confidence_score, status,
                                         generated_by, created_at
                                  from diagnoses where measurement_id = %s order by created_at desc""",
                               (measurement_id,))
    m["recommendations"] = fetch_all("""select id, title, detail, action_type, priority, status
                                        from recommendations where measurement_id = %s
                                        order by created_at""", (measurement_id,))
    return m


@app.get("/api/insights/{property_id}")
def aggregated_insights(property_id: str, date_from: date | None = None, date_to: date | None = None):
    from .insights import list_insights
    try:
        return list_insights(property_id, date_from, date_to)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class InsightGenerateRequest(BaseModel):
    property_id: str
    date_from: date | None = None
    date_to: date | None = None
    intent_id: str | None = None
    engine_id: str | None = None


@app.post("/api/insights/generate")
def generate_aggregated_insights(req: InsightGenerateRequest):
    from .insights import generate_insights
    try:
        return generate_insights(req.property_id, req.date_from, req.date_to, req.intent_id, req.engine_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/insights/item/{insight_id}/evidence")
def aggregated_insight_evidence(insight_id: str):
    from .insights import evidence_package
    try:
        return evidence_package(insight_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


# ---------------------------------------------------------------------------
# Diagnosis agent + human review
# ---------------------------------------------------------------------------
class DiagnoseRequest(BaseModel):
    measurement_id: str
    dry_run: bool = False
    mode: Literal["agent", "rules"] = "agent"   # rules = rule-based cause only, no LLM call


@app.post("/api/diagnoses/run")
def run_diagnosis(req: DiagnoseRequest):
    from agents.diagnosis.agent import run
    from agents.llm import LLMError
    try:
        return run(req.measurement_id, dry_run=req.dry_run, mode=req.mode)
    except (LLMError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # provider errors: missing/invalid API key, rate limits, network
        raise HTTPException(502, f"The LLM call failed: {e}. Check GEO_LLM_PROVIDER, GEO_LLM_MODEL and the API key in .env, or use the rule-based diagnosis.") from e


class BatchDiagnose(BaseModel):
    property_id: str
    limit: int = 10
    mode: Literal["agent", "rules"] = "rules"


@app.post("/api/diagnoses/batch")
def run_diagnosis_batch(req: BatchDiagnose):
    """Diagnose the latest undiagnosed misses (one per prompt × engine). Rules mode needs no API key."""
    from agents.diagnosis.agent import run
    rows = fetch_all("""
        with latest as (
          select distinct on (prompt_id, engine) measurement_id, brand_found_any_alias
          from v_measurements_flat where property_id = %s and coalesce(brands_total, 0) > 0
          order by prompt_id, engine, measured_at desc)
        select l.measurement_id from latest l
        where not l.brand_found_any_alias
          and not exists (select 1 from diagnoses d where d.measurement_id = l.measurement_id)
        limit %s""", (req.property_id, max(1, min(req.limit, 50))))
    done, errors = [], []
    for r in rows:
        try:
            out = run(str(r["measurement_id"]), mode=req.mode)
            done.append({"measurement_id": str(r["measurement_id"]), "diagnosis_id": out.get("diagnosis_id"),
                         "cause": out["rule_check"]["cause"]})
        except Exception as e:  # keep going; report what failed
            errors.append({"measurement_id": str(r["measurement_id"]), "error": str(e)})
            if req.mode == "agent":
                break
    return {"diagnosed": len([d for d in done if d["diagnosis_id"]]), "results": done, "errors": errors}


@app.get("/api/recommendations")
def recommendation_queue(property_id: str, status: str | None = None, limit: int = 100):
    p: dict = {"pid": property_id, "limit": limit}
    extra = ""
    if status:
        extra = "and status = %(status)s"; p["status"] = status
    return fetch_all(f"""select * from v_recommendation_queue where property_id = %(pid)s {extra}
                         order by created_at desc limit %(limit)s""", p)


class Feedback(BaseModel):
    target: Literal["recommendation", "diagnosis", "evidence", "measurement", "intelligence"]
    target_id: str
    reviewer: str
    decision: Literal["approve", "reject", "edit", "comment"]
    rating: int | None = None
    comment: str | None = None
    changes: dict | None = None   # for decision='edit': the fields the reviewer changed


@app.post("/api/feedback")
def add_feedback(fb: Feedback):
    """Human review at every Workflow 2 step. Edits and reasoned rejections go to learning memory."""
    from .workflow2 import apply_feedback
    if not fb.reviewer.strip():
        raise HTTPException(400, "Add your name as reviewer first.")
    try:
        return apply_feedback(fb.target, fb.target_id, fb.reviewer.strip(), fb.decision, fb.rating, fb.comment, fb.changes)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class RecommendationUpdate(BaseModel):
    status: Literal["proposed", "approved", "rejected", "in_progress", "done"] | None = None
    owner: str | None = None
    due_date: date | None = None
    done_on: date | None = None       # when the action went live; outcome windows start here
    window_days: int | None = None
    reviewer: str | None = None
    note: str | None = None


@app.put("/api/recommendations/{rec_id}")
def update_recommendation(rec_id: str, body: RecommendationUpdate):
    """Move a recommendation through next action; marking it done logs a before/after outcome."""
    from .workflow2 import set_recommendation_status
    try:
        return set_recommendation_status(rec_id, body.status, body.owner, body.due_date, body.done_on,
                                         body.reviewer, body.note, body.window_days)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e


@app.get("/api/outcomes/{property_id}")
def outcomes(property_id: str):
    from .workflow2 import list_outcomes
    return list_outcomes(property_id)


@app.get("/api/alerts/{property_id}")
def alerts(property_id: str, include_rejected: bool = False):
    from .workflow2 import list_alerts
    return list_alerts(property_id, only_open=not include_rejected)


@app.post("/api/alerts/{property_id}/run")
def run_alerts(property_id: str, as_of: date | None = None):
    from .workflow2 import detect_alerts
    return detect_alerts(property_id, as_of)


@app.get("/api/learning-memory/{property_id}")
def learning_memory(property_id: str, limit: int = 100):
    from .workflow2 import list_learning_memory
    return list_learning_memory(property_id, limit)


class MemoryToggle(BaseModel):
    feeds_agent: bool


@app.put("/api/learning-memory/item/{memory_id}")
def toggle_memory(memory_id: str, body: MemoryToggle):
    with connect() as conn:
        n = conn.execute("update learning_memory set feeds_agent = %s where id = %s",
                         (body.feeds_agent, memory_id)).rowcount
        conn.commit()
    if not n:
        raise HTTPException(404, "learning memory item not found")
    return {"ok": True}


@app.get("/api/agent-versions")
def agent_versions():
    from .workflow2 import list_agent_versions
    return list_agent_versions()


@app.get("/api/activity")
def activity(limit: int = 50):
    return fetch_all("""select entity_table, entity_id, action, actor, occurred_at
                        from activity_history order by id desc limit %s""", (limit,))


# ---------------------------------------------------------------------------
# Upstream: prompt-generation agents
# ---------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    property_id: str
    total: int = 30
    focus: str | None = None
    dry_run: bool = False
    created_by: str | None = None


@app.post("/api/prompt-generation/run")
def run_prompt_generation(req: GenerateRequest):
    from agents.llm import LLMError
    from agents.prompt_generation.pipeline import generate
    try:
        return generate(req.property_id, req.total, req.focus, dry_run=req.dry_run, created_by=req.created_by)
    except (LLMError, RuntimeError, FileNotFoundError) as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"The LLM call failed: {e}. Check GEO_LLM_PROVIDER, GEO_LLM_MODEL and the API key in .env.") from e


@app.get("/api/prompt-generation/candidates")
def prompt_candidates(property_id: str, status: str = "candidate"):
    return fetch_all("""select p.id, p.prompt_text, i.name as intent, p.prompt_type, p.persona, p.rationale,
                               p.quality_score, p.status, p.created_at
                        from prompts p join intents i on i.id = p.intent_id
                        where i.property_id = %s and p.status = %s
                        order by i.name, p.quality_score desc nulls last""", (property_id, status))


class PromptStatus(BaseModel):
    prompt_ids: list[str]
    status: Literal["approved", "rejected", "candidate"]


@app.post("/api/prompt-generation/status")
def set_prompt_status(req: PromptStatus):
    with connect() as conn:
        n = conn.execute("update prompts set status = %s where id = any(%s::uuid[]) and source = 'prompt_agent'",
                         (req.status, req.prompt_ids)).rowcount
        conn.commit()
    return {"updated": n}


@app.get("/api/prompt-generation/export.csv", response_class=PlainTextResponse)
def export_prompts(property_id: str, mark_exported: bool = True):
    from agents.prompt_generation.pipeline import export_rankscale_csv
    csv_text = export_rankscale_csv(property_id, ("approved",), mark_exported=mark_exported)
    return PlainTextResponse(csv_text, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=rankscale_import.csv"})


# ---------------------------------------------------------------------------
# Monthly report (Report tab) — mirrors the Komosion GEO report
# ---------------------------------------------------------------------------
@app.get("/api/report/{property_id}")
def report(property_id: str, date_from: date | None = None, date_to: date | None = None,
           names: Literal["rankscale", "all"] = "rankscale",
           baseline: str = "Pre-schema baseline", benchmark: str = "13 Aug benchmark", target: str = "Target"):
    from .report import build_report
    try:
        return build_report(property_id, date_from, date_to, names, baseline, benchmark, target)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class ReportNote(BaseModel):
    period_key: str
    section: str
    body: str
    updated_by: str | None = None


@app.put("/api/report/{property_id}/notes")
def save_note(property_id: str, note: ReportNote):
    with connect() as conn:
        conn.execute("""insert into report_notes (property_id, period_key, section, body, updated_by)
                        values (%s, %s, %s, %s, %s)
                        on conflict (property_id, period_key, section)
                        do update set body = excluded.body, updated_by = excluded.updated_by, updated_at = now()""",
                     (property_id, note.period_key, note.section, note.body, note.updated_by))
        conn.commit()
    return {"ok": True}


class Benchmark(BaseModel):
    label: str
    kind: Literal["baseline", "benchmark", "report", "target"] = "target"
    as_of: date | None = None
    prompt_set: Literal["full", "neutral"] = "full"
    dimension: Literal["overall", "engine", "intent", "competitor"] = "overall"
    dim_key: str = ""
    metric: Literal["visibility", "detection", "position", "top3", "sentiment"]
    value: float
    note: str | None = None


@app.get("/api/report/{property_id}/benchmarks")
def list_benchmarks(property_id: str):
    return fetch_all("""select label, kind, as_of, prompt_set, dimension, dim_key, metric, value, is_derived, note
                        from benchmarks where property_id = %s
                        order by kind, label, prompt_set, dimension, dim_key, metric""", (property_id,))


@app.put("/api/report/{property_id}/benchmarks")
def upsert_benchmark(property_id: str, b: Benchmark):
    with connect() as conn:
        conn.execute("""insert into benchmarks (property_id, label, kind, as_of, prompt_set, dimension, dim_key,
                                                metric, value, note)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (property_id, label, prompt_set, dimension, dim_key, metric)
                        do update set value = excluded.value, kind = excluded.kind, as_of = excluded.as_of,
                                      note = excluded.note, is_derived = false""",
                     (property_id, b.label, b.kind, b.as_of, b.prompt_set, b.dimension, b.dim_key,
                      b.metric, b.value, b.note))
        conn.commit()
    return {"ok": True}


@app.get("/api/report/{property_id}/settings")
def report_settings(property_id: str):
    import os
    prop = fetch_one("select name, website_url, aliases, ignored_names, own_domains from properties where id = %s",
                     (property_id,))
    return {
        "property": prop,
        "competitor_groups": fetch_all("""select name, display_name, aliases, is_tracked, sort_order
                                          from competitor_groups where property_id = %s order by sort_order""",
                                       (property_id,)),
        "neutral_exclusion_terms": [r["term"] for r in fetch_all(
            "select term from neutral_exclusion_terms where property_id = %s order by term", (property_id,))],
        "prompts": fetch_all("""select p.prompt_text, i.name as intent, p.is_neutral, p.status
                                from prompts p join intents i on i.id = p.intent_id
                                where i.property_id = %s and p.status = 'tracked' order by i.name, p.prompt_text""",
                             (property_id,)),
        "llm": {"provider": os.environ.get("GEO_LLM_PROVIDER", "groq"),
                "model": os.environ.get("GEO_LLM_MODEL", "openai/gpt-oss-20b"),
                "key_set": bool(os.environ.get("GROQ_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
                                or os.environ.get("OPENAI_API_KEY"))},
    }
