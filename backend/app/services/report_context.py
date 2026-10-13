"""Server-built, verified context for the report assistant.

Every fact comes from Supabase through the same code that powers /api/report (build_report), restricted to
verified measurements (v_measurements_flat excludes batches flagged synthetic in import_batch_provenance).
The browser sends only a question; it can never supply the facts the assistant answers from.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from ..db import connect
from .report import build_report

# Documented in docs/data_reconciliation_sept_2026.md. The prepared PDF/HTML report is not a data source here.
PUBLISHED_SEPT_NOTE = (
    "The prepared September client report publishes 879 mentions in 1,814 answers (48.5%). That figure cannot be reproduced from the "
    "Supabase measurements imported from the current RankScale exports, so this assistant uses the Supabase figures. "
    "The published report has not been altered."
)


def _src(sid: str, label: str) -> dict:
    return {"id": sid, "label": label}


def _pct(v: Any) -> str:
    return "n/a" if v is None else f"{float(v):.1f}%"


def _topic(tid: str, label: str, text: str, terms: str = "") -> dict:
    return {"id": tid, "text": text, "terms": terms, "sources": [_src(tid, label)]}


def _commercial_text(property_id: str, df: date, dt: date) -> str:
    from .opportunities import assess
    items = assess(property_id, df, dt, save=False)["opportunities"]
    gaps = [i for i in items if i["visibility"]["status"] == "gap"]
    required = [i for i in gaps if i["commercial"]["status"] != "Commercially validated"]
    ranked = sorted((i for i in items if i["commercial"]["rank"]), key=lambda i: i["commercial"]["rank"])
    text = ("Commercial information (revenue, margins, booking processes, conversion rates, strategic priorities) is only "
            "what the hotel has confirmed in the platform; anything else is not stored and must not be assumed. ")
    text += (f"{len(gaps)} intents show a verified visibility gap against competitors: "
             + "; ".join(f"{i['intent']} ({i['visibility']['gap_points']} pts behind {i['visibility']['top_competitor']}, "
                         f"{i['commercial']['status']})" for i in gaps) + ". " if gaps else "No intents show a visibility gap. ")
    if required:
        text += f"Commercial validation required for {len(required)} of them, so their actions are provisional and not ranked. "
    if ranked:
        text += "Ranked by hotel-confirmed priority: " + "; ".join(
            f"#{i['commercial']['rank']} {i['intent']}" for i in ranked) + "."
    return text


def _monthly_text(property_id: str, dt: date) -> str:
    from .monthly import cached_month_report, month_key
    rep = cached_month_report(property_id, month_key(dt))
    parts = ["Months follow Australia/Sydney calendar days of each measurement's own timestamp. Detection by month: "
             + "; ".join(f"{m['label']} {m['detection']}% ({m['answers']:,} answers{', partial month' if m['partial'] else ''})"
                         for m in rep["available_months"]) + "."]
    cmp_ = rep["comparison"]
    if cmp_.get("available"):
        det = cmp_["metrics"].get("detection", {})
        parts.append(f"{rep['label']} vs {cmp_['previous_month']} ({cmp_['basis'].replace('_', ' ')}"
                     f"{', ' + cmp_['window'] if cmp_.get('window') else ''}): detection change {det.get('change')} points. "
                     + "; ".join(f"{c['name']} {c['status']} ({c['change']:+} visibility pts)"
                                 for c in cmp_.get("engines", []) + cmp_.get("intents", [])
                                 if c["status"] != "stable" and c.get("change") is not None))
    else:
        parts.append(f"No month-over-month comparison for {rep['label']}: {cmp_.get('reason')}")
    for m in rep["competitor_trend"]:
        parts.append(f"{m['month']}{' (partial)' if m['partial'] else ''} neutral-prompt visibility: "
                     + ", ".join(f"{c['name']} {c['visibility']}" for c in m["competitors"]) + ".")
    return " ".join(parts)


def build_context(property_id: str, date_from: date | None = None, date_to: date | None = None) -> dict:
    """Return {client, periodLabel, topics, suggestions, ready, definitions} for one property."""
    rep = build_report(property_id, date_from, date_to)
    if rep.get("empty"):
        return {"ready": False, "client": {"name": rep["property"]["name"]}, "periodLabel": "No verified measurements",
                "topics": [], "suggestions": []}
    name, per = rep["property"]["name"], rep["period"]
    df, dt = per["from"], per["to"]
    with connect() as conn:
        cnt = conn.execute("""select count(*) answers, count(distinct prompt_id) prompts, count(distinct engine) engines,
                                     count(*) filter (where is_neutral) neutral_answers,
                                     count(*) filter (where found_rs) found_rs, count(*) filter (where found_any) found_any
                              from v_answer_scores where property_id = %s and day between %s and %s""",
                           (property_id, df, dt)).fetchone()
        engines = [r["engine"] for r in conn.execute(
            "select distinct engine from v_answer_scores where property_id=%s and day between %s and %s order by 1",
            (property_id, df, dt)).fetchall()]
        utc = conn.execute("""select min(measured_at at time zone 'UTC')::date a, max(measured_at at time zone 'UTC')::date b
                              from v_measurements_flat where property_id = %s""", (property_id,)).fetchone()
        diag = conn.execute("""select f.intent, d.diagnosis_type, count(*) n
                               from diagnoses d join v_measurements_flat f on f.measurement_id = d.measurement_id
                               where f.property_id = %s group by 1, 2 order by 1, n desc""", (property_id,)).fetchall()
        recs = conn.execute("""select intent, title, action_type, priority, status, count(*) n
                               from v_recommendation_queue
                               where property_id = %s and length(coalesce(detail, '')) >= 30 and status <> 'rejected'
                               group by intent, title, action_type, priority, status
                               order by n desc limit 40""", (property_id,)).fetchall()
        rec_totals = conn.execute("""select status, count(*) n from v_recommendation_queue
                                     where property_id = %s and length(coalesce(detail, '')) >= 30 group by 1""",
                                  (property_id,)).fetchall()
    period_label = f"{df} to {dt} (Australia/Sydney dates)"
    ov = {o["metric"]: o["current"] for o in rep["overall"]}
    topics: list[dict] = []

    topics.append(_topic("method", "Methodology and metric definitions", (
        f"Reporting period: {df} to {dt} ({per['days']} days, Australia/Sydney dates; all verified data spans {utc['a']} to {utc['b']} in UTC). "
        f"Data: {cnt['answers']:,} verified RankScale answers across {cnt['prompts']} tracked prompts and {cnt['engines']} AI assistants "
        f"({', '.join(engines)}). Of these, {cnt['neutral_answers']:,} answers come from the neutral (non-hotel-named) prompt set used for competitor comparison. "
        "Detection rate = share of answers that mention the hotel, using RankScale's own brand match. "
        f"Counting every confirmed hotel alias (e.g. Shutters, Rick Stein, Eliva Spa) instead gives {cnt['found_any']:,} of {cnt['answers']:,} = "
        f"{100 * cnt['found_any'] / cnt['answers']:.1f}%; RankScale's match gives {cnt['found_rs']:,} of {cnt['answers']:,} = {100 * cnt['found_rs'] / cnt['answers']:.1f}%. "
        "Visibility score = average answer score, where an answer scores 100/(1+0.1*(rank-1)) when the hotel is mentioned at that rank and 0 otherwise. "
        "Average position is the mean rank when mentioned (lower is better); Top 3 = share of answers where the hotel ranks 1 to 3. "
        "A mention is not necessarily a recommendation, visit or booking. Test uploads flagged synthetic are excluded."),
        "method methodology measured measure measurement calculated calculation definition definitions period dates coverage "
        "prompts engines data detection rate visibility score position top3 sentiment verified synthetic"))

    topics.append(_topic("summary", "Overall visibility", (
        f"{name}, {period_label}: detection rate {_pct(ov.get('detection'))}, visibility score {ov.get('visibility')}, "
        f"average position #{ov.get('position')}, top-3 rate {_pct(ov.get('top3'))}, sentiment {ov.get('sentiment')} "
        f"across {cnt['answers']:,} answers (all prompts, RankScale brand match). "
        + "".join(f" {o['metric'].title()} vs pre-schema baseline: {o['vs_baseline']['relative_pct']:+.1f}% relative"
                for o in rep["overall"] if o["metric"] in ("visibility", "detection") and o.get("vs_baseline"))
        + ". The pre-schema baseline is a back-calculated reference (flagged derived), not a directly measured period."),
        "summary overall visibility detection rate score position top3 sentiment performance headline baseline"))

    topics.append(_topic("engines", "AI assistant breakdown", "By AI assistant (detection / visibility / avg position): " + "; ".join(
        f"{e['name']} {_pct(e['detection'])} / {e['visibility']} / #{e['position']} ({e['answers']} answers)"
        for e in rep["engines"]) + ".", "engine engines assistant assistants chatgpt claude gemini perplexity copilot google overview ai"))

    topics.append(_topic("intents", "Search intent breakdown", "By search intent (detection / visibility / answers): " + "; ".join(
        f"{i['name']} {_pct(i['detection'])} / {i['visibility']} ({i['answers']})" for i in sorted(rep["intents"], key=lambda x: x["detection"] or 0))
        + ". Listed lowest to highest detection. Intent names are as stored in Supabase; some overlap in meaning (e.g. Romance & Events, Business / Bleisure).",
        "intent intents search weakest strongest lowest highest wedding weddings corporate events romance business luxury family dining wellness spa gap"))

    weak = sorted((r for r in rep["intent_engine"] if r["answers"] >= 20), key=lambda r: r["detection"] or 0)[:8]
    topics.append(_topic("weak_cells", "Weakest intent and assistant combinations", "Lowest detection by intent and assistant (at least 20 answers): " + "; ".join(
        f"{r['intent']} on {r['engine']} {_pct(r['detection'])} ({r['answers']} answers)" for r in weak) + ".",
        "weakest lowest gap gaps intent engine assistant combination"))

    comp_lines = [f"{c['short'] if c.get('is_self') else (c.get('short') or c['name'])} detection {_pct(c['detection'])}, visibility {c['visibility']}"
                  for c in rep["competitors"]]
    comp_n = rep["competitors"][0]["answers"] if rep["competitors"] else None
    topics.append(_topic("competitors", "Competitor comparison", (
        f"Neutral prompt set only ({comp_n} answers), tracked comparison hotels: " + "; ".join(comp_lines) + ". Detection counts answers mentioning each hotel. "
        "Competitor figures here cover the period above."),
        "competitor competitors compare comparison rival rivals hotels versus lead leads leading manly pier langham double bay hyatt"))

    topics.append(_topic("intent_competition", "Competitor by intent", "Hotel vs the nearest competitor by intent (visibility): " + "; ".join(
        f"{c['intent']}: hotel {c['coogee']} vs " + (", ".join(f"{l['name']} {l['visibility']}" for l in c["leaders"]) or "no tracked competitor") +
        f" ({'hotel is ahead' if c['status'] == 'lead' else 'competitor is ahead' if c['status'] == 'behind' else c['status']})"
        for c in rep["intent_competition"]) + ".", "competitor intent leads leader strongest threat nearest compare"))

    cats = rep["sources"]["categories"]
    topics.append(_topic("sources", "Citation sources", "Citations by source type (share of all citations; share of citations for the hotel): " + "; ".join(
        f"{c['category']} {c['share']}% / {c['share_for_hotel']}%" for c in cats) + ".", "source sources citation citations cited domains website owned ota editorial"))

    by_type: dict[str, int] = {}
    for d in diag:
        by_type[d["diagnosis_type"]] = by_type.get(d["diagnosis_type"], 0) + d["n"]
    topics.append(_topic("findings", "Diagnosis findings", (
        "Automated diagnoses of individual answers where the hotel was missing or weak (agent-drafted, mostly awaiting review): "
        + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])) + ". By intent: "
        + "; ".join(f"{d['intent']} {d['diagnosis_type'].replace('_', ' ')} {d['n']}" for d in diag[:20]) + ". "
        "These are analyses of the stored RankScale answers; they are not independently verified causes."),
        "finding findings diagnosis diagnoses cause causes gap gaps content citation entity confusion competitor dominance sentiment why"))

    totals = {r["status"]: r["n"] for r in rec_totals}
    topics.append(_topic("recommendations", "Recommendations", (
        f"Recommendation records: {sum(totals.values())} ({', '.join(f'{k} {v}' for k, v in totals.items())}). Most are agent-drafted 'potential GEO improvements' awaiting team review; "
        "they are not verified RankScale findings and have no client-confirmed commercial priority. Most frequent proposals: "
        + "; ".join(f"[{r['intent']}] {r['title']} ({r['status']}, x{r['n']})" for r in recs[:12]) + "."),
        "recommend recommendations recommendation action actions prioritise priority priorities focus next improve improvement"))

    topics.append(_topic("commercial", "Commercial information and opportunities", _commercial_text(property_id, df, dt),
        "revenue profit margin booking bookings conversion commercial priority priorities roi value business weddings corporate "
        "opportunity opportunities validation confirmed ranking rank"))

    try:
        topics.append(_topic("monthly", "Month-by-month comparison", _monthly_text(property_id, dt),
                             "month monthly compare comparison previous last change improved declined trend competitor competitors "
                             "august september october november december month-over-month"))
    except Exception:  # noqa: BLE001 — monthly history is supplementary; the rest of the context stays valid
        pass

    topics.append(_topic("limits", "Data coverage and limits", (
        f"Verified RankScale measurements run from {utc['a']} to {utc['b']} (UTC); nothing earlier is stored (no July 2026 data). "
        "Dates are Australia/Sydney calendar days of each measurement's own timestamp. " + PUBLISHED_SEPT_NOTE),
        "july august september month monthly history trend previous published report difference discrepancy 48.5 879 1814 reconcile"))

    return {
        "ready": True, "client": {"name": name}, "periodLabel": period_label, "topics": topics,
        "suggestions": ["Summarise the visibility results", "Which search intents have the biggest gaps?",
                        "How do we compare with competitors?", "How is detection rate defined?"],
        "footer": f"Basis: {period_label}; {cnt['answers']:,} verified RankScale answers. Detection rate = share of answers mentioning the hotel "
                  "(RankScale brand match); visibility = average rank-weighted answer score.",
        "definitions": {"detection": "share of answers mentioning the hotel (RankScale brand match)", "answers": cnt["answers"]},
    }
