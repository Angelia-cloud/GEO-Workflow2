"""Monthly report data (deck sections), notes, benchmarks and report settings."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..db import connect, fetch_all, fetch_one

router = APIRouter()


@router.get("/api/report/{property_id}")
def report(property_id: str, date_from: date | None = None, date_to: date | None = None,
           names: Literal["rankscale", "all"] = "rankscale",
           baseline: str | None = None, benchmark: str | None = None, target: str = "Target"):
    """baseline / benchmark default to the client's latest saved baseline and benchmark."""
    from ..services.report import build_report
    try:
        return build_report(property_id, date_from, date_to, names, baseline, benchmark, target)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class ReportNote(BaseModel):
    period_key: str
    section: str
    body: str
    updated_by: str | None = None


@router.put("/api/report/{property_id}/notes")
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


@router.get("/api/report/{property_id}/benchmarks")
def list_benchmarks(property_id: str):
    return fetch_all("""select label, kind, as_of, prompt_set, dimension, dim_key, metric, value, is_derived, note
                        from benchmarks where property_id = %s
                        order by kind, label, prompt_set, dimension, dim_key, metric""", (property_id,))


@router.put("/api/report/{property_id}/benchmarks")
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


@router.get("/api/report/{property_id}/settings")
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
