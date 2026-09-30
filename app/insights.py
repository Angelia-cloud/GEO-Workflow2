"""Deterministic aggregated insights backed by the existing intelligence model."""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from psycopg import Connection

from .db import connect

# min-evidence rule (diagram: Insights "agent, min evidence rule"): an intent × engine gap only becomes
# an insight when both sides rest on at least this many answers in the period
MIN_EVIDENCE_ANSWERS = int(os.environ.get("GEO_MIN_EVIDENCE_ANSWERS", "10"))
MIN_EVIDENCE_RULE = (f"Insight rule: a visibility gap is raised for an intent x engine only when the leading tracked "
                     f"competitor's neutral-set detection is >= 10 points above the property's and the property has "
                     f">= {MIN_EVIDENCE_ANSWERS} neutral answers for that intent x engine in the period.")

_SCORE = "case when a.found_any and a.rank_any is not null then 100.0 / (1 + 0.1 * (a.rank_any - 1)) else 0 end"


def _uuid_text(value: str, label: str) -> str:
    try:
        return str(UUID(value))
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a UUID") from error


def _numeric_values(row: dict[str, Any]) -> dict[str, Any]:
    return {key: float(value) if isinstance(value, Decimal) else value for key, value in row.items()}


def _period_for_generation(
    conn: Connection,
    property_id: str,
    date_from: date | None,
    date_to: date | None,
) -> tuple[date, date]:
    property_id = _uuid_text(property_id, "property_id")
    if not conn.execute("select 1 from properties where id = %s", (property_id,)).fetchone():
        raise ValueError("property not found")
    span = conn.execute(
        "select min(day) as first_day, max(day) as last_day from v_answer_scores where property_id = %s",
        (property_id,),
    ).fetchone()
    if not span["last_day"]:
        raise ValueError("No measurements are available for this property")
    end = date_to or span["last_day"]
    start = date_from or max(span["first_day"], end - timedelta(days=29))
    if start > end:
        raise ValueError("date_from must be on or before date_to")
    return start, end


def _scope(
    property_id: str,
    date_from: date,
    date_to: date,
    intent_id: str | None = None,
    engine_name: str | None = None,
    neutral_only: bool = False,
    alias: str = "a",
) -> tuple[str, dict[str, Any]]:
    clauses = [
        f"{alias}.property_id = %(property_id)s",
        f"{alias}.day between %(date_from)s and %(date_to)s",
    ]
    params: dict[str, Any] = {"property_id": property_id, "date_from": date_from, "date_to": date_to}
    if intent_id:
        clauses.append(f"{alias}.intent_id = %(intent_id)s")
        params["intent_id"] = intent_id
    if engine_name:
        clauses.append(f"{alias}.engine = %(engine)s")
        params["engine"] = engine_name
    if neutral_only:
        clauses.append(f"{alias}.is_neutral")
    return " and ".join(clauses), params


def _resolve_filters(
    conn: Connection,
    property_id: str,
    intent_id: str | None,
    engine_id: str | None,
) -> tuple[str | None, str | None]:
    if intent_id:
        intent_id = _uuid_text(intent_id, "intent_id")
        intent = conn.execute(
            "select id from intents where id = %s and property_id = %s", (intent_id, property_id)
        ).fetchone()
        if not intent:
            raise ValueError("intent not found for property")
    engine_name = None
    if engine_id:
        engine_id = _uuid_text(engine_id, "engine_id")
        engine = conn.execute("select name from engines where id = %s", (engine_id,)).fetchone()
        if not engine:
            raise ValueError("engine not found")
        engine_name = engine["name"]
    return intent_id, engine_name


def _aggregate_metrics(
    conn: Connection,
    property_id: str,
    date_from: date,
    date_to: date,
    intent_id: str | None = None,
    engine_name: str | None = None,
    neutral_only: bool = False,
) -> dict[str, Any]:
    where, params = _scope(property_id, date_from, date_to, intent_id, engine_name, neutral_only)
    row = conn.execute(
        f"""select count(*) as answers,
                   round(100.0 * avg(a.found_any::int), 2) as detection,
                   round(avg({_SCORE}), 2) as visibility_score,
                   round(avg(a.rank_any) filter (where a.found_any), 2) as position,
                   round(100.0 * avg((a.found_any and a.rank_any <= 3)::int), 2) as top3,
                   round(100.0 * avg(a.sentiment_any) filter (where a.found_any), 1) as sentiment
            from v_answer_scores a where {where}""",
        params,
    ).fetchone()
    return _numeric_values(dict(row))


