"""Opportunity assessment: verified AI-visibility gaps (RankScale) joined with the hotel's own confirmed
business priorities. Extends the existing diagnosis/recommendation workflow; it adds no AI agent.

Rules
* A visibility gap is measured, never inferred: on the neutral prompt set, the best tracked competitor's
  visibility minus the hotel's visibility for that intent, over answers in the period.
* Commercial information comes only from `intent_business_priorities`, entered by an authorised team member.
  Nothing is estimated. Missing or unconfirmed information => "Commercial validation required".
* An opportunity is ranked only when its commercial priority is confirmed and complete. The rank score is
  gap x importance x strategic relevance x feasibility (high=3, medium=2, low=1) and is shown with its inputs;
  revenue potential is displayed but not used, because the hotel's figures are not comparable by default.
* Proposed GEO actions are the existing agent-drafted recommendations for that intent, labelled "potential
  GEO improvement". The visibility finding and the commercial status are stored in separate fields.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from ..db import connect
from .report import competitor_metrics

GAP_POINTS = 5.0       # competitor leads by at least this many visibility points to count as a gap
MIN_NEUTRAL_ANSWERS = 20
WEIGHT = {"high": 3, "medium": 2, "low": 1}
REQUIRED_FIELDS = ("commercial_importance", "strategic_relevance", "feasibility", "evidence_source")
VALIDATION_REQUIRED = "Commercial validation required"
VALIDATED = "Commercially validated"
LEVELS = ("high", "medium", "low")
RATING_FIELDS = ("commercial_importance", "strategic_relevance", "feasibility")


def _f(v):
    return None if v is None else float(v)


def missing_commercial_fields(priority: dict[str, Any] | None) -> list[str]:
    if not priority:
        return [*REQUIRED_FIELDS, "client_confirmation"]
    missing = [f for f in REQUIRED_FIELDS if not priority.get(f)]
    if priority.get("confirmation_status") != "confirmed":
        missing.append("client_confirmation")
    return missing


def _priorities(conn, property_id: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute("""select p.*, t.name as confirmed_by_name from intent_business_priorities p
                           left join team_members t on t.id = p.confirmed_by where p.property_id = %s""",
                        (property_id,)).fetchall()
    return {str(r["intent_id"]): dict(r) for r in rows}


def _intent_evidence(conn, property_id: str, intent: dict[str, Any], df: date, dt: date) -> dict[str, Any]:
    iid = str(intent["id"])
    own = conn.execute("""
        select count(*) as answers, count(distinct prompt_id) as prompts, count(distinct engine) as engines,
               round(avg(case when found_rs then 100.0/(1+0.1*(rank_rs-1)) else 0 end), 2) as visibility,
               round(100.0*avg(case when found_rs then 1 else 0 end), 2) as detection,
               min(measured_at) as first_at, max(measured_at) as last_at
        from v_answer_scores where property_id=%s and intent_id=%s and is_neutral and day between %s and %s""",
        (property_id, iid, df, dt)).fetchone()
    comps = [dict(r) for r in competitor_metrics(conn, property_id, df, dt, intent_id=iid,
                                                 answer_table="v_answer_scores", competitor_table="v_competitor_answer_scores")]
    comps = sorted(comps, key=lambda r: -(_f(r["visibility"]) or 0))
    by_engine = [dict(r) for r in conn.execute("""
        select engine, count(*) as answers, count(*) filter (where found_rs) as mentions,
               round(100.0*avg(case when found_rs then 1 else 0 end), 1) as detection
        from v_answer_scores where property_id=%s and intent_id=%s and is_neutral and day between %s and %s
        group by engine order by 4, 1""", (property_id, iid, df, dt)).fetchall()]
    # The web sources each assistant cites for this intent: share of its answers citing each domain.
    engine_sources = conn.execute("""
        select a.engine, lower(e.domain) as domain, count(distinct a.measurement_id) as answers
        from evidence e join v_answer_scores a on a.measurement_id = e.measurement_id
        where a.property_id=%s and a.intent_id=%s and a.is_neutral and a.day between %s and %s and e.domain is not null
        group by 1, 2 order by 1, 3 desc, 2""", (property_id, iid, df, dt)).fetchall()
    cited = conn.execute("""
        select a.engine, count(distinct a.measurement_id) as answers
        from evidence e join v_answer_scores a on a.measurement_id = e.measurement_id
        where a.property_id=%s and a.intent_id=%s and a.is_neutral and a.day between %s and %s and e.domain is not null
        group by 1""", (property_id, iid, df, dt)).fetchall()
    cited_by = {r["engine"]: r["answers"] for r in cited}
    for row in by_engine:
        row["answers_with_links"] = cited_by.get(row["engine"], 0)
        row["sources"] = [{"domain": s["domain"], "answers": s["answers"]}
                          for s in engine_sources if s["engine"] == row["engine"]][:3]
    weak_prompts = [dict(r) for r in conn.execute("""
        select p.prompt_text as prompt, count(*) as answers,
               round(100.0*avg(case when a.found_rs then 1 else 0 end), 1) as detection
        from v_answer_scores a join prompts p on p.id = a.prompt_id
        where a.property_id=%s and a.intent_id=%s and a.is_neutral and a.day between %s and %s
        group by p.prompt_text order by 3, 2 desc limit 3""", (property_id, iid, df, dt)).fetchall()]
    misses = [dict(r) for r in conn.execute("""
        select measurement_id, engine, measured_at from v_answer_scores
        where property_id=%s and intent_id=%s and is_neutral and not found_rs and day between %s and %s
        order by measured_at desc limit 5""", (property_id, iid, df, dt)).fetchall()]
    citations = [dict(r) for r in conn.execute("""
        select e.url, e.domain, e.title, e.excerpt, e.attributed_to, e.confidence_score,
               e.verification_status, count(*) as answer_count
        from evidence e join v_answer_scores a on a.measurement_id = e.measurement_id
        where a.property_id=%s and a.intent_id=%s and a.is_neutral and a.day between %s and %s
          and e.url is not null
        group by e.url, e.domain, e.title, e.excerpt, e.attributed_to, e.confidence_score, e.verification_status
        order by answer_count desc, e.domain, e.url limit 20""", (property_id, iid, df, dt)).fetchall()]
    return {"own": own, "competitors": comps, "engines": by_engine, "weak_prompts": weak_prompts,
            "sample_misses": misses, "citations": citations}


def _actions(conn, property_id: str, intent_name: str, df: date, dt: date) -> list[dict[str, Any]]:
    rows = conn.execute("""
        select title, action_type, count(*) as n, max(detail) as detail
        from v_recommendation_queue
        where property_id=%s and intent=%s and status <> 'rejected' and length(coalesce(detail,'')) >= 30
          and (measured_at at time zone 'Australia/Sydney')::date between %s and %s
        group by title, action_type order by n desc, title limit 3""", (property_id, intent_name, df, dt)).fetchall()
    return [dict(r) for r in rows]


def _clean(obj):
    return json.loads(json.dumps(obj, default=str))


def assess(property_id: str, date_from: date, date_to: date, save: bool = True) -> dict[str, Any]:
    with connect() as conn:
        intents = conn.execute("""select distinct i.id, i.name from intents i join v_answer_scores a on a.intent_id = i.id
                                  where i.property_id=%s and a.day between %s and %s order by i.name""",
                               (property_id, date_from, date_to)).fetchall()
        priorities = _priorities(conn, property_id)
        items = []

        def _gather(intent):
            with connect() as c:  # per-intent read-only queries run concurrently, one connection each
                return (_intent_evidence(c, property_id, intent, date_from, date_to),
                        _actions(c, property_id, intent["name"], date_from, date_to))

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=6) as pool:
            gathered = list(pool.map(_gather, intents))
        for intent, (ev, actions) in zip(intents, gathered):
            own_vis, answers = _f(ev["own"]["visibility"]), ev["own"]["answers"]
            top = ev["competitors"][0] if ev["competitors"] else None
            top_vis = _f(top["visibility"]) if top else None
            if answers < MIN_NEUTRAL_ANSWERS or own_vis is None or top_vis is None:
                gap, gap_status = None, "insufficient_data"
            else:
                gap = round(top_vis - own_vis, 2)
                gap_status = "gap" if gap >= GAP_POINTS else "no_gap"
            prio = priorities.get(str(intent["id"]))
            missing = missing_commercial_fields(prio)
            validated = not missing
            top_action = actions[0] if actions else None
            if gap_status == "gap" and top:
                finding = (f"On neutral prompts {top['display_name'] or top['name']} reaches visibility {top_vis} vs {own_vis} "
                           f"for the hotel ({gap} points, {answers} answers, {ev['own']['engines']} engines).")
            elif gap_status == "no_gap":
                finding = f"No visibility gap of {GAP_POINTS:g} points or more against tracked competitors ({answers} answers)."
            else:
                finding = f"Insufficient data: {answers} neutral answers (minimum {MIN_NEUTRAL_ANSWERS})."
            score = None
            if validated and gap_status == "gap" and all(prio.get(k) for k in RATING_FIELDS):
                score = round(gap * WEIGHT[prio["commercial_importance"]] * WEIGHT[prio["strategic_relevance"]]
                              * WEIGHT[prio["feasibility"]], 2)
            if validated and gap_status == "gap":
                rationale = (f"Gap is a verified RankScale finding. Hotel-confirmed priority: importance "
                             f"{prio['commercial_importance']}, strategic relevance {prio['strategic_relevance']}, "
                             f"feasibility {prio['feasibility']} (source: {prio['evidence_source']}).")
            elif gap_status == "gap":
                rationale = ("Gap is a verified RankScale finding. The hotel has not confirmed the commercial priority "
                             f"(missing: {', '.join(missing)}), so this action is provisional and cannot be ranked.")
            else:
                rationale = "No action is proposed from visibility alone."
            items.append({
                "intent_id": str(intent["id"]), "intent": intent["name"],
                "visibility": {"status": gap_status, "gap_points": gap, "hotel_visibility": own_vis,
                               "hotel_detection": _f(ev["own"]["detection"]), "answers": answers,
                               "top_competitor": (top["display_name"] or top["name"]) if top else None,
                               "top_competitor_visibility": top_vis, "finding": finding, "kind": "verified_rankscale_finding"},
                "competitor_evidence": [{"name": c["display_name"] or c["name"], "visibility": _f(c["visibility"]),
                                         "detection": _f(c["detection"])} for c in ev["competitors"]],
                "commercial": {"status": VALIDATED if validated else VALIDATION_REQUIRED, "missing": missing,
                               "priority": ({k: (_f(v) if k == "revenue_potential" else v) for k, v in prio.items()
                                             if k not in ("created_at",)} if prio else None),
                               "rank_score": score, "rank": None},
                "proposed_action": ({"text": top_action["title"], "type": top_action["action_type"],
                                     "supporting_recommendations": top_action["n"],
                                     "kind": "potential_geo_improvement"} if top_action and gap_status == "gap"
                                    else None),
                "other_actions": [a["title"] for a in actions[1:]] if gap_status == "gap" else [],
                "rationale": rationale,
                "evidence": {"period": {"from": date_from, "to": date_to, "first_measurement": ev["own"]["first_at"],
                                        "last_measurement": ev["own"]["last_at"]},
                             "prompts": ev["own"]["prompts"], "engines": ev["engines"], "weakest_prompts": ev["weak_prompts"],
                             "sample_missing_answers": ev["sample_misses"], "citations": ev["citations"]},
            })
        ranked = sorted((i for i in items if i["commercial"]["rank_score"] is not None),
                        key=lambda i: -i["commercial"]["rank_score"])
        for n, item in enumerate(ranked, 1):
            item["commercial"]["rank"] = n
        items.sort(key=lambda i: (i["commercial"]["rank"] is None, i["commercial"]["rank"] or 0,
                                  -(i["visibility"]["gap_points"] or -999)))
        if save:
            for i in items:
                conn.execute("""
                    insert into opportunity_assessments (property_id, intent_id, period_start, period_end, visibility_gap,
                        gap_status, commercial_status, validation_missing, priority_rank, proposed_action, action_kind,
                        rationale, evidence, priority_snapshot, generated_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'potential_geo_improvement',%s,%s::jsonb,%s::jsonb,now())
                    on conflict (intent_id, period_start, period_end) do update set
                        visibility_gap=excluded.visibility_gap, gap_status=excluded.gap_status,
                        commercial_status=excluded.commercial_status, validation_missing=excluded.validation_missing,
                        priority_rank=excluded.priority_rank, proposed_action=excluded.proposed_action,
                        rationale=excluded.rationale, evidence=excluded.evidence,
                        priority_snapshot=excluded.priority_snapshot, generated_at=now()""",
                    (property_id, i["intent_id"], date_from, date_to, i["visibility"]["gap_points"], i["visibility"]["status"],
                     i["commercial"]["status"], i["commercial"]["missing"], i["commercial"]["rank"],
                     (i["proposed_action"] or {}).get("text"), i["rationale"],
                     json.dumps(_clean({"visibility": i["visibility"], "competitors": i["competitor_evidence"], **i["evidence"]})),
                     json.dumps(_clean(i["commercial"]["priority"])) if i["commercial"]["priority"] else None))
            conn.commit()
    return _clean({"property_id": property_id, "period": {"from": date_from, "to": date_to}, "saved": save,
                   "opportunities": items,
                   "method": {"gap_points": GAP_POINTS, "min_answers": MIN_NEUTRAL_ANSWERS,
                              "rank_formula": "gap x importance x strategic relevance x feasibility (high=3, medium=2, low=1); "
                                              "only for confirmed, complete priorities",
                              "note": "Visibility gaps are verified RankScale findings. Proposed actions are potential GEO "
                                      "improvements. Commercial priority comes only from hotel-confirmed inputs."}})


def list_priorities(property_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        intents = conn.execute("""select id, name from intents i where property_id=%s
                               and exists (select 1 from v_answer_scores a where a.intent_id = i.id) order by name""",
                               (property_id,)).fetchall()
        prios = _priorities(conn, property_id)
    out = []
    for i in intents:
        p = prios.get(str(i["id"]))
        out.append(_clean({"intent_id": str(i["id"]), "intent": i["name"], "priority": p,
                           "status": VALIDATED if not missing_commercial_fields(p) else VALIDATION_REQUIRED,
                           "missing": missing_commercial_fields(p)}))
    return out


def save_priority(property_id: str, intent_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Record or update the hotel's priority for one intent. Only active team members may do so, and a
    'confirmed' priority must name its evidence source. Every change is kept in the history table."""
    for f in RATING_FIELDS:
        if data.get(f) is not None and data[f] not in LEVELS:
            raise ValueError(f"{f} must be one of {', '.join(LEVELS)}")
    status = data.get("confirmation_status", "proposed")
    if status not in ("not_provided", "proposed", "confirmed"):
        raise ValueError("confirmation_status must be not_provided, proposed or confirmed")
    revenue = data.get("revenue_potential")
    if revenue is not None:
        if float(revenue) < 0:
            raise ValueError("revenue_potential cannot be negative")
        if not (data.get("revenue_currency") and data.get("revenue_basis")):
            raise ValueError("Revenue potential needs its currency and the basis it was calculated on")
    if status == "confirmed" and not (data.get("evidence_source") or "").strip():
        raise ValueError("A confirmed priority needs an evidence source (e.g. who confirmed it and where it is documented)")
    with connect() as conn:
        user = conn.execute("select id, name from team_members where id=%s and is_active", (user_id,)).fetchone()
        if not user:
            raise PermissionError("Only an active team member can record business priorities")
        intent = conn.execute("select id from intents where id=%s and property_id=%s", (intent_id, property_id)).fetchone()
        if not intent:
            raise LookupError("Search intent not found for this property")
        confirmed = status == "confirmed"
        row = conn.execute("""
            insert into intent_business_priorities (property_id, intent_id, commercial_importance, revenue_potential,
                revenue_currency, revenue_basis, strategic_relevance, feasibility, confirmation_status, evidence_source,
                confirmed_by, confirmed_at, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,case when %s then now() end,%s)
            on conflict (intent_id) do update set commercial_importance=excluded.commercial_importance,
                revenue_potential=excluded.revenue_potential, revenue_currency=excluded.revenue_currency,
                revenue_basis=excluded.revenue_basis, strategic_relevance=excluded.strategic_relevance,
                feasibility=excluded.feasibility, confirmation_status=excluded.confirmation_status,
                evidence_source=excluded.evidence_source, confirmed_by=excluded.confirmed_by,
                confirmed_at=excluded.confirmed_at, notes=excluded.notes, updated_at=now()
            returning *""",
            (property_id, intent_id, data.get("commercial_importance"), revenue, data.get("revenue_currency"),
             data.get("revenue_basis"), data.get("strategic_relevance"), data.get("feasibility"), status,
             (data.get("evidence_source") or None), user_id if confirmed else None, confirmed, data.get("notes"))).fetchone()
        conn.execute("insert into intent_business_priority_history (property_id, intent_id, snapshot, changed_by) "
                     "values (%s,%s,%s::jsonb,%s)", (property_id, intent_id, json.dumps(_clean(dict(row))), user_id))
        conn.commit()
    return _clean({**row, "confirmed_by_name": user["name"] if confirmed else None,
                   "status": VALIDATED if not missing_commercial_fields(dict(row)) else VALIDATION_REQUIRED,
                   "missing": missing_commercial_fields(dict(row))})
