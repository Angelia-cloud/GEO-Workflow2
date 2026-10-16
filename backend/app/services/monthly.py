"""Monthly GEO reporting, computed from Supabase measurements.

Month = the calendar month of `measured_at` in Australia/Sydney (v_answer_scores.day), never the export a
row arrived in. Metric definitions are the report's (see services/report.py): RankScale `brand_found`,
visibility = mean of 100/(1+0.1*(rank-1)) when found else 0, competitor figures on the neutral prompt set.

Comparisons never invent a baseline: a month is compared with the previous calendar month only when
that month has data, and when either month is partial the comparison is restricted to the days of the
month both cover ("matched days") so the two periods are like for like.
"""
from __future__ import annotations

import calendar
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from ..db import connect, run_many
from .name_mappings import canonical_intent, sql_map
from .report import (METRICS, _cols, _metric_sql, _num, competitor_metrics, competitor_metrics_query, movement,
                     short_name)

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
BOUNDARY_TOLERANCE_DAYS = 2   # data within this many days of a month boundary still counts as covering it
MIN_ANSWERS = 20              # smallest group a change is reported for
CHANGE_POINTS = 5.0           # visibility change (points) that counts as an improvement or decline
METRIC_NOTE = ("Detection uses RankScale's own brand_found flag; visibility is the mean answer score "
               "(100 at rank 1, falling 10% per rank, 0 when absent). Hotel metrics use all tracked prompts; "
               "competitor metrics use the neutral prompt set. Months follow the Australia/Sydney calendar.")


def parse_month(month: str) -> tuple[date, date]:
    match = MONTH_RE.match(month or "")
    if not match:
        raise ValueError("month must look like 2026-09")
    year, number = int(match.group(1)), int(match.group(2))
    return date(year, number, 1), date(year, number, calendar.monthrange(year, number)[1])


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def previous_month(month: str) -> str:
    start, _ = parse_month(month)
    return month_key(start - timedelta(days=1))


def coverage(start: date, end: date, first: date, last: date, days_with_data: int) -> dict[str, Any]:
    """Whether the data covers the whole month. Pure function (unit tested)."""
    reasons = []
    if first > start + timedelta(days=BOUNDARY_TOLERANCE_DAYS):
        reasons.append(f"data starts on {first.day} {calendar.month_abbr[first.month]}")
    if last < end - timedelta(days=BOUNDARY_TOLERANCE_DAYS):
        reasons.append(f"data ends on {last.day} {calendar.month_abbr[last.month]}")
    return {"partial": bool(reasons), "partial_reason": "; ".join(reasons) or None,
            "first_day": first.isoformat(), "last_day": last.isoformat(),
            "days_with_data": days_with_data, "calendar_days": (end - start).days + 1}


def common_window(a: dict[str, Any], b: dict[str, Any]) -> tuple[int, int] | None:
    """Day-of-month range covered by both months, or None. Pure function (unit tested)."""
    low = max(date.fromisoformat(a["first_day"]).day, date.fromisoformat(b["first_day"]).day)
    high = min(date.fromisoformat(a["last_day"]).day, date.fromisoformat(b["last_day"]).day)
    return (low, high) if low <= high else None