def _intent_gaps(
    conn: Connection,
    property_id: str,
    date_from: date,
    date_to: date,
    intent_id: str | None,
    engine_name: str | None,
) -> list[dict[str, Any]]:
    own_where, params = _scope(property_id, date_from, date_to, intent_id, engine_name, neutral_only=True)
    competitor_where, competitor_params = _scope(
        property_id, date_from, date_to, intent_id, engine_name, neutral_only=True, alias="c"
    )
    params.update(competitor_params)
    params["min_answers"] = MIN_EVIDENCE_ANSWERS
    rows = conn.execute(
        f"""with own as (
              select a.intent_id, a.intent, a.engine, count(*) as answers,
                     round(100.0 * avg(a.found_any::int), 2) as detection,
                     round(avg({_SCORE}), 2) as visibility_score
              from v_answer_scores a
              where {own_where}
              group by a.intent_id, a.intent, a.engine
            ), competitors as (
              select i.id as intent_id, c.engine, g.id as group_id,
                     coalesce(g.display_name, g.name) as competitor,
                     count(distinct c.measurement_id) as appearances,
                     sum(100.0 / (1 + 0.1 * (c.rank - 1))) as visibility_total
              from v_competitor_answer_scores c
              join intents i on i.property_id = c.property_id and i.name = c.intent
              join competitor_groups g on g.id = c.group_id and g.is_tracked
              where {competitor_where}
              group by i.id, c.engine, g.id, g.display_name, g.name
            ), ranked as (
              select own.*, competitors.competitor, competitors.appearances,
                     round(100.0 * competitors.appearances / nullif(own.answers, 0), 2) as competitor_detection,
                     round(competitors.visibility_total / nullif(own.answers, 0), 2) as competitor_visibility,
                     row_number() over (partition by own.intent_id, own.engine
                       order by competitors.appearances::numeric / nullif(own.answers, 0) desc,
                                competitors.visibility_total / nullif(own.answers, 0) desc,
                                competitors.competitor) as competitor_rank
              from own
              join competitors on competitors.intent_id = own.intent_id and competitors.engine = own.engine
            )
            select intent_id, intent, engine, answers, detection, visibility_score,
                   competitor, competitor_detection, competitor_visibility
            from ranked
            where competitor_rank = 1 and competitor_detection - detection >= 10
              and answers >= %(min_answers)s
            order by competitor_detection - detection desc, intent, engine""",
        params,
    ).fetchall()
    return [_numeric_values(dict(row)) for row in rows]


def _upsert_insight(
    conn: Connection,
    property_id: str,
    intent_id: str | None,
    engine_id: str | None,
    date_from: date,
    date_to: date,
    insight_type: str,
    title: str,
    summary: str,
    metrics: dict[str, Any],
) -> str:
    row = conn.execute(
        """insert into intelligence
             (property_id, intent_id, engine_id, period_start, period_end, insight_type,
              title, summary, metrics, generated_by)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, 'sql_rollup')
           on conflict (property_id, intent_id, engine_id, insight_type, period_start, period_end)
           do update set title = excluded.title, summary = excluded.summary,
                         metrics = excluded.metrics, generated_by = 'sql_rollup'
           returning id""",
        (property_id, intent_id, engine_id, date_from, date_to, insight_type,
         title, summary, json.dumps(metrics)),
    ).fetchone()
    return str(row["id"])


