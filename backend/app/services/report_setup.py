"""Report setup per client: the facts the report needs about a hotel that the Rankscale export doesn't carry.

  shortName       how report sentences name the hotel ("Coogee Beach"); empty → derived from the name
  aliases         every name AI answers use for the hotel or its outlets (a trailing * = "starts with")
  ignoredNames    names that are neither the hotel nor a competitor (e.g. a lounge in every hotel of a brand)
  ownDomains      web domains that count as the hotel's own site
  namedTerms      extra words that mark a question as naming the hotel (suburb, venue, outlet); questions
                  containing these or any alias are left out of the competitor comparison
  competitors     the comparison hotels: short name, full name and the names AI answers use for each
  baseline        the starting point the report measures against (detection %, optional visibility)

Saving re-applies the names to answers already loaded, re-classifies the questions and clears the report
caches, so the next report read uses the new setup.
"""
from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Any

from ..db import connect, run_many

MAX_ITEMS, MAX_TEXT = 200, 200


def _id(client_id: str) -> str:
    try:
        return str(uuid.UUID(str(client_id)))
    except ValueError as error:
        raise LookupError("Client not found") from error


def _names(values: Any, field: str) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list):
        raise ValueError(f"{field} must be a list.")
    out: list[str] = []
    for value in values:
        text = " ".join(str(value or "").split())
        if not text:
            continue
        if len(text) > MAX_TEXT:
            raise ValueError(f"Keep each entry in {field} within {MAX_TEXT} characters.")
        if text.casefold() not in {o.casefold() for o in out}:
            out.append(text)
    if len(out) > MAX_ITEMS:
        raise ValueError(f"Keep {field} to {MAX_ITEMS} entries.")
    return out


def _domain(value: str) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    return text.split("/")[0]


def get_setup(client_id: str) -> dict[str, Any]:
    pid = _id(client_id)
    with connect() as conn:
        prop = conn.execute("""select id, name, client_name, short_name, aliases, ignored_names, own_domains
                               from properties where id = %s""", (pid,)).fetchone()
        if not prop:
            raise LookupError("Client not found")
        terms, groups, baseline, own_names, mentioned, prompts = run_many(conn, [
            ("select term from neutral_exclusion_terms where property_id = %s order by lower(term)", (pid,)),
            ("""select name, display_name, aliases from competitor_groups
                where property_id = %s and is_tracked order by sort_order, name""", (pid,)),
            ("""select label, as_of, metric, value, is_derived from benchmarks
                where property_id = %s and kind = 'baseline' and prompt_set = 'full' and dimension = 'overall'
                  and metric in ('detection', 'visibility')
                order by as_of desc nulls last""", (pid,)),
            # names Rankscale itself matched as the hotel: candidates for the alias list
            ("""select m.own_brand_name_mentioned as name, count(*) as answers
                from measurements m join prompts pr on pr.id = m.prompt_id join intents i on i.id = pr.intent_id
                where i.property_id = %s and nullif(trim(m.own_brand_name_mentioned), '') is not null
                group by 1 order by 2 desc limit 30""", (pid,)),
            # the brands that appear most often next to the hotel: candidates for the comparison set
            ("""select mm.brand_name_raw as name, count(distinct mm.measurement_id) as answers
                from measurement_mentions mm join measurements m on m.id = mm.measurement_id
                join prompts pr on pr.id = m.prompt_id join intents i on i.id = pr.intent_id
                where i.property_id = %s and not mm.is_own_brand
                group by 1 order by 2 desc, 1 limit 40""", (pid,)),
            ("""select pr.prompt_text, pr.is_neutral from prompts pr join intents i on i.id = pr.intent_id
                where i.property_id = %s and pr.status <> 'rejected'
                  and exists (select 1 from measurements m where m.prompt_id = pr.id)
                order by pr.is_neutral, pr.prompt_text""", (pid,)),
        ])
    aliases = list(prop["aliases"] or [])
    alias_keys = {a.casefold() for a in aliases} | {prop["name"].casefold()}
    tracked = {a.casefold() for g in groups for a in [g["name"], g["display_name"] or "", *(g["aliases"] or [])]}
    label = next((b["label"] for b in baseline), "")
    values = {b["metric"]: float(b["value"]) for b in baseline if b["label"] == label}
    as_of = next((b["as_of"] for b in baseline if b["label"] == label), None)
    return {
        "clientId": pid,
        "property": prop["name"],
        "shortName": prop["short_name"] or "",
        "aliases": aliases,
        "ignoredNames": list(prop["ignored_names"] or []),
        "ownDomains": list(prop["own_domains"] or []),
        "namedTerms": [t["term"] for t in terms],
        "competitors": [{"name": g["name"], "displayName": g["display_name"] or "", "aliases": list(g["aliases"] or [])}
                        for g in groups],
        "baseline": ({"label": label, "asOf": as_of.isoformat() if as_of else None,
                      "detection": values.get("detection"), "visibility": values.get("visibility"),
                      "derived": any(b["is_derived"] for b in baseline if b["label"] == label)}
                     if label else None),
        "questions": {"total": len(prompts), "neutral": sum(1 for p in prompts if p["is_neutral"]),
                      "naming": [p["prompt_text"] for p in prompts if not p["is_neutral"]][:50]},
        "suggestions": {
            "aliases": [{"name": r["name"], "answers": r["answers"]} for r in own_names
                        if r["name"].strip().casefold() not in alias_keys][:15],
            "competitors": [{"name": r["name"], "answers": r["answers"]} for r in mentioned
                            if r["name"].strip().casefold() not in tracked][:15],
        },
    }


