"""Workflow 2 human review: insights, diagnosis agent, recommendations, feedback, outcomes, alerts,
learning memory and agent versions."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..db import connect, fetch_all, fetch_one

router = APIRouter()


@router.get("/api/insights/{property_id}")
def aggregated_insights(property_id: str, date_from: date | None = None, date_to: date | None = None):
    from ..services.insights import list_insights
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


@router.post("/api/insights/generate")
def generate_aggregated_insights(req: InsightGenerateRequest):
    from ..services.insights import generate_insights
    try:
        return generate_insights(req.property_id, req.date_from, req.date_to, req.intent_id, req.engine_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/api/insights/item/{insight_id}/evidence")
def aggregated_insight_evidence(insight_id: str):
    from ..services.insights import evidence_package
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


@router.post("/api/diagnoses/run")
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


@router.post("/api/diagnoses/batch")
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


@router.get("/api/recommendations")
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


@router.post("/api/feedback")
def add_feedback(fb: Feedback):
    """Human review at every Workflow 2 step. Edits and reasoned rejections go to learning memory."""
    from ..services.workflow2 import apply_feedback
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


@router.put("/api/recommendations/{rec_id}")
def update_recommendation(rec_id: str, body: RecommendationUpdate):
    """Move a recommendation through next action; marking it done logs a before/after outcome."""
    from ..services.workflow2 import set_recommendation_status
    try:
        return set_recommendation_status(rec_id, body.status, body.owner, body.due_date, body.done_on,
                                         body.reviewer, body.note, body.window_days)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/api/outcomes/{property_id}")
def outcomes(property_id: str):
    from ..services.workflow2 import list_outcomes
    return list_outcomes(property_id)


@router.get("/api/alerts/{property_id}")
def alerts(property_id: str, include_rejected: bool = False):
    from ..services.workflow2 import list_alerts
    return list_alerts(property_id, only_open=not include_rejected)


@router.post("/api/alerts/{property_id}/run")
def run_alerts(property_id: str, as_of: date | None = None):
    from ..services.workflow2 import detect_alerts
    return detect_alerts(property_id, as_of)


@router.get("/api/learning-memory/{property_id}")
def learning_memory(property_id: str, limit: int = 100):
    from ..services.workflow2 import list_learning_memory
    return list_learning_memory(property_id, limit)


class MemoryToggle(BaseModel):
    feeds_agent: bool


@router.put("/api/learning-memory/item/{memory_id}")
def toggle_memory(memory_id: str, body: MemoryToggle):
    with connect() as conn:
        n = conn.execute("update learning_memory set feeds_agent = %s where id = %s",
                         (body.feeds_agent, memory_id)).rowcount
        conn.commit()
    if not n:
        raise HTTPException(404, "learning memory item not found")
    return {"ok": True}


@router.get("/api/agent-versions")
def agent_versions():
    from ..services.workflow2 import list_agent_versions
    return list_agent_versions()


@router.get("/api/activity")
def activity(limit: int = 50):
    return fetch_all("""select entity_table, entity_id, action, actor, occurred_at
                        from activity_history order by id desc limit %s""", (limit,))



# ---------------------------------------------------------------------------
# Team review as the React app runs it
# ---------------------------------------------------------------------------
class DiagnoseInsights(BaseModel):
    insight_ids: list[str]
    per_insight: int = 2


@router.post("/api/review/{property_id}/prepare")
def prepare_review(property_id: str):
    """Run the auto-alert check and generate insights for the latest period when none exist yet."""
    from ..services.review_flow import prepare_review as prepare
    try:
        return prepare(property_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/api/review/{property_id}/diagnoses")
def diagnose_insights(property_id: str, body: DiagnoseInsights):
    """Diagnose the answers behind the approved insights and return the diagnoses to review."""
    from ..services.review_flow import diagnose_insights as diagnose
    return diagnose(property_id, body.insight_ids, max(1, min(body.per_insight, 5)))