def _generate_insights(
    conn: Connection,
    property_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
    intent_id: str | None = None,
    engine_id: str | None = None,
) -> dict[str, Any]:
    start, end = _period_for_generation(conn, property_id, date_from, date_to)
    intent_id, engine_name = _resolve_filters(conn, property_id, intent_id, engine_id)
    engine_row = conn.execute("select id from engines where name = %s", (engine_name,)).fetchone() if engine_name else None
    scoped_engine_id = str(engine_row["id"]) if engine_row else None
    _, params = _scope(property_id, start, end, intent_id, engine_name)
    params.update({"start": start, "end": end, "intent_id": intent_id, "engine_id": scoped_engine_id})

    current = _aggregate_metrics(conn, property_id, start, end, intent_id, engine_name)
    if not current["answers"]:
        raise ValueError("No measurements were found for the selected period and filters")

    summary = (
        f"The property was detected in {current['detection']:.1f}% of {current['answers']} answers "
        f"with a Visibility Score of {current['visibility_score']:.2f}."
    )
    ids = [_upsert_insight(
        conn, property_id, intent_id, scoped_engine_id, start, end, "visibility_summary",
        "Visibility summary", summary, current,
    )]

    duration = (end - start).days + 1
    previous_start = start - timedelta(days=duration)
    previous_end = start - timedelta(days=1)
    previous = _aggregate_metrics(conn, property_id, previous_start, previous_end, intent_id, engine_name)
    if previous["answers"]:
        relative_change = round(
            (current["visibility_score"] - previous["visibility_score"])
            / previous["visibility_score"] * 100, 1
        ) if previous["visibility_score"] else None
        direction = "improved" if relative_change is not None and relative_change >= 0 else "declined"
        trend_metrics = {
            **current,
            "previous_visibility_score": previous["visibility_score"],
            "previous_answers": previous["answers"],
            "relative_change_pct": relative_change,
        }
        ids.append(_upsert_insight(
            conn, property_id, intent_id, scoped_engine_id, start, end, "trend",
            f"Visibility {direction}",
            f"Visibility Score moved from {previous['visibility_score']:.2f} to "
            f"{current['visibility_score']:.2f} ({relative_change:+.1f}%) over "
            f"{current['answers']} answers vs {previous['answers']} in the prior period.",
            trend_metrics,
        ))
    else:
        conn.execute(
            """delete from intelligence where property_id = %s and intent_id is not distinct from %s
               and engine_id is not distinct from %s and period_start = %s and period_end = %s
               and insight_type = 'trend' and generated_by = 'sql_rollup'""",
            (property_id, intent_id, scoped_engine_id, start, end),
        )

    gap_rows = _intent_gaps(conn, property_id, start, end, intent_id, engine_name)
    active_gap_keys: set[tuple[str, str]] = set()
    for gap in gap_rows:
        gap_ratio = round((gap["detection"] - gap["competitor_detection"]) / 100, 4)
        gap_engine_id = str(conn.execute("select id from engines where name = %s", (gap["engine"],)).fetchone()["id"])
        active_gap_keys.add((str(gap["intent_id"]), gap_engine_id))
        metrics = {
            "answers": gap["answers"],
            "detection": gap["detection"],
            "visibility_score": gap["visibility_score"],
            "competitor": gap["competitor"],
            "competitor_detection": gap["competitor_detection"],
            "competitor_visibility_score": gap["competitor_visibility"],
            "visibility_gap": gap_ratio,
        }
        ids.append(_upsert_insight(
            conn, property_id, str(gap["intent_id"]), gap_engine_id,
            start, end, "visibility_gap",
            f"{gap['intent']} · {gap['engine']}: {gap['competitor']} leads detection by "
            f"{gap['competitor_detection'] - gap['detection']:.1f} points",
            f"In neutral prompts, {gap['competitor']} appears in {gap['competitor_detection']:.1f}% "
            f"of answers, compared with {gap['detection']:.1f}% for the property.",
            metrics,
        ))

    stale_params: list[Any] = [property_id, start, end]
    stale_sql = """select id, intent_id, engine_id from intelligence
                   where property_id = %s and period_start = %s and period_end = %s
                     and insight_type = 'visibility_gap' and generated_by = 'sql_rollup'"""
    if intent_id:
        stale_sql += " and intent_id = %s"
        stale_params.append(intent_id)
    if scoped_engine_id:
        stale_sql += " and engine_id = %s"
        stale_params.append(scoped_engine_id)
    for existing in conn.execute(stale_sql, stale_params).fetchall():
        key = (str(existing["intent_id"]), str(existing["engine_id"]))
        if key not in active_gap_keys:
            conn.execute("delete from intelligence where id = %s", (existing["id"],))

    from .workflow2 import register_version
    register_version(conn, "insight", MIN_EVIDENCE_RULE)
    return {"generated": len(ids), "insight_ids": ids, "period_start": start, "period_end": end,
            "rule": MIN_EVIDENCE_RULE}


def generate_insights(
    property_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
    intent_id: str | None = None,
    engine_id: str | None = None,
) -> dict[str, Any]:
    with connect() as conn:
        return _generate_insights(conn, property_id, date_from, date_to, intent_id, engine_id)


