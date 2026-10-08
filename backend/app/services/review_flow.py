"""Team review (Workflow 2) as the React app runs it:

  prepare_review()     auto alerts + insights for the latest 30 days of measurements (idempotent)
  diagnose_insights()  for every approved insight, diagnose the latest answers that missed the hotel
                       (AI diagnosis agent when an LLM is configured, rule-based otherwise) and return
                       the diagnoses the reviewer decides on next. Recommendations come with them.
"""
from __future__ import annotations

from typing import Any

from ..db import connect
from ..settings import llm_status
from .insights import evidence_package, generate_insights, list_insights
from .workflow2 import detect_alerts

DIAGNOSIS_LABELS = {"content_gap": "Content gap", "entity_confusion": "Entity confusion", "citation_gap": "Citation gap",
                    "competitor_dominance": "Competitor visibility", "negative_sentiment": "Negative sentiment",
                    "other": "Unclear cause"}


def prepare_review(property_id: str) -> dict[str, Any]:
    alerts = detect_alerts(property_id)
    if not alerts.get("checked") and alerts.get("reason") == "No measurements yet":
        return {"ready": False, "reason": "No measurements are saved for this client yet.", "insights": 0}
    current = list_insights(property_id)
    generated = None
    if not [i for i in current if i.get("insight_type") != "visibility_summary"]:
        generated = generate_insights(property_id)
        current = list_insights(property_id)
    return {"ready": True, "alerts": len(alerts.get("alerts", [])), "insights": len(current),
            "generated": (generated or {}).get("generated")}


def _mode() -> str:
    return "agent" if llm_status()["ready"] else "rules"


def diagnose_insights(property_id: str, insight_ids: list[str], per_insight: int = 2) -> list[dict[str, Any]]:
    from agents.diagnosis.agent import run
    rows: dict[str, dict[str, Any]] = {}
    for insight_id in insight_ids:
        try:
            package = evidence_package(insight_id)
        except ValueError:
            continue
        if str(package["insight"].get("property_id")) != str(property_id):
            continue
        measurements = package["relevant_measurements"]
        with connect() as conn:  # answers that ranked brands can be diagnosed; empty answers cannot
            ranked = {str(r["measurement_id"]) for r in conn.execute(
                "select measurement_id from v_measurements_flat where measurement_id = any(%s) and coalesce(brands_total, 0) > 0",
                ([m["measurement_id"] for m in measurements],)).fetchall()}
        missed = sorted((m for m in measurements if not m["detected"]), key=lambda m: str(m["measurement_id"]) not in ranked)
        targets = missed[: max(1, per_insight)] or measurements[:1]
        for measurement in targets:
            measurement_id = str(measurement["measurement_id"])
            with connect() as conn:
                has = conn.execute("select 1 from diagnoses where measurement_id = %s", (measurement_id,)).fetchone()
            if not has:
                try:
                    run(measurement_id, mode=_mode())
                except Exception:  # noqa: BLE001 — fall back to the rule-based cause
                    run(measurement_id, mode="rules")
            with connect() as conn:
                detail = conn.execute(
                    """select f.measurement_id, f.prompt_id, f.engine, f.measured_at, f.brand_found_any_alias,
                              f.own_brand_rank, i.name as intent, p.prompt_text,
                              (select count(*) from evidence e where e.measurement_id = f.measurement_id) as source_count
                       from v_measurements_flat f join prompts p on p.id = f.prompt_id join intents i on i.id = p.intent_id
                       where f.measurement_id = %s""", (measurement_id,)).fetchone()
                diagnoses = conn.execute(
                    """select id, diagnosis_type, severity, root_cause, confidence_score, status, generated_by, created_at
                       from diagnoses where measurement_id = %s order by created_at desc""", (measurement_id,)).fetchall()
            if not detail:
                continue
            for diagnosis in diagnoses:
                key = str(diagnosis["id"])
                if key in rows:
                    continue
                found = detail["brand_found_any_alias"]
                rank = detail["own_brand_rank"]
                rows[key] = {
                    **{k: (str(v) if k == "id" else v) for k, v in diagnosis.items()},
                    "id": key,
                    "title": f"{detail['intent']}: {DIAGNOSIS_LABELS.get(diagnosis['diagnosis_type'], 'Suggested explanation')}",
                    "summary": f"{detail['engine']} {'mentioned the hotel' + (f' at position {rank}' if rank else '') if found else 'did not mention the hotel'} for this prompt in the sampled answer.",
                    "insight_id": insight_id,
                    "prompt_id": str(detail["prompt_id"]),
                    "prompt_text": detail["prompt_text"],
                    "intent": detail["intent"],
                    "measurement_id": measurement_id,
                    "measured_at": detail["measured_at"],
                    "engine": detail["engine"],
                    "source_count": detail["source_count"],
                }
    return list(rows.values())
