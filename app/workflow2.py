"""Workflow 2 (monthly run) pieces from the architecture diagram that sit around the agents.

    Auto alert        detect_alerts()       flags sharp score drops after each upload
    Human review      apply_feedback()      approve / reject / edit an insight, diagnosis or recommendation
    Learning memory   (written by apply_feedback) what a reviewer changed, at which step, and why
    Agent versions    register_version()    the prompt / rule text each agent ran with
    Outcome logging   set_recommendation_status() + refresh_outcomes()   before/after score once actioned

Scores use the report's definitions (see db/07_report.sql) and Rankscale's own brand detection, so
an alert or an outcome always matches the numbers on the Report tab.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from .db import connect

# ---------------------------------------------------------------------------
# Tunables (override in .env)
# ---------------------------------------------------------------------------
ALERT_WINDOW_DAYS = int(os.environ.get("GEO_ALERT_WINDOW_DAYS", "7"))      # "latest run" window
ALERT_HISTORY_WINDOWS = int(os.environ.get("GEO_ALERT_HISTORY_WINDOWS", "3"))  # windows averaged for the baseline
ALERT_DROP_PCT = float(os.environ.get("GEO_ALERT_DROP_PCT", "15"))          # relative drop that raises an alert
ALERT_MIN_POINTS = float(os.environ.get("GEO_ALERT_MIN_POINTS", "3"))       # ...and at least this many points
ALERT_MIN_ANSWERS = int(os.environ.get("GEO_ALERT_MIN_ANSWERS", "12"))      # min answers in each window
OUTCOME_WINDOW_DAYS = int(os.environ.get("GEO_OUTCOME_WINDOW_DAYS", "28"))

SCORE = "case when a.found_rs then 100.0 / (1 + 0.1 * (a.rank_rs - 1)) else 0 end"

ALERT_RULES = f"""Auto alert rule (Workflow 2 · Measurements & processing)
- Latest window = the last {ALERT_WINDOW_DAYS} days of data; baseline = the average of up to
  {ALERT_HISTORY_WINDOWS} earlier windows of the same length.
- Raise an alert when Visibility or Detection falls by >= {ALERT_DROP_PCT}% relative AND >= {ALERT_MIN_POINTS}
  points, with >= {ALERT_MIN_ANSWERS} answers in both the latest window and the baseline.
