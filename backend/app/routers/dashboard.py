"""Dashboard reads over saved measurements (KPIs, intent × engine, competitors, citations, prompts)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..db import connect, fetch_all, fetch_one

router = APIRouter()


@router.get("/api/properties")
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


@router.get("/api/dashboard/{property_id}/kpis")
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


@router.get("/api/dashboard/{property_id}/intent-engine")
def intent_engine(property_id: str, date_from: date | None = None, date_to: date | None = None):
    w, p = _filters(property_id, date_from=date_from, date_to=date_to)
    return fetch_all(f"""
        select intent, engine, count(*) as answers,
               round(avg(brand_found_any_alias::int), 3) as found_rate,
               round(avg(brand_found::int), 3) as found_rate_rankscale,
               round(avg(own_brand_rank) filter (where brand_found_any_alias), 2) as avg_rank_when_found
        from v_measurements_flat where {w} group by intent, engine order by intent, engine""", p)


@router.get("/api/dashboard/{property_id}/weekly")
def weekly(property_id: str, intent: str | None = None, engine: str | None = None):
    w, p = _filters(property_id, intent, engine)
    return fetch_all(f"""
        select week_start, count(*) as answers,
               round(avg(brand_found_any_alias::int), 3) as found_rate,
               round(avg(brand_found::int), 3) as found_rate_rankscale
        from v_measurements_flat where {w} group by week_start order by week_start""", p)


@router.get("/api/dashboard/{property_id}/competitors")
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


@router.get("/api/dashboard/{property_id}/citations")
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


@router.get("/api/dashboard/{property_id}/prompts")
def prompt_scorecard(property_id: str, intent: str | None = None):
    p: dict = {"pid": property_id}
    extra = ""
    if intent:
        extra = "and intent = %(intent)s"; p["intent"] = intent
    return fetch_all(f"""select * from v_prompt_scorecard where property_id = %(pid)s {extra}
                         order by found_rate, answers desc""", p)


@router.get("/api/prompts/{prompt_id}/answers")
def prompt_answers(prompt_id: str, limit: int = 60):
    return fetch_all("""select measurement_id, engine, measured_at, brand_found, brand_found_any_alias,
                               own_brand_rank, own_brand_sentiment, brands_total
                        from v_measurements_flat where prompt_id = %s
                        order by measured_at desc, engine limit %s""", (prompt_id, limit))


@router.get("/api/measurements/{measurement_id}")
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