def save_setup(client_id: str, data: dict[str, Any]) -> dict[str, Any]:
    pid = _id(client_id)
    short_name = " ".join(str(data.get("shortName") or "").split())[:80]
    aliases = _names(data.get("aliases"), "Hotel names")
    ignored = _names(data.get("ignoredNames"), "Ignored names")
    domains = [d for d in dict.fromkeys(_domain(x) for x in _names(data.get("ownDomains"), "Own websites")) if d]
    terms = _names(data.get("namedTerms"), "Words that name the hotel")
    if any(len(t) < 3 for t in terms):
        raise ValueError("Words that name the hotel need at least 3 characters, or they would match unrelated questions.")
    competitors = []
    for n, item in enumerate(data.get("competitors") or []):
        if not isinstance(item, dict):
            raise ValueError("Each comparison hotel needs a name.")
        name = " ".join(str(item.get("name") or "").split())[:80]
        if not name:
            raise ValueError("Each comparison hotel needs a short name.")
        display = " ".join(str(item.get("displayName") or "").split())[:MAX_TEXT] or name
        names = _names(item.get("aliases"), f"Names for {name}") or [display]
        if name.casefold() in {c["name"].casefold() for c in competitors}:
            raise ValueError(f"{name} is listed twice in the comparison hotels.")
        competitors.append({"name": name, "display": display, "aliases": names, "order": (n + 1) * 10})
    if len(competitors) > 20:
        raise ValueError("Keep the comparison set to 20 hotels or fewer.")
    own = {a.rstrip("*").casefold() for a in aliases}
    for c in competitors:
        clash = [a for a in c["aliases"] if a.rstrip("*").casefold() in own]
        if clash:
            raise ValueError(f"“{clash[0]}” is listed both as a hotel name and for {c['name']}.")
    keep_baseline = bool(data.get("baselineUnchanged"))
    baseline = data.get("baseline")
    if baseline and not keep_baseline:
        try:
            detection = float(baseline.get("detection"))
            visibility = None if baseline.get("visibility") in (None, "") else float(baseline.get("visibility"))
        except (TypeError, ValueError) as error:
            raise ValueError("Enter the baseline detection rate as a number.") from error
        if not 0 <= detection <= 100 or (visibility is not None and not 0 <= visibility <= 100):
            raise ValueError("Baseline figures are percentages between 0 and 100.")
        label = " ".join(str(baseline.get("label") or "").split())[:80] or "Baseline"
        try:
            as_of = date.fromisoformat(str(baseline.get("asOf"))) if baseline.get("asOf") else None
        except ValueError as error:
            raise ValueError("Enter the baseline date as YYYY-MM-DD.") from error

    with connect() as conn:
        prop = conn.execute("select name from properties where id = %s for update", (pid,)).fetchone()
        if not prop:
            raise LookupError("Client not found")
        if prop["name"].casefold() not in {a.casefold() for a in aliases}:
            aliases.insert(0, prop["name"])  # the property name always counts as the hotel
        conn.execute("""update properties set short_name = %s, aliases = %s, ignored_names = %s, own_domains = %s
                        where id = %s""", (short_name or None, aliases, ignored, domains, pid))
        conn.execute("delete from neutral_exclusion_terms where property_id = %s", (pid,))
        if terms:
            conn.cursor().executemany("insert into neutral_exclusion_terms (property_id, term) values (%s, %s) "
                                      "on conflict do nothing", [(pid, t) for t in terms])
        conn.execute("delete from competitor_groups where property_id = %s and not (name = any(%s))",
                     (pid, [c["name"] for c in competitors]))
        if competitors:
            conn.cursor().executemany(
                """insert into competitor_groups (property_id, name, display_name, aliases, sort_order, is_tracked)
                   values (%s, %s, %s, %s, %s, true)
                   on conflict (property_id, name) do update set display_name = excluded.display_name,
                     aliases = excluded.aliases, sort_order = excluded.sort_order, is_tracked = true""",
                [(pid, c["name"], c["display"], c["aliases"], c["order"]) for c in competitors])
        # the overall baseline only; detailed baselines (per engine or guest need) are left as they are
        if keep_baseline:
            pass
        elif baseline:
            conn.execute("""delete from benchmarks where property_id = %s and kind = 'baseline' and prompt_set = 'full'
                            and dimension = 'overall' and metric in ('detection', 'visibility') and label <> %s""",
                         (pid, label))
            rows = [("detection", detection)] + ([("visibility", visibility)] if visibility is not None else [])
            conn.cursor().executemany(
                """insert into benchmarks (property_id, label, kind, as_of, prompt_set, dimension, dim_key, metric, value,
                                          is_derived, note)
                   values (%s, %s, 'baseline', %s, 'full', 'overall', '', %s, %s, false, 'Entered in Report setup')
                   on conflict (property_id, label, prompt_set, dimension, dim_key, metric) do update set
                     value = excluded.value, as_of = excluded.as_of, kind = 'baseline', is_derived = false,
                     note = excluded.note""",
                [(pid, label, as_of, metric, value) for metric, value in rows])
            if visibility is None:
                conn.execute("""delete from benchmarks where property_id = %s and kind = 'baseline' and label = %s
                                and prompt_set = 'full' and dimension = 'overall' and metric = 'visibility'""", (pid, label))
        else:
            conn.execute("""delete from benchmarks where property_id = %s and kind = 'baseline' and prompt_set = 'full'
                            and dimension = 'overall' and metric in ('detection', 'visibility')""", (pid,))
        conn.execute("set local statement_timeout = 0")
        conn.execute("select public.refresh_property_names(%s)", (pid,))
        conn.execute("select public.classify_neutral_prompts()")
        conn.commit()
    _clear_caches(pid)
    return get_setup(pid)


def _clear_caches(pid: str) -> None:
    from . import monthly
    monthly.clear_cache(pid)
    try:
        from ..routers import assistant
        assistant._CACHE.clear()
    except Exception:  # noqa: BLE001 — cache clearing never fails a save
        pass