def list_months(property_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("""
            select to_char(date_trunc('month', day), 'YYYY-MM') as month, min(day) as first_day, max(day) as last_day,
                   count(distinct day) as days_with_data, count(*) as answers,
                   count(distinct prompt_id) as tracked_questions,
                   count(distinct prompt_id) filter (where is_neutral) as comparison_questions,
                   round(100.0 * avg(found_rs::int), 2) as detection
            from v_answer_scores where property_id = %s group by 1 order by 1""", (property_id,)).fetchall()
    months = []
    for row in rows:
        start, end = parse_month(row["month"])
        months.append({"month": row["month"], "label": f"{calendar.month_name[start.month]} {start.year}",
                       "answers": row["answers"], "detection": float(row["detection"]),
                       "tracked_questions": row["tracked_questions"],
                       "comparison_questions": row["comparison_questions"],
                       **coverage(start, end, row["first_day"], row["last_day"], row["days_with_data"])})
    return months


def _group_query(pid, dim, df, dt, names="rankscale", neutral=False) -> tuple[str, tuple]:
    found, rank, sent = _cols(names)
    extra = " and a.is_neutral" if neutral else ""
    if dim in ("engine", "intent"):
        values, params = sql_map(dim)
        return (f"""select coalesce(m.canon, a.{dim}) as name, {_metric_sql(found, rank, sent)}
                    from v_answer_scores a
                    left join (values {values}) as m(alias, canon) on lower(btrim(a.{dim})) = m.alias
                    where a.property_id = %s and a.day between %s and %s{extra}
                    group by coalesce(m.canon, a.{dim}) order by 1""", (*params, pid, df, dt))
    return (f"""select {_metric_sql(found, rank, sent)}
                from v_answer_scores where property_id = %s and day between %s and %s{extra.replace('a.', '')}""",
            (pid, df, dt))


def _group(conn, pid, dim, df, dt, names="rankscale", neutral=False):
    """Metrics for the property, optionally by intent or engine. Duplicate names are merged through
    name_mappings at read time; the stored measurements are untouched."""
    sql, params = _group_query(pid, dim, df, dt, names, neutral)
    return [_num(r) for r in conn.execute(sql, params).fetchall()]


class _Batch:
    """Independent read queries sent together (one network round trip); each result keeps its own shaping."""

    def __init__(self):
        self._items: list[tuple[str, Any, Any]] = []

    def add(self, sql: str, params: Any, shape=lambda rows: rows) -> int:
        self._items.append((sql, params, shape))
        return len(self._items) - 1

    def group(self, *args, **kwargs) -> int:
        sql, params = _group_query(*args, **kwargs)
        return self.add(sql, params, lambda rows: [_num(r) for r in rows])

    def overall(self, pid: str, df: date, dt: date) -> tuple[int, int]:
        return self.group(pid, None, df, dt), self.group(pid, None, df, dt, names="all")

    def run(self, conn) -> list[Any]:
        rows = run_many(conn, [(sql, params) for sql, params, _ in self._items])
        return [shape(r) for (_, _, shape), r in zip(self._items, rows)]


def _overall_from(rs_rows: list[dict[str, Any]], all_rows: list[dict[str, Any]]) -> dict[str, Any]:
    base = rs_rows[0] if rs_rows and rs_rows[0].get("answers") else {}
    if base:
        base["detection_any_alias"] = all_rows[0]["detection"]
    return base


def _overall(conn, pid: str, df: date, dt: date) -> dict[str, Any]:
    batch = _Batch()
    a, b = batch.overall(pid, df, dt)
    out = batch.run(conn)
    return _overall_from(out[a], out[b])


def _deltas(current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for metric in METRICS:
        cur, prev = current.get(metric), previous.get(metric)
        if cur is None or prev is None:
            continue
        out[metric] = {"current": cur, "previous": prev, "change": round(cur - prev, 2),
                       "movement": movement(cur, prev, metric)}
    return out


def _changes(cur_rows: list[dict[str, Any]], prev_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-intent / per-engine change in visibility; only groups with enough answers on both sides are judged."""
    prev = {r["name"]: r for r in prev_rows}
    out = []
    for row in cur_rows:
        before = prev.get(row["name"])
        if not before:
            out.append({"name": row["name"], "status": "no_previous_data", "answers": row["answers"]})
            continue
        change = round(row["visibility"] - before["visibility"], 2)
        enough = row["answers"] >= MIN_ANSWERS and before["answers"] >= MIN_ANSWERS
        if not enough:
            status = "insufficient_data"
        elif change >= CHANGE_POINTS:
            status = "improved"
        elif change <= -CHANGE_POINTS:
            status = "declined"
        else:
            status = "stable"
        out.append({"name": row["name"], "status": status, "visibility": row["visibility"],
                    "previous_visibility": before["visibility"], "change": change,
                    "detection": row["detection"], "previous_detection": before["detection"],
                    "detection_change": round(row["detection"] - before["detection"], 2),
                    "answers": row["answers"], "previous_answers": before["answers"]})
    return sorted(out, key=lambda r: r.get("change") if r.get("change") is not None else 0)


def _comparison(conn, pid: str, month: str, current_cov: dict[str, Any], months: dict[str, dict[str, Any]]) -> dict[str, Any]:
    prev_key = previous_month(month)
    prev_cov = months.get(prev_key)
    if not prev_cov:
        return {"available": False, "previous_month": prev_key,
                "reason": f"No measurements exist for {prev_key}, so there is nothing to compare against."}
    start, _ = parse_month(month)
    pstart, pend = parse_month(prev_key)
    if not current_cov["partial"] and not prev_cov["partial"]:
        basis, window = "full_month", None
        cur_from, cur_to = parse_month(month)
        prev_from, prev_to = pstart, pend
    else:
        window = common_window(current_cov, prev_cov)
        if not window:
            return {"available": False, "previous_month": prev_key,
                    "reason": "The two months cover different days, so no like-for-like comparison is possible."}
        basis = "matched_days"
        cur_from, cur_to = start.replace(day=window[0]), start.replace(day=window[1])
        prev_from, prev_to = pstart.replace(day=window[0]), pstart.replace(day=window[1])
    batch = _Batch()
    cur_q, prev_q = batch.overall(pid, cur_from, cur_to), batch.overall(pid, prev_from, prev_to)
    groups = [batch.group(pid, dim, a, b) for dim in ("intent", "engine")
              for a, b in ((cur_from, cur_to), (prev_from, prev_to))]
    out = batch.run(conn)
    current, previous = _overall_from(*(out[i] for i in cur_q)), _overall_from(*(out[i] for i in prev_q))
    result = {"available": True, "previous_month": prev_key, "basis": basis,
              "window": None if not window else f"days {window[0]}–{window[1]} of each month",
              "current_answers": current.get("answers"), "previous_answers": previous.get("answers"),
              "metrics": _deltas(current, previous),
              "intents": _changes(out[groups[0]], out[groups[1]]),
              "engines": _changes(out[groups[2]], out[groups[3]])}
    if basis == "matched_days":
        result["caveat"] = ("One of the months is partial, so both were compared over the days they share "
                            "to keep the comparison like for like.")
    return result


def _month_competitors_query(pid: str, df: date, dt: date) -> tuple[str, dict]:
    return competitor_metrics_query(pid, df, dt, answer_table="v_answer_scores",
                                    competitor_table="v_competitor_answer_scores")


def _month_competitors_shape(property_name: str):
    return lambda rows: [{**_num(r), "name": r["name"], "display_name": r.get("display_name") or r["name"],
                          "is_self": r["name"] == property_name} for r in rows]


def _month_competitors(conn, pid: str, df: date, dt: date, property_name: str) -> list[dict[str, Any]]:
    sql, params = _month_competitors_query(pid, df, dt)
    return _month_competitors_shape(property_name)(conn.execute(sql, params).fetchall())


def _hotel_neutral_from(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return rows[0] if rows and rows[0].get("answers") else None


def _hotel_neutral(conn, pid: str, df: date, dt: date) -> dict[str, Any] | None:
    """The hotel on the same neutral prompt set the competitors are measured on (fair comparison)."""
    return _hotel_neutral_from(_group(conn, pid, None, df, dt, neutral=True))


def _intent_competitors(conn, pid: str, df: date, dt: date) -> list[dict[str, Any]]:
    """Per guest-need ranking: the hotel and each tracked competitor on neutral prompts only."""
    batch = _Batch()
    hotel_q = batch.group(pid, "intent", df, dt, neutral=True)
    questions_q = batch.add("""select intent_id, count(distinct prompt_id) as n from v_answer_scores
                               where property_id = %s and is_neutral and day between %s and %s group by intent_id""",
                            (pid, df, dt))
    intents_q = batch.add("select id, name from intents where property_id = %s order by name", (pid,))
    first = batch.run(conn)
    hotel = {r["name"]: r for r in first[hotel_q]}
    questions = {str(r["intent_id"]): r["n"] for r in first[questions_q]}
    wanted = [i for i in first[intents_q] if canonical_intent(i["name"]) in hotel]
    per_intent = _Batch()
    for intent in wanted:
        per_intent.add(*competitor_metrics_query(pid, df, dt, intent_id=str(intent["id"]),
                                                 answer_table="v_answer_scores",
                                                 competitor_table="v_competitor_answer_scores"))
    out = []
    for intent, comps in zip(wanted, per_intent.run(conn)):
        name = canonical_intent(intent["name"])
        h = hotel[name]
        out.append({"intent": name, "answers": h["answers"], "questions": questions.get(str(intent["id"]), 0),
                    "hotel": {"visibility": h["visibility"], "detection": h["detection"]},
                    "competitors": [{"name": c.get("display_name") or c["name"],
                                     "visibility": float(c["visibility"] or 0), "detection": float(c["detection"] or 0)}
                                    for c in comps]})
    return out


def _monthly_trend(conn, pid: str, months: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Hotel detection / visibility per month and per engine, same definition every month."""
    batch, slots = _Batch(), []
    for m in months:
        start, end = parse_month(m["month"])
        slots.append((batch.group(pid, None, start, end), batch.add(*_prompt_counts_query(pid, start, end)),
                      batch.group(pid, "engine", start, end)))
    results = batch.run(conn)
    out = []
    for m, (overall_q, counts_q, engines_q) in zip(months, slots):
        overall = results[overall_q][0]
        prompt_counts = _prompt_counts_from(results[counts_q])
        out.append({"month": m["month"], "label": m["label"], "partial": m["partial"], "partial_reason": m["partial_reason"],
                    "answers": overall["answers"], "detection": overall["detection"], "visibility": overall["visibility"],
                    **prompt_counts,
                    "engines": [{"name": e["name"], "answers": e["answers"], "detection": e["detection"]}
                                for e in results[engines_q]]})
    return out


def _competitor_trend(conn, pid: str, property_name: str, months: list[dict[str, Any]]) -> list[dict[str, Any]]:
    batch, slots = _Batch(), []
    for m in months:
        start, end = parse_month(m["month"])
        slots.append((batch.add(*_month_competitors_query(pid, start, end), _month_competitors_shape(property_name)),
                      batch.group(pid, None, start, end, neutral=True)))
    results = batch.run(conn)
    out = []
    for m, (comp_q, hotel_q) in zip(months, slots):
        rows = results[comp_q]
        out.append({"month": m["month"], "partial": m["partial"], "hotel": _hotel_neutral_from(results[hotel_q]),
                    "competitors": [{"name": r["display_name"], "visibility": r["visibility"], "detection": r["detection"],
                                     "is_self": r["is_self"]} for r in rows]})
    return out


def _prompt_counts_query(pid: str, start: date, end: date) -> tuple[str, tuple]:
    return ("""select count(distinct prompt_id) as tracked_questions,
                      count(distinct prompt_id) filter (where is_neutral) as comparison_questions
               from v_answer_scores where property_id = %s and day between %s and %s""", (pid, start, end))


def _prompt_counts_from(rows: list[dict[str, Any]]) -> dict[str, int]:
    row = rows[0]
    return {"tracked_questions": row["tracked_questions"], "comparison_questions": row["comparison_questions"]}


def _prompt_counts(conn, pid: str, start: date, end: date) -> dict[str, int]:
    sql, params = _prompt_counts_query(pid, start, end)
    return _prompt_counts_from(conn.execute(sql, params).fetchall())


def _half_month_windows(months: list[dict[str, Any]]) -> list[tuple[date, date]]:
    windows = []
    for item in months:
        start, end = parse_month(item["month"])
        first_end = min(start.replace(day=15), end)
        windows.append((start, first_end))
        if first_end < end:
            windows.append((first_end + timedelta(days=1), end))
    return windows


def _trend_segments(months: list[dict[str, Any]], selected_start: date,
                    selected_end: date) -> list[tuple[date, date, bool]]:
    """Half-month windows through the selected end; windows cut at the selected start, which is marked."""
    segments = []
    for window_start, window_end in _half_month_windows(months):
        if window_start > selected_end:
            break
        if window_start < selected_start:
            before_end = min(window_end, selected_start - timedelta(days=1))
            if window_start <= before_end:
                segments.append((window_start, before_end, False))
        if window_end >= selected_start and window_start <= selected_end:
            segments.append((max(window_start, selected_start), min(window_end, selected_end), True))
    return segments


def _period_trend(conn, pid: str, property_name: str, months: list[dict[str, Any]],
                  selected_start: date, selected_end: date) -> list[dict[str, Any]]:
    """Verified half-month history through the selected end, marking the applied range."""
    segments = _trend_segments(months, selected_start, selected_end)
    batch, slots = _Batch(), []
    for start, end, _selected in segments:  # every segment's figures in one round trip
        slots.append((
            batch.group(pid, None, start, end),
            batch.add("""select min(day) as first_day, max(day) as last_day, count(distinct day) as days_with_data
                         from v_answer_scores where property_id = %s and day between %s and %s""", (pid, start, end)),
            batch.group(pid, None, start, end, neutral=True),
            batch.add(*_month_competitors_query(pid, start, end), _month_competitors_shape(property_name)),
            batch.add(*_prompt_counts_query(pid, start, end)),
        ))
    results = batch.run(conn)
    trend = []
    for (start, end, selected), (overall_q, coverage_q, neutral_q, competitors_q, counts_q) in zip(segments, slots):
        overall_rows = results[overall_q]
        overall = overall_rows[0] if overall_rows else {}
        if not overall.get("answers"):
            continue
        coverage_row = results[coverage_q][0]
        cov = coverage(start, end, coverage_row["first_day"], coverage_row["last_day"], coverage_row["days_with_data"])
        neutral = _hotel_neutral_from(results[neutral_q])
        competitor_rows = results[competitors_q]
        prompt_counts = _prompt_counts_from(results[counts_q])
        label = f"{start.day} {calendar.month_abbr[start.month]}" if start == end else (
            f"{start.day}–{end.day} {calendar.month_abbr[end.month]}")
        trend.append({
            "from": start.isoformat(), "to": end.isoformat(),
            "label": label, "selected_period": selected,
            "partial": cov["partial"], "partial_reason": cov["partial_reason"],
            "answers": overall["answers"], "detection": overall["detection"],
            "tracked_questions": prompt_counts["tracked_questions"],
            "comparison": {
                "hotel": neutral,
                "questions": prompt_counts["comparison_questions"],
                "competitors": [{"name": row["display_name"], "answers": row["answers"], "detection": row["detection"],
                                 "visibility": row["visibility"], "is_self": row["is_self"]}
                                for row in competitor_rows],
            },
        })
    return trend


def _stored_findings(conn, pid: str, df: date, dt: date) -> dict[str, Any]:
    insights, diagnoses, recs = run_many(conn, [("""
        select distinct on (i.intent_id, i.engine_id, i.insight_type)
               i.id, i.insight_type, i.title, i.summary as finding, i.status, i.generated_by, i.period_start, i.period_end,
               (i.metrics->>'answers')::int as evidence_count
        from intelligence i
        where i.property_id = %s and i.period_start >= %s and i.period_end <= %s
        order by i.intent_id, i.engine_id, i.insight_type, i.created_at desc""", (pid, df, dt)), ("""
        select d.id, d.diagnosis_type, d.root_cause, d.severity, d.confidence_score, d.status, d.generated_by,
               i.name as intent, e.name as engine, m.measured_at,
               (select count(*) from evidence ev where ev.measurement_id = m.id) as evidence_rows
        from diagnoses d join measurements m on m.id = d.measurement_id
        join prompts p on p.id = m.prompt_id join intents i on i.id = p.intent_id and i.property_id = %s
        join engines e on e.id = m.engine_id
        where (m.measured_at at time zone 'Australia/Sydney')::date between %s and %s
        order by d.created_at desc""", (pid, df, dt)), ("""
        select r.id, r.title, r.detail, r.action_type, r.priority, r.expected_impact, r.status,
               coalesce((select d.generated_by from diagnoses d where d.id = r.diagnosis_id), 'analyst') as generated_by,
               r.owner, r.due_date, r.diagnosis_id, i.name as intent, e.name as engine, m.measured_at,
               (select count(*) from evidence ev where ev.measurement_id = m.id) as evidence_rows
        from recommendations r join measurements m on m.id = r.measurement_id
        join prompts p on p.id = m.prompt_id join intents i on i.id = p.intent_id and i.property_id = %s
        join engines e on e.id = m.engine_id
        where (m.measured_at at time zone 'Australia/Sydney')::date between %s and %s
        order by r.created_at desc""", (pid, df, dt))])
    insights = sorted(insights, key=lambda r: -(r["evidence_count"] or 0))
    return {"insights": [dict(r) for r in insights], "diagnoses": [dict(r) for r in diagnoses],
            "recommendations": [dict(r) for r in recs]}


def _report_extras(conn, pid: str, df: date, dt: date) -> dict[str, Any]:
    """Supporting facts for the client report layout, all read from stored records:
    the most-cited web sources in the period, the recorded baseline (benchmarks table) and the
    website work logged as done in Team review (recommendation_outcomes), with its before/after reading."""
    total_rows, own_rows, rows, baseline_rows, outcomes = run_many(conn, [
        ("select count(*) as n from v_answer_scores where property_id = %s and day between %s and %s", (pid, df, dt)),
        ("select coalesce(own_domains, '{}') as d from properties where id = %s", (pid,)),
        ("""
        select lower(e.domain) as domain, count(distinct a.measurement_id) as answers,
               count(distinct a.measurement_id) filter (where a.found_rs) as answers_mentioning
        from evidence e join v_answer_scores a on a.measurement_id = e.measurement_id
        where a.property_id = %s and a.day between %s and %s and e.domain is not null
        group by 1 order by 2 desc, 1 limit 8""", (pid, df, dt)),
        ("""
        select label, as_of, value from benchmarks
        where property_id = %s and kind = 'baseline' and prompt_set = 'full' and dimension = 'overall'
          and metric = 'detection' and (as_of is null or as_of <= %s)
        order by as_of desc nulls last limit 1""", (pid, dt)),
        ("""
        select o.done_on, o.window_days, o.before_answers, o.before_detection, o.after_answers, o.after_detection,
               o.before_visibility, o.after_visibility, o.note, r.title, r.action_type, i.name as intent
        from recommendation_outcomes o join recommendations r on r.id = o.recommendation_id
        left join intents i on i.id = o.intent_id
        where o.property_id = %s and o.done_on <= %s order by o.done_on, r.title""", (pid, dt)),
    ])
    total = total_rows[0]["n"] or 0
    own = own_rows[0] if own_rows else None
    own_domains = [d.lower() for d in (own["d"] if own else [])]
    baseline = baseline_rows[0] if baseline_rows else None
    sources = [{"domain": r["domain"], "answers": r["answers"],
                "share": round(100.0 * r["answers"] / total, 1) if total else None,
                "mention_share": round(100.0 * r["answers_mentioning"] / r["answers"], 1) if r["answers"] else None,
                "own": any(r["domain"] == d or r["domain"].endswith("." + d) for d in own_domains)}
               for r in rows]
    work = []
    for o in outcomes:
        item = {k: (v.isoformat() if isinstance(v, date) else _num_or(v)) for k, v in dict(o).items()}
        window_end = o["done_on"] + timedelta(days=(o["window_days"] or 28) - 1)
        item["state"] = ("waiting for data" if not o["after_answers"]
                         else "partial window" if window_end > dt else "complete")
        work.append(item)
    return {"sources": sources, "answers_total": total,
            "baseline": ({"label": baseline["label"], "as_of": baseline["as_of"].isoformat() if baseline["as_of"] else None,
                          "detection": float(baseline["value"])} if baseline else None),
            "website_work": work}


def _num_or(value):
    return float(value) if isinstance(value, Decimal) else value


def _commercial_flags(property_id: str, start: date, end: date) -> list[dict[str, Any]]:
    """Verified visibility gaps for the month with their commercial status, taken from the opportunity
    assessment so there is a single definition. Commercial priority is never inferred."""
    from .opportunities import assess
    items = assess(property_id, start, end, save=False)["opportunities"]
    return [{"intent": i["intent"], "gap_points": i["visibility"]["gap_points"],
             "top_competitor": i["visibility"]["top_competitor"], "answers": i["visibility"]["answers"],
             "commercial_status": i["commercial"]["status"], "missing": i["commercial"]["missing"],
             "rank": i["commercial"]["rank"]}
            for i in items if i["visibility"]["status"] == "gap"]


def _run(fn, *args):
    """Run one read-only query group on its own connection so the groups can execute concurrently."""
    with connect() as conn:
        return fn(conn, *args)


_TREND_CACHE: dict[str, tuple[float, tuple[Any, Any]]] = {}


def _trends(property_id: str, name: str, months: list[dict[str, Any]]):
    """Month-independent history (same for every selected month), computed once per property."""
    key = f"{property_id}:{','.join(m['month'] + str(m['answers']) for m in months)}"
    hit = _TREND_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        ct = pool.submit(_run, _competitor_trend, property_id, name, months)
        mt = pool.submit(_run, _monthly_trend, property_id, months)
        value = (ct.result(), mt.result())
    _TREND_CACHE[key] = (time.monotonic(), value)
    return value


def _range_comparison(conn, pid: str, start: date, end: date, cur_cov: dict[str, Any]) -> dict[str, Any]:
    """Custom range vs the equally long period immediately before it, same metric definitions."""
    days = (end - start).days + 1
    prev_to = start - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    label = f"{prev_from.strftime('%-d %b %Y')} – {prev_to.strftime('%-d %b %Y')}"
    batch = _Batch()
    prev_q, cur_q = batch.overall(pid, prev_from, prev_to), batch.overall(pid, start, end)
    prev_cov_q = batch.add("select min(day) as f, max(day) as l, count(distinct day) as n from v_answer_scores "
                           "where property_id = %s and day between %s and %s", (pid, prev_from, prev_to))
    groups = [batch.group(pid, dim, a, b) for dim in ("intent", "engine")
              for a, b in ((start, end), (prev_from, prev_to))]
    out = batch.run(conn)
    previous = _overall_from(*(out[i] for i in prev_q))
    if not previous.get("answers"):
        return {"available": False, "previous_month": None, "previous_label": label,
                "reason": f"No measurements exist for the preceding period ({label}), so there is nothing to compare against."}
    current = _overall_from(*(out[i] for i in cur_q))
    prev_cov = out[prev_cov_q][0]
    partial = cur_cov["partial"] or coverage(prev_from, prev_to, prev_cov["f"], prev_cov["l"], prev_cov["n"])["partial"]
    result = {"available": True, "previous_month": None, "previous_label": label, "basis": "equal_length_period",
              "window": f"{days} days vs the {days} days before",
              "current_answers": current.get("answers"), "previous_answers": previous.get("answers"),
              "metrics": _deltas(current, previous),
              "intents": _changes(out[groups[0]], out[groups[1]]),
              "engines": _changes(out[groups[2]], out[groups[3]])}
    if partial:
        result["caveat"] = "One of the two periods has days without measurements, so the comparison may not be like for like."
    return result


def _range_label(start: date, end: date) -> str:
    return f"{start.strftime('%-d %b %Y')} – {end.strftime('%-d %b %Y')}"


def period_report(property_id: str, start: date, end: date, month: str | None = None) -> dict[str, Any]:
    """Report for a calendar month (month given) or any custom Sydney date range, same calculations."""
    if start > end:
        raise ValueError("From date must not be later than To date.")
    with ThreadPoolExecutor(max_workers=2) as pool:
        prop_f = pool.submit(_run, lambda c: c.execute("select id, name, short_name from properties where id = %s", (property_id,)).fetchone())
        months_f = pool.submit(list_months, property_id)
        prop, months = prop_f.result(), months_f.result()
    if not prop:
        raise ValueError("property not found")
    by_key = {m["month"]: m for m in months}
    if month:
        if month not in by_key:
            raise LookupError(f"No verified measurements exist for {month}.")
        cov, label = by_key[month], by_key[month]["label"]
    else:
        with connect() as conn:
            row = conn.execute("select min(day) as f, max(day) as l, count(distinct day) as n, "
                               "count(distinct prompt_id) as tracked_questions, "
                               "count(distinct prompt_id) filter (where is_neutral) as comparison_questions "
                               "from v_answer_scores "
                               "where property_id = %s and day between %s and %s", (property_id, start, end)).fetchone()
        if not row or not row["n"]:
            raise LookupError(f"No RankScale measurements exist between {start.isoformat()} and {end.isoformat()}.")
        cov, label = {**coverage(start, end, row["f"], row["l"], row["n"]),
                      "tracked_questions": row["tracked_questions"],
                      "comparison_questions": row["comparison_questions"]}, _range_label(start, end)

    def last_import(conn):
        return conn.execute("""select b.filename, b.created_at, b.status from import_batches b
                               where b.property_id = %s and b.status = 'loaded'
                                 and exists (
                                   select 1 from v_answer_scores a
                                   join measurements m on m.id = a.measurement_id
                                   where a.property_id = b.property_id and a.day between %s and %s
                                     and m.import_batch = b.id::text
                                 )
                               order by b.created_at desc limit 1""",
                            (property_id, start, end)).fetchone()

    def compare(conn):
        return _comparison(conn, pid, month, cov, by_key) if month else _range_comparison(conn, pid, start, end, cov)

    pid = property_id
    with ThreadPoolExecutor(max_workers=8) as pool:
        f = {
            "overall": pool.submit(_run, _overall, property_id, start, end),
            "engines": pool.submit(_run, lambda c: _group(c, property_id, "engine", start, end)),
            "intents": pool.submit(_run, lambda c: _group(c, property_id, "intent", start, end)),
            "competitors": pool.submit(_run, _month_competitors, property_id, start, end, prop["name"]),
            "comparison": pool.submit(_run, compare),
            "stored": pool.submit(_run, _stored_findings, property_id, start, end),
            "last_import": pool.submit(_run, last_import),
            "hotel_neutral": pool.submit(_run, _hotel_neutral, property_id, start, end),
            "intent_competitors": pool.submit(_run, _intent_competitors, property_id, start, end),
            "flags": pool.submit(_commercial_flags, property_id, start, end),
            "trends": pool.submit(_trends, property_id, prop["name"], months),
            "period_trend": pool.submit(_run, _period_trend, property_id, prop["name"], months, start, end),
            "extras": pool.submit(_run, _report_extras, property_id, start, end),
        }
        r = {k: v.result() for k, v in f.items()}
    cov = {**cov, "answers": r["overall"].get("answers", 0)}
    competitor_trend, monthly_trend = r["trends"]
    period_trend = r["period_trend"]
    li = r["last_import"]
    if month and r["comparison"].get("available"):
        r["comparison"].setdefault("previous_label", by_key[r["comparison"]["previous_month"]]["label"])
    return {"property": {"id": str(prop["id"]), "name": prop["name"],
                         "short_name": short_name(prop["name"], prop.get("short_name"))}, "month": month or month_key(end), "label": label,
            "range": {"from": start.isoformat(), "to": end.isoformat(), "custom": month is None},
            "coverage": cov, "metric_definition": METRIC_NOTE, "overall": r["overall"], "engines": r["engines"],
            "intents": r["intents"], "competitors": r["competitors"], "competitor_trend": competitor_trend,
            "monthly_trend": monthly_trend, "period_trend": period_trend,
            "hotel_neutral": r["hotel_neutral"], "intent_competitors": r["intent_competitors"],
            "comparison": r["comparison"], "commercial_flags": r["flags"],
            "findings": r["stored"], "available_months": months,
            "sources": r["extras"]["sources"], "baseline": r["extras"]["baseline"],
            "website_work": r["extras"]["website_work"],
            "last_import": dict(li) if li else None}


def month_report(property_id: str, month: str) -> dict[str, Any]:
    start, end = parse_month(month)
    return period_report(property_id, start, end, month)


_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
CACHE_SECONDS = 1800  # measurements only change on import, which clears the cache


def clear_cache(property_id: str | None = None) -> None:
    from . import opportunities
    opportunities.clear_cache(property_id)
    _TREND_CACHE.clear()
    for key in [k for k in _CACHE if property_id is None or k[0] == property_id]:
        _CACHE.pop(key, None)


def cached_month_report(property_id: str, month: str) -> dict[str, Any]:
    parse_month(month)
    hit = _CACHE.get((property_id, month))
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    report = month_report(property_id, month)
    _CACHE[(property_id, month)] = (time.monotonic(), report)
    return report


def cached_range_report(property_id: str, start: date, end: date) -> dict[str, Any]:
    key = (property_id, f"{start}_{end}")
    hit = _CACHE.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    report = period_report(property_id, start, end)
    _CACHE[key] = (time.monotonic(), report)
    return report


def prewarm(property_id: str) -> None:
    """Build every month report once so the first page view is served from memory."""
    for m in list_months(property_id):
        try:
            cached_month_report(property_id, m["month"])
        except Exception:  # noqa: BLE001 — warming is best effort
            pass


def refresh_intelligence(property_id: str, months: list[str], diagnose: int = 3) -> dict[str, Any]:
    """After an import: refresh monthly figures, deterministic insights and alerts for the affected months,
    then diagnose the most important insights (Groq when configured, otherwise the rules fallback)."""
    from . import review_flow
    from .insights import generate_insights
    from .workflow2 import detect_alerts
    clear_cache(property_id)
    try:
        from ..routers import assistant
        assistant._CACHE.clear()
    except Exception:  # noqa: BLE001 — cache clearing must never fail an import
        pass
    out: dict[str, Any] = {"months": {}}
    for month in months:
        start, end = parse_month(month)
        insights = generate_insights(property_id, start, end)
        ids = list(insights.get("insight_ids") or [])[:diagnose]
        entry: dict[str, Any] = {"insights": len(ids), "diagnosed": 0}
        try:
            entry["alerts"] = len(detect_alerts(property_id, end).get("alerts", []))
        except Exception as error:  # noqa: BLE001
            entry["alerts_error"] = str(error)
        if ids:
            try:
                entry["diagnosed"] = len(review_flow.diagnose_insights(property_id, [str(i) for i in ids], 1))
            except Exception as error:  # noqa: BLE001
                entry["diagnosis_error"] = str(error)
        out["months"][month] = entry
    clear_cache(property_id)  # the new insights and diagnoses belong in the next report read
    return out