def _normalise_metrics(metrics: Any, detection: float | None, visibility: float | None) -> dict[str, Any]:
    values = dict(metrics or {})
    if values.get("detection") is None:
        old_rate = values.get("brand_found_rate")
        values["detection"] = detection if old_rate is None else round(float(old_rate) * 100, 2)
    if values.get("visibility_score") is None:
        values["visibility_score"] = visibility
    return values


def _list_insights(
    conn: Connection,
    property_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """with latest as (
             select distinct on (i.intent_id, i.engine_id, i.insight_type) i.*
             from intelligence i
             where i.property_id = %(property_id)s
               and (%(date_from)s::date is null or i.period_end >= %(date_from)s)
               and (%(date_to)s::date is null or i.period_start <= %(date_to)s)
             order by i.intent_id, i.engine_id, i.insight_type, i.period_end desc, i.created_at desc
           )
           select i.*,
                  coalesce(a.answers, 0) as measurement_count,
                  a.detection as measured_detection,
                  a.visibility_score as measured_visibility
           from latest i
           left join lateral (
             select count(*) as answers,
                    round(100.0 * avg(v.found_any::int), 2) as detection,
                    round(avg(case when v.found_any and v.rank_any is not null
                                   then 100.0 / (1 + 0.1 * (v.rank_any - 1)) else 0 end), 2) as visibility_score
             from v_answer_scores v
             where v.property_id = i.property_id
               and v.day between i.period_start and i.period_end
               and (i.intent_id is null or v.intent_id = i.intent_id)
               and (i.engine_id is null or v.engine = (select name from engines where id = i.engine_id))
               and (i.insight_type <> 'visibility_gap' or v.is_neutral)
           ) a on true
           order by i.period_start desc, i.created_at desc, i.insight_type""",
        {"property_id": property_id, "date_from": date_from, "date_to": date_to},
    ).fetchall()
    result = []
    for row in rows:
        insight = _numeric_values(dict(row))
        insight["id"] = str(insight["id"])
        insight["intent_id"] = str(insight["intent_id"]) if insight["intent_id"] else None
        insight["engine_id"] = str(insight["engine_id"]) if insight["engine_id"] else None
        if insight["insight_type"] == "visibility_gap" and insight["intent_id"]:
            insight["insight_type"] = "INTENT_WEAKNESS"
        insight["metrics"] = _normalise_metrics(
            insight.pop("metrics", {}), insight.pop("measured_detection"), insight.pop("measured_visibility")
        )
        result.append(insight)
    return result