- Scopes: whole prompt set, neutral competitor set, each AI engine, each intent.
- Severity: high when the relative drop is >= {2 * ALERT_DROP_PCT}%, otherwise medium."""

STEP_OF = {"recommendation": "recommendation", "diagnosis": "diagnosis",
           "intelligence": "insight", "evidence": "measurement", "measurement": "measurement"}
EDITABLE = {
    "recommendation": {"title", "detail", "action_type", "priority", "expected_impact", "owner", "due_date"},
    "diagnosis": {"diagnosis_type", "root_cause", "severity"},
    "intelligence": {"title", "summary"},
}
TABLE_OF = {"recommendation": "recommendations", "diagnosis": "diagnoses", "intelligence": "intelligence",
            "evidence": "evidence", "measurement": "measurements"}


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date,)):
        return value.isoformat()
    return value


def _plain_row(row: dict | None) -> dict:
    return {k: _plain(v) for k, v in (row or {}).items()}


# ---------------------------------------------------------------------------
# Agent versions
# ---------------------------------------------------------------------------
def register_version(conn, step: str, prompt_text: str, model: str | None = None) -> str | None:
    """Return the agent_versions id for this exact prompt/rule text, creating it the first time."""
    if not conn.execute("select to_regclass('public.agent_versions') is not null as ok").fetchone()["ok"]:
        return None  # database not upgraded to 09 yet
    digest = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
    row = conn.execute("""insert into agent_versions (step, prompt_hash, prompt_text, model)
                          values (%s, %s, %s, %s)
                          on conflict (step, prompt_hash) do update set model = coalesce(agent_versions.model, excluded.model)
                          returning id""", (step, digest, prompt_text, model)).fetchone()
    return str(row["id"])


# ---------------------------------------------------------------------------
# Auto alerts
# ---------------------------------------------------------------------------
def _window_metrics(conn, pid: str, start: date, end: date, dim: str | None, neutral: bool) -> dict:
    col = {"engine": "a.engine", "intent": "a.intent"}.get(dim or "", "'all'")
    rows = conn.execute(f"""
        select {col} as key, count(*) as answers,
               round(avg({SCORE}), 2) as visibility,
               round(100.0 * avg(a.found_rs::int), 2) as detection
        from v_answer_scores a
        where a.property_id = %s and a.day between %s and %s {"and a.is_neutral" if neutral else ""}
        group by 1""", (pid, start, end)).fetchall()
    return {r["key"]: _plain_row(r) for r in rows}


def detect_alerts(pid: str, as_of: date | None = None) -> dict:
    """Compare the latest window with the recent baseline and save sharp drops as 'alert' insights."""
    with connect() as conn:
        span = conn.execute("select min(day) as first, max(day) as last from v_answer_scores where property_id = %s",
                            (pid,)).fetchone()
        if not span["last"]:
            return {"alerts": [], "checked": False, "reason": "No measurements yet"}
        end = as_of or span["last"]
        start = end - timedelta(days=ALERT_WINDOW_DAYS - 1)
        windows = []
        for k in range(1, ALERT_HISTORY_WINDOWS + 1):
            w_end = start - timedelta(days=(k - 1) * ALERT_WINDOW_DAYS + 1)
            w_start = w_end - timedelta(days=ALERT_WINDOW_DAYS - 1)
            if w_end < span["first"]:
                break
            windows.append((max(w_start, span["first"]), w_end))
        version_id = register_version(conn, "alert", ALERT_RULES)
        if not windows:
            conn.commit()
            return {"alerts": [], "checked": False, "window": [start, end],
                    "reason": f"Need more than {ALERT_WINDOW_DAYS} days of history to compare against"}

        found = []
        scopes = [("overall", None, False, "Whole prompt set"), ("neutral", None, True, "Neutral competitor set"),
                  ("engine", "engine", False, None), ("intent", "intent", False, None)]
        engine_ids = {r["name"]: str(r["id"]) for r in conn.execute("select id, name from engines").fetchall()}
        intent_ids = {r["name"]: str(r["id"]) for r in conn.execute(
            "select id, name from intents where property_id = %s", (pid,)).fetchall()}
        for scope, dim, neutral, label in scopes:
            cur = _window_metrics(conn, pid, start, end, dim, neutral)
            hist = [_window_metrics(conn, pid, s, e, dim, neutral) for s, e in windows]
            for key, now in cur.items():
                past = [h[key] for h in hist if key in h and h[key]["answers"] >= ALERT_MIN_ANSWERS]
                if now["answers"] < ALERT_MIN_ANSWERS or not past:
                    continue
                for metric in ("visibility", "detection"):
                    base = round(sum(p[metric] for p in past) / len(past), 2)
                    if not base:
                        continue
                    drop_pts = base - now[metric]
                    drop_pct = drop_pts / base * 100
                    if drop_pct >= ALERT_DROP_PCT and drop_pts >= ALERT_MIN_POINTS:
                        name = label or key
                        found.append({
                            "scope": scope, "key": key, "name": name, "metric": metric,
                            "current": now[metric], "baseline": base, "drop_points": round(drop_pts, 2),
                            "drop_pct": round(drop_pct, 1), "answers": now["answers"],
                            "baseline_answers": sum(p["answers"] for p in past),
                            "severity": "high" if drop_pct >= 2 * ALERT_DROP_PCT else "medium",
                            "intent_id": intent_ids.get(key) if scope == "intent" else None,
                            "engine_id": engine_ids.get(key) if scope == "engine" else None,
                        })
        # one alert row per scope/key: keep the bigger drop when both metrics fire
        best: dict[tuple, dict] = {}
        for a in found:
            k = (a["scope"], a["key"])
            if k not in best or a["drop_pct"] > best[k]["drop_pct"]:
                best[k] = {**a, "also": best.get(k, {}).get("metric")}
        saved = []
        for a in best.values():
            metric_name = "Visibility Score" if a["metric"] == "visibility" else "Detection Rate"
            title = f"Sharp drop · {a['name']}: {metric_name} down {a['drop_pct']}%"
            summary = (f"{metric_name} fell from {a['baseline']} (average of the previous "
                       f"{len(windows)} × {ALERT_WINDOW_DAYS}-day windows) to {a['current']} in "
                       f"{start:%d %b}–{end:%d %b} across {a['answers']} answers. Check whether it repeats "
                       f"in the next run before acting; AI answers are non-deterministic.")
            # the neutral-set alert has no intent/engine either, so it is stored as a competitor_threat
            # (same unique key as the whole-set alert otherwise)
            itype = "competitor_threat" if a["scope"] == "neutral" else "alert"
            row = conn.execute("""
                insert into intelligence (property_id, intent_id, engine_id, period_start, period_end, insight_type,
                                          title, summary, metrics, generated_by)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, 'sql_rollup')
                on conflict (property_id, intent_id, engine_id, insight_type, period_start, period_end)
                do update set title = excluded.title, summary = excluded.summary, metrics = excluded.metrics
                returning id""",
                (pid, a["intent_id"], a["engine_id"], start, end, itype, title, summary,
                 json.dumps({**a, "agent_version_id": version_id}, default=str))).fetchone()
            saved.append({**a, "id": str(row["id"]), "title": title, "summary": summary})
        # an alert from an earlier run of this window that no longer fires (and nobody reviewed) is dropped
        conn.execute("""delete from intelligence
                        where property_id = %s and period_start = %s and period_end = %s and status = 'draft'
                          and (insight_type = 'alert' or (insight_type = 'competitor_threat' and metrics ? 'drop_pct'))
                          and not (id = any(%s::uuid[]))""", (pid, start, end, [s["id"] for s in saved]))
        conn.commit()
        return {"alerts": saved, "checked": True, "window": [start, end], "baseline_windows": windows,
                "rules": ALERT_RULES}


def list_alerts(pid: str, only_open: bool = True) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(f"""
            select id, title, summary, metrics, status, period_start, period_end, created_at, reviewed_by
            from intelligence where property_id = %s
              and (insight_type = 'alert' or (insight_type = 'competitor_threat' and metrics ? 'drop_pct'))
            {"and status <> 'rejected'" if only_open else ""}
            order by period_end desc, (metrics->>'drop_pct')::numeric desc nulls last""", (pid,)).fetchall()
    return [{**_plain_row(r), "id": str(r["id"])} for r in rows]


# ---------------------------------------------------------------------------
# Human review + learning memory
# ---------------------------------------------------------------------------
def _property_for(conn, target: str, target_id: str) -> str | None:
    q = {
        "recommendation": "select f.property_id from recommendations r join v_measurements_flat f on f.measurement_id = r.measurement_id where r.id = %s",
        "diagnosis": "select f.property_id from diagnoses d join v_measurements_flat f on f.measurement_id = d.measurement_id where d.id = %s",
        "intelligence": "select property_id from intelligence where id = %s",
        "evidence": "select property_id from evidence where id = %s",
        "measurement": "select property_id from v_measurements_flat where measurement_id = %s",
    }[target]
    row = conn.execute(q, (target_id,)).fetchone()
    return str(row["property_id"]) if row else None


def apply_feedback(target: str, target_id: str, reviewer: str, decision: str,
                   rating: int | None = None, comment: str | None = None,
                   changes: dict | None = None) -> dict:
    """Record a human decision, apply it (status or edits), and remember corrections for the agents."""
    table = TABLE_OF[target]
    changes = {k: v for k, v in (changes or {}).items() if k in EDITABLE.get(target, set())}
    if decision == "edit" and not changes:
        raise ValueError(f"Nothing to edit. Editable fields for a {target}: {sorted(EDITABLE.get(target, []))}")
    with connect() as conn:
        current = conn.execute(f"select * from {table} where id = %s for update", (target_id,)).fetchone()
        if not current:
            raise LookupError(f"{target} not found")
        row = conn.execute(f"""insert into human_feedback ({target}_id, reviewer, decision, rating, comment)
                               values (%s, %s, %s, %s, %s) returning id""",
                           (target_id, reviewer, decision, rating, comment)).fetchone()
        before, after = {}, {}
        if decision == "edit":
            sets = ", ".join(f"{k} = %s" for k in changes)
            conn.execute(f"update {table} set {sets} where id = %s", (*changes.values(), target_id))
            before = {k: _plain(current[k]) for k in changes}
            after = {k: _plain(v) for k, v in changes.items()}
            if target == "diagnosis":   # an edited diagnosis is a confirmed one
                conn.execute("update diagnoses set status = 'confirmed' where id = %s", (target_id,))
        if decision in ("approve", "reject"):
            if target == "recommendation":
                new = "approved" if decision == "approve" else "rejected"
                conn.execute("update recommendations set status = %s where id = %s", (new, target_id))
            elif target == "diagnosis":
                new = "confirmed" if decision == "approve" else "rejected"
                conn.execute("update diagnoses set status = %s where id = %s", (new, target_id))
            elif target == "evidence":
                new = "verified" if decision == "approve" else "disputed"
                conn.execute("""update evidence set verification_status = %s, verified_by = %s, verified_at = now()
                                where id = %s""", (new, reviewer, target_id))
            elif target == "intelligence":
                new = "approved" if decision == "approve" else "rejected"
                conn.execute("""update intelligence set status = %s, reviewed_by = %s, reviewed_at = now()
                                where id = %s""", (new, reviewer, target_id))
            status_col = {"recommendation": "status", "diagnosis": "status", "intelligence": "status",
                          "evidence": "verification_status"}.get(target)
            if status_col:
                before, after = {status_col: current[status_col]}, {status_col: new}
        memory_id = None
        # remember every change and every reasoned rejection/comment; plain approvals are in human_feedback
        if decision == "edit" or (decision in ("reject", "comment") and comment) or (decision == "reject"):
            if conn.execute("select to_regclass('public.learning_memory') is not null as ok").fetchone()["ok"]:
                if decision == "reject" and target in ("recommendation", "diagnosis", "intelligence"):
                    snap = ("title", "detail", "action_type") if target == "recommendation" else \
                           ("diagnosis_type", "root_cause") if target == "diagnosis" else ("title", "summary")
                    before = {**{k: _plain(current[k]) for k in snap}, **before}
                memory_id = str(conn.execute("""
                    insert into learning_memory (property_id, step, entity_table, entity_id, action, before, after,
                                                 reason, reviewer)
                    values (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s) returning id""",
                    (_property_for(conn, target, target_id), STEP_OF[target], table, target_id, decision,
                     json.dumps(before, default=str), json.dumps(after, default=str), comment, reviewer)
                ).fetchone()["id"])
        conn.commit()
    return {"id": str(row["id"]), "learning_memory_id": memory_id, "applied": after}


def past_corrections(conn, property_id: str, steps: tuple[str, ...] = ("diagnosis", "recommendation"),
                     limit: int = 8) -> list[dict]:
    """The latest reviewer corrections, fed back into the agents ('corrections in / rule updates out')."""
    if not conn.execute("select to_regclass('public.learning_memory') is not null as ok").fetchone()["ok"]:
        return []
    rows = conn.execute("""select step, action, before, after, reason, created_at::date as on
                           from learning_memory
                           where property_id = %s and step = any(%s) and feeds_agent and action in ('edit','reject')
                           order by created_at desc limit %s""", (property_id, list(steps), limit)).fetchall()
    return [{k: _plain(v) for k, v in r.items() if v not in (None, {}, "")} for r in rows]


def list_learning_memory(pid: str, limit: int = 100) -> list[dict]:
    with connect() as conn:
        rows = conn.execute("""select id, step, entity_table, entity_id, action, before, after, reason, reviewer,
                                      feeds_agent, created_at
                               from learning_memory where property_id = %s order by created_at desc limit %s""",
                            (pid, limit)).fetchall()
    return [{**_plain_row(r), "id": str(r["id"]), "entity_id": str(r["entity_id"])} for r in rows]


def list_agent_versions() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("""select v.id, v.step, v.prompt_hash, v.model, v.created_at, left(v.prompt_text, 400) as preview,
                                      (select count(*) from diagnoses d where d.agent_version_id = v.id) as diagnoses
                               from agent_versions v order by v.created_at desc""").fetchall()
    return [{**_plain_row(r), "id": str(r["id"])} for r in rows]


# ---------------------------------------------------------------------------
# Recommendation status + outcome logging (before/after score)
# ---------------------------------------------------------------------------
def _prompt_window(conn, prompt_id: str, start: date, end: date, intent_id: str | None = None) -> dict:
    col, val = ("a.intent_id", intent_id) if intent_id else ("a.prompt_id", prompt_id)
    return _plain_row(conn.execute(f"""
        select count(*) as answers, round(avg({SCORE}), 2) as visibility,
               round(100.0 * avg(a.found_rs::int), 2) as detection
        from v_answer_scores a where {col} = %s and a.day between %s and %s""", (val, start, end)).fetchone())


def _compute_outcome(conn, rec_id: str) -> None:
    o = conn.execute("select * from recommendation_outcomes where recommendation_id = %s", (rec_id,)).fetchone()
    if not o:
        return
    w, done = o["window_days"], o["done_on"]
    b = _prompt_window(conn, o["prompt_id"], done - timedelta(days=w), done - timedelta(days=1))
    a = _prompt_window(conn, o["prompt_id"], done, done + timedelta(days=w - 1))
    bi = _prompt_window(conn, o["prompt_id"], done - timedelta(days=w), done - timedelta(days=1), o["intent_id"])
    ai = _prompt_window(conn, o["prompt_id"], done, done + timedelta(days=w - 1), o["intent_id"])
    conn.execute("""update recommendation_outcomes set
                      before_answers = %s, before_visibility = %s, before_detection = %s,
                      after_answers = %s, after_visibility = %s, after_detection = %s,
                      intent_before_visibility = %s, intent_after_visibility = %s, updated_at = now()
                    where recommendation_id = %s""",
                 (b["answers"], b["visibility"], b["detection"], a["answers"] or 0,
                  a["visibility"] if a["answers"] else None, a["detection"] if a["answers"] else None,
                  bi["visibility"], ai["visibility"] if ai["answers"] else None, rec_id))


def set_recommendation_status(rec_id: str, status: str | None = None, owner: str | None = None,
                              due_date: date | None = None, done_on: date | None = None,
                              reviewer: str | None = None, note: str | None = None,
                              window_days: int | None = None) -> dict:
    with connect() as conn:
        rec = conn.execute("""select r.*, f.prompt_id, f.intent_id, f.property_id
                              from recommendations r join v_measurements_flat f on f.measurement_id = r.measurement_id
                              where r.id = %s for update of r""", (rec_id,)).fetchone()
        if not rec:
            raise LookupError("recommendation not found")
        updates = {k: v for k, v in {"status": status, "owner": owner, "due_date": due_date}.items() if v is not None}
        if updates:
            sets = ", ".join(f"{k} = %s" for k in updates)
            conn.execute(f"update recommendations set {sets} where id = %s", (*updates.values(), rec_id))
            if reviewer:
                conn.execute("""insert into human_feedback (recommendation_id, reviewer, decision, comment)
                                values (%s, %s, 'comment', %s)""",
                             (rec_id, reviewer, f"Status → {status}" if status else note or "updated"))
        if status == "done":
            conn.execute("""insert into recommendation_outcomes (recommendation_id, property_id, prompt_id, intent_id,
                                                                  done_on, window_days, logged_by, note)
                            values (%s, %s, %s, %s, %s, %s, %s, %s)
                            on conflict (recommendation_id) do update set done_on = excluded.done_on,
                              window_days = excluded.window_days, logged_by = excluded.logged_by,
                              note = coalesce(excluded.note, recommendation_outcomes.note)""",
                         (rec_id, rec["property_id"], rec["prompt_id"], rec["intent_id"], done_on or date.today(),
                          window_days or OUTCOME_WINDOW_DAYS, reviewer, note))
            _compute_outcome(conn, rec_id)
        elif status and status != "done":
            conn.execute("delete from recommendation_outcomes where recommendation_id = %s", (rec_id,))
        conn.commit()
        out = conn.execute("select * from recommendation_outcomes where recommendation_id = %s", (rec_id,)).fetchone()
    return {"ok": True, "outcome": _plain_row(out) if out else None}


def refresh_outcomes(pid: str) -> int:
    with connect() as conn:
        if not conn.execute("select to_regclass('public.recommendation_outcomes') is not null as ok").fetchone()["ok"]:
            return 0
        ids = [str(r["recommendation_id"]) for r in conn.execute(
            "select recommendation_id from recommendation_outcomes where property_id = %s", (pid,)).fetchall()]
        for rid in ids:
            _compute_outcome(conn, rid)
        conn.commit()
    return len(ids)


def list_outcomes(pid: str, refresh: bool = True) -> list[dict]:
    if refresh:
        refresh_outcomes(pid)
    with connect() as conn:
        rows = conn.execute("""
            select o.*, r.title, r.action_type, r.owner, p.prompt_text, i.name as intent
            from recommendation_outcomes o
            join recommendations r on r.id = o.recommendation_id
            join prompts p on p.id = o.prompt_id
            left join intents i on i.id = o.intent_id
            where o.property_id = %s order by o.done_on desc""", (pid,)).fetchall()
    out = []
    for r in rows:
        d = _plain_row(r)
        d["recommendation_id"] = str(r["recommendation_id"])
        for k in ("property_id", "prompt_id", "intent_id"):
            d[k] = str(d[k]) if d.get(k) else None
        if d["before_visibility"] is not None and d["after_visibility"] is not None:
            d["change_points"] = round(d["after_visibility"] - d["before_visibility"], 2)
        else:
            d["change_points"] = None
        d["state"] = ("waiting for data" if not d["after_answers"]
                      else "partial window" if (date.fromisoformat(d["done_on"]) + timedelta(days=d["window_days"] - 1)) > date.today()
                      else "complete")
        out.append(d)
    return out