def list_insights(
    property_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    property_id = _uuid_text(property_id, "property_id")
    with connect() as conn:
        if not conn.execute("select 1 from properties where id = %s", (property_id,)).fetchone():
            raise ValueError("property not found")
        return _list_insights(conn, property_id, date_from, date_to)


def _insight_scope(conn: Connection, insight: dict[str, Any]) -> tuple[str, dict[str, Any], str | None]:
    engine_name = None
    if insight["engine_id"]:
        engine = conn.execute("select name from engines where id = %s", (insight["engine_id"],)).fetchone()
        engine_name = engine["name"] if engine else None
    neutral_only = insight["insight_type"] == "visibility_gap"
    where, params = _scope(
        str(insight["property_id"]), insight["period_start"], insight["period_end"],
        str(insight["intent_id"]) if insight["intent_id"] else None,
        engine_name, neutral_only,
    )
    return where, params, engine_name


def _breakdown(conn: Connection, where: str, params: dict[str, Any], column: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""select a.{column} as name, count(*) as answers,
                   round(100.0 * avg(a.found_any::int), 2) as detection,
                   round(avg({_SCORE}), 2) as visibility,
                   round(avg(a.rank_any) filter (where a.found_any), 2) as position,
                   round(100.0 * avg((a.found_any and a.rank_any <= 3)::int), 2) as top3,
                   round(100.0 * avg(a.sentiment_any) filter (where a.found_any), 1) as sentiment
            from v_answer_scores a where {where} group by a.{column} order by a.{column}""",
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def _competitor_breakdown(
    conn: Connection,
    insight: dict[str, Any],
    engine_name: str | None,
    where: str,
    params: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    total = conn.execute(f"select count(*) as answers from v_answer_scores a where {where}", params).fetchone()["answers"]
    comp_clauses = [
        "c.property_id = %(property_id)s", "c.day between %(date_from)s and %(date_to)s",
    ]
    comp_params = dict(params)
    if insight["intent_id"]:
        comp_clauses.append("c.intent = (select name from intents where id = %(intent_id)s)")
    if engine_name:
        comp_clauses.append("c.engine = %(engine)s")
    if insight["insight_type"] == "visibility_gap":
        comp_clauses.append("c.is_neutral")
    comp_where = " and ".join(comp_clauses)
    rows = conn.execute(
        f"""select g.name, g.display_name, count(distinct c.measurement_id) as appearances,
                   round(100.0 * count(distinct c.measurement_id) / nullif(%(total)s, 0), 2) as detection,
                   round(coalesce(sum(100.0 / (1 + 0.1 * (c.rank - 1))), 0) / nullif(%(total)s, 0), 2) as visibility
            from competitor_groups g
            left join v_competitor_answer_scores c on c.group_id = g.id and {comp_where}
            where g.property_id = %(property_id)s and g.is_tracked
            group by g.id, g.name, g.display_name, g.sort_order
            order by detection desc nulls last, visibility desc nulls last, g.sort_order""",
        {**comp_params, "total": total},
    ).fetchall()
    return [dict(row) for row in rows], total


def _evidence_package(conn: Connection, insight_id: str) -> dict[str, Any]:
    try:
        parsed_id = UUID(insight_id)
    except ValueError as error:
        raise ValueError("insight not found") from error
    insight = conn.execute("select * from intelligence where id = %s", (parsed_id,)).fetchone()
    if not insight:
        raise ValueError("insight not found")
    insight = dict(insight)
    where, params, engine_name = _insight_scope(conn, insight)
    metrics = dict(insight["metrics"] or {})
    answers = _aggregate_metrics(
        conn, str(insight["property_id"]), insight["period_start"], insight["period_end"],
        str(insight["intent_id"]) if insight["intent_id"] else None, engine_name,
        neutral_only=insight["insight_type"] == "visibility_gap",
    )
    metrics = _normalise_metrics(metrics, answers["detection"], answers["visibility_score"])

    total = conn.execute(f"select count(*) as answers from v_answer_scores a where {where}", params).fetchone()["answers"]
    limit = 200
    measurements = conn.execute(
        f"""select a.measurement_id, p.prompt_text as prompt, a.engine, a.found_any as detected,
                   a.rank_any as position, {_SCORE} as visibility_score, a.measured_at
            from v_answer_scores a join prompts p on p.id = a.prompt_id
            where {where}
            order by a.found_any asc, a.measured_at desc, a.measurement_id
            limit %(limit)s""",
        {**params, "limit": limit},
    ).fetchall()

    citations = conn.execute(
        f"""select e.domain, count(*) as count,
                   count(*) filter (where e.attributed_to = 'own_brand') as for_hotel,
                   count(*) filter (where e.attributed_to = 'competitor') as for_competitors,
                   coalesce(dc.category, 'Other') as source_type
            from evidence e
            join v_answer_scores a on a.measurement_id = e.measurement_id
            left join v_domain_category dc on dc.property_id = e.property_id and dc.domain = e.domain
            where {where} and e.domain is not null
            group by e.domain, coalesce(dc.category, 'Other')
            order by count(*) desc, e.domain limit 100""",
        params,
    ).fetchall()
    competitors, _ = _competitor_breakdown(conn, insight, engine_name, where, params)

    client_insight = dict(insight)
    client_insight["id"] = str(client_insight["id"])
    client_insight["intent_id"] = str(client_insight["intent_id"]) if client_insight["intent_id"] else None
    client_insight["engine_id"] = str(client_insight["engine_id"]) if client_insight["engine_id"] else None
    if client_insight["insight_type"] == "visibility_gap" and client_insight["intent_id"]:
        client_insight["insight_type"] = "INTENT_WEAKNESS"
    return {
        "insight": client_insight,
        "metrics": metrics,
        "measurement_count": total,
        "measurements_returned": len(measurements),
        "measurements_truncated": total > limit,
        "engine_breakdown": _breakdown(conn, where, params, "engine"),
        "intent_breakdown": _breakdown(conn, where, params, "intent"),
        "competitors": competitors,
        "relevant_measurements": [dict(row) for row in measurements],
        "citations": [dict(row) for row in citations],
    }


def evidence_package(insight_id: str) -> dict[str, Any]:
    with connect() as conn:
        return _evidence_package(conn, insight_id)