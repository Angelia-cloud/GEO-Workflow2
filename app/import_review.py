"""Durable per-upload RankScale mapping review before final measurement loading."""
from __future__ import annotations

import json
import base64
import unicodedata
import uuid
import zlib
from collections import Counter
from typing import Any

from . import loader
from .db import connect
from .ingest import IngestReport, parse_rankscale


ALLOWED_PROMPT_STATUSES = ("approved", "exported", "tracked")
ENGINE_ALIASES = {
    "chatgpt": "ChatGPT", "chatgpt websearch": "ChatGPT", "chatgpt gui": "ChatGPT",
    "google ai overview": "Google AI Overview", "ai overview": "Google AI Overview",
    "google gemini": "Gemini", "google gemini gui": "Gemini",
    "bing copilot": "Bing Copilot", "copilot": "Bing Copilot",
    "anthropic claude": "Claude", "anthropic claude 4 5 haiku": "Claude",
    "perplexity gui": "Perplexity",
}


def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join("".join(char if char.isalnum() else " " for char in text).split())


def prompt_key(topic: str, query: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"rankscale-prompt\0{normalize(topic)}\0{normalize(query)}"))


def _pack_review_row(row: dict[str, Any]) -> str:
    payload = json.dumps(row, ensure_ascii=False).encode("utf-8")
    compressed = zlib.compress(payload, level=3)
    return json.dumps({"_encoding": "zlib-base64-v1",
                       "data": base64.b64encode(compressed).decode("ascii")})


def _unpack_review_row(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("_encoding") == "zlib-base64-v1":
        compressed = base64.b64decode(payload["data"])
        return json.loads(zlib.decompress(compressed))
    return payload


def _competitor_names(rows: list[dict[str, Any]], property_row: dict[str, Any] | None) -> list[str]:
    aliases = (property_row or {}).get("aliases") or []
    name = (property_row or {}).get("name") or ""
    ignored = {normalize(item) for item in ((property_row or {}).get("ignored_names") or [])}
    values = set()
    for row in rows:
        for rank in range(1, 16):
            value = row.get(f"rank{rank}_brandname")
            if not value:
                continue
            if loader.own_brand_match(value, aliases, name) or normalize(value) in ignored:
                continue
            values.add(" ".join(value.split()))
    return sorted(values, key=str.casefold)


def _property_aliases(conn) -> list[dict[str, Any]]:
    return conn.execute("select id, name, aliases from properties order by name").fetchall()


def _map_engine(source: str, engines: list[dict[str, Any]]) -> dict[str, Any]:
    target = ENGINE_ALIASES.get(normalize(source))
    exact = [engine for engine in engines if normalize(engine["name"]) == normalize(source)
             or normalize(engine["rankscale_code"]) == normalize(source)]
    if target:
        exact = [engine for engine in engines if normalize(engine["name"]) == normalize(target)] or exact
    if len(exact) == 1:
        item = exact[0]
        return {"source": source, "id": str(item["id"]), "name": item["name"],
                "rankscale_code": item["rankscale_code"], "status": "MATCHED",
                "method": "canonical alias" if target else "exact normalized name/code"}
    return {"source": source, "id": None, "name": None, "rankscale_code": None,
            "status": "UNMATCHED", "method": None}


def _mapping_snapshot(conn, rows: list[dict[str, Any]], selected_property_id: str | None,
                      previous: dict[str, Any] | None = None) -> dict[str, Any]:
    previous = previous or {}
    properties = _property_aliases(conn)
    selected = next((item for item in properties if selected_property_id and str(item["id"]) == selected_property_id), None)
    refs = sorted({row["brand_reference"] for row in rows if row.get("brand_reference")}, key=str.casefold)
    detected_for_ref = {}
    for ref in refs:
        found = [item for item in properties if loader.own_brand_match(ref, item["aliases"], item["name"])]
        detected_for_ref[ref] = found[0] if len(found) == 1 else None
    detected_ids = {str(item["id"]) for item in detected_for_ref.values() if item}
    detected = next((item for item in properties if str(item["id"]) in detected_ids), None) if len(detected_ids) == 1 else None
    property_id = selected_property_id or (str(detected["id"]) if detected else None)
    current_property = next((item for item in properties if property_id and str(item["id"]) == property_id), None)
    property_status = "UNMATCHED"
    property_method = None
    all_refs_match_selected = bool(refs) and all(
        detected_for_ref[ref] and current_property
        and str(detected_for_ref[ref]["id"]) == str(current_property["id"])
        for ref in refs
    )
    if current_property and detected and str(detected["id"]) == str(current_property["id"]) and all_refs_match_selected:
        property_status, property_method = "MATCHED", "brand_reference alias"
    elif current_property and previous.get("property_confirmed"):
        property_status, property_method = "MATCHED", "human-selected property"
    elif current_property and not detected:
        property_status = "WARNING"
    elif current_property and detected and str(detected["id"]) != str(current_property["id"]):
        property_status = "WARNING"

    prompts = conn.execute(
        """select p.id, p.prompt_text, p.status, i.id as intent_id, i.name as intent
           from prompts p join intents i on i.id = p.intent_id
           where i.property_id = %s and p.status = any(%s)
           order by i.name, p.prompt_text""",
        (property_id, list(ALLOWED_PROMPT_STATUSES)),
    ).fetchall() if property_id else []
    intents = conn.execute("select id, name from intents where property_id = %s order by name",
                           (property_id,)).fetchall() if property_id else []
    prompt_index: dict[str, list[dict[str, Any]]] = {}
    for prompt in prompts:
        prompt_index.setdefault(normalize(prompt["prompt_text"]), []).append(prompt)

    prompt_sources: dict[str, dict[str, Any]] = {}
    for row in rows:
        topic, query = row.get("topic_name") or "", row.get("query") or ""
        key = prompt_key(topic, query)
        entry = prompt_sources.setdefault(key, {"key": key, "source_topic": topic, "source_prompt": query,
                                                "row_count": 0, "id": None, "intent_id": None,
                                                "intent": None, "matched_prompt": None, "status": "UNMATCHED",
                                                "method": None})
        entry["row_count"] += 1
    for entry in prompt_sources.values():
        options = prompt_index.get(normalize(entry["source_prompt"]), [])
        topic_matches = [prompt for prompt in options if normalize(prompt["intent"]) == normalize(entry["source_topic"])]
        matches = topic_matches or options
        resolution_id = (previous.get("prompt_resolutions") or {}).get(entry["key"])
        if resolution_id:
            matches = [prompt for prompt in prompts if str(prompt["id"]) == resolution_id]
        if len(matches) == 1:
            prompt = matches[0]
            entry.update({"id": str(prompt["id"]), "intent_id": str(prompt["intent_id"]),
                          "intent": prompt["intent"], "matched_prompt": prompt["prompt_text"],
                          "status": "MATCHED", "method": "human selection" if resolution_id else "exact normalized prompt"})
        manual_options = options or prompts
        entry["options"] = ([{"id": str(prompt["id"]), "prompt": prompt["prompt_text"],
                      "intent_id": str(prompt["intent_id"]), "intent": prompt["intent"]}
                     for prompt in (matches if resolution_id else manual_options[:300])]
                    if entry["status"] != "MATCHED" else [])

    engine_rows = conn.execute("select id, name, rankscale_code from engines order by name").fetchall()
    engine_sources: dict[str, dict[str, Any]] = {}
    for source in sorted({row["ai_engine"] for row in rows if row.get("ai_engine")}, key=str.casefold):
        entry = _map_engine(source, engine_rows)
        resolution_id = (previous.get("engine_resolutions") or {}).get(source)
        if resolution_id:
            chosen = next((engine for engine in engine_rows if str(engine["id"]) == resolution_id), None)
            if chosen:
                entry.update({"id": str(chosen["id"]), "name": chosen["name"],
                              "rankscale_code": chosen["rankscale_code"], "status": "MATCHED",
                              "method": "human selection"})
        entry["options"] = [{"id": str(item["id"]), "name": item["name"], "rankscale_code": item["rankscale_code"]}
                     for item in engine_rows]
        engine_sources[source] = entry

    competitor_names = _competitor_names(rows, current_property)
    known_competitors = conn.execute("select id, name from competitors order by name").fetchall()
    competitor_index: dict[str, list[dict[str, Any]]] = {}
    for competitor in known_competitors:
        competitor_index.setdefault(normalize(competitor["name"]), []).append(competitor)
    competitor_sources = []
    for source in competitor_names:
        matches = competitor_index.get(normalize(source), [])
        resolution = (previous.get("competitor_resolutions") or {}).get(source)
        if resolution:
            matches = [item for item in known_competitors if str(item["id"]) == resolution]
        item = matches[0] if len(matches) == 1 else None
        competitor_sources.append({"source": source, "id": str(item["id"]) if item else None,
                                   "name": item["name"] if item else None,
                                   "status": "MATCHED" if item else "WARNING",
                                   "method": "human selection" if resolution and item else "exact normalized name" if item else None,
                                   "will_create_observed": item is None})

    return {
        "property": {"source_values": refs, "detected_id": str(detected["id"]) if detected else None,
                     "detected_name": detected["name"] if detected else None,
                     "selected_id": property_id, "selected_name": current_property["name"] if current_property else None,
                     "status": property_status, "method": property_method,
                     "confirmed": bool(previous.get("property_confirmed") or property_status == "MATCHED"),
                     "references": [{"source": ref, "matched_id": str(detected_for_ref[ref]["id"]) if detected_for_ref[ref] else None,
                                     "matched_name": detected_for_ref[ref]["name"] if detected_for_ref[ref] else None,
                                     "status": "MATCHED" if detected_for_ref[ref] and current_property
                                               and str(detected_for_ref[ref]["id"]) == str(current_property["id"])
                                               else "WARNING" if current_property else "UNMATCHED"}
                                    for ref in refs],
                     "options": [{"id": str(item["id"]), "name": item["name"]} for item in properties]},
        "prompts": sorted(prompt_sources.values(), key=lambda item: (item["source_topic"].casefold(), item["source_prompt"].casefold())),
        "engines": list(engine_sources.values()),
        "competitors": competitor_sources,
        "counts": {"prompts": len(prompt_sources), "engines": len(engine_sources),
                   "competitors": len(competitor_sources)},
    }


def _read_review(conn, batch_id: str, for_update: bool = False) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    suffix = " for update" if for_update else ""
    batch = conn.execute(f"select * from import_batches where id = %s{suffix}", (batch_id,)).fetchone()
    if not batch:
        raise ValueError("Import review not found")
    if batch["status"] != "validated":
        raise ValueError(f"Import review is already {batch['status']}")
    report = dict(batch["report"] or {})
    internal = report.get("_review")
    if not internal:
        raise ValueError("This import batch has no pending mapping review")
    rows = [_unpack_review_row(item["row_data"]) for item in conn.execute(
        "select row_data from import_review_rows where batch_id = %s order by row_number", (batch_id,)).fetchall()]
    return {**dict(batch), "report": report, "internal": internal}, rows


def _status(mapping: dict[str, Any], report: dict[str, Any], confirm_unmatched: bool) -> dict[str, Any]:
    unresolved_prompts = [item for item in mapping["prompts"] if item["status"] != "MATCHED"]
    unresolved_engines = [item for item in mapping["engines"] if item["status"] != "MATCHED"]
    unresolved_competitors = [item for item in mapping["competitors"] if item["status"] != "MATCHED"]
    property_ok = mapping["property"]["status"] == "MATCHED" and mapping["property"]["confirmed"]
    invalid_rows = int(report.get("rows_rejected") or 0)
    file_valid = bool(report.get("ok"))
    invalid_acknowledged = bool(report.get("_review", {}).get("invalid_rows_confirmed"))
    ready = (file_valid and property_ok and not unresolved_prompts and not unresolved_engines
             and (not unresolved_competitors or confirm_unmatched)
             and (invalid_rows == 0 or invalid_acknowledged))
    return {"ready": ready, "unresolved_prompts": len(unresolved_prompts),
            "unresolved_engines": len(unresolved_engines),
            "unresolved_property": not property_ok,
            "unmatched_competitors": len(unresolved_competitors),
            "invalid_rows": invalid_rows, "invalid_rows_acknowledged": invalid_acknowledged,
            "blocking_reasons": (["File-level validation failed"] if not file_valid else [])
              + (["Property mapping requires confirmation"] if not property_ok else [])
              + (["Resolve every prompt mapping"] if unresolved_prompts else [])
              + (["Resolve every engine mapping"] if unresolved_engines else [])
              + (["Confirm unmatched competitors that will be added as observed competitors"] if unresolved_competitors and not confirm_unmatched else [])
              + (["Acknowledge the invalid rows excluded from save"] if invalid_rows and not report.get("_review", {}).get("invalid_rows_confirmed") else [])}


def _public_review(report: dict[str, Any], mapping: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    validation = {key: value for key, value in report.items() if key != "_review"}
    state = report.get("_review", {})
    readiness = _status(mapping, report, bool(state.get("competitors_confirmed")))
    row_counts = Counter(row.get("ai_engine") for row in rows)
    return {"batch_id": state.get("batch_id"), "validation": validation, "mapping": mapping,
            "review": {"unmatched_competitors_confirmed": bool(state.get("competitors_confirmed"))},
            "summary": {**(validation.get("summary") or {}),
                        "filename": validation.get("filename"),
                        "rows_valid": validation.get("rows_valid", 0),
                        "rows_rejected": validation.get("rows_rejected", 0),
                        "property": mapping["property"]["selected_name"],
                        "prompts": len(mapping["prompts"]), "engines": len(mapping["engines"]),
                        "competitors": len(mapping["competitors"]),
                        "rows_ready": len(rows), "engine_row_counts": dict(row_counts)},
            "readiness": readiness}


def create_review(raw: bytes, filename: str, selected_property_id: str | None,
                  uploaded_by: str | None = None) -> dict[str, Any]:
    rows, rep = parse_rankscale(raw, filename)
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError("File is larger than 50 MB")
    if not rep.ok:
        return {"status": "invalid", "validation": rep.as_dict(), "readiness": {"ready": False}}
    if selected_property_id:
        selected_property_id = str(uuid.UUID(selected_property_id))
    with connect() as conn:
        mapping = _mapping_snapshot(conn, rows, selected_property_id)
        review_state = {"selected_property_id": mapping["property"]["selected_id"],
                        "property_confirmed": mapping["property"]["confirmed"],
                        "prompt_resolutions": {}, "engine_resolutions": {}, "competitor_resolutions": {},
                        "competitors_confirmed": False, "invalid_rows_confirmed": False,
                        "batch_id": None}
        report = {**rep.as_dict(), "_review": review_state}
        batch = conn.execute(
            """insert into import_batches (filename, uploaded_by, status, rows_in_file, rows_valid,
                                          rows_rejected, report)
               values (%s, %s, 'validated', %s, %s, %s, %s::jsonb) returning id""",
            (filename, uploaded_by, rep.rows_in_file, rep.rows_valid, rep.rows_rejected,
             json.dumps(report, ensure_ascii=False, default=str)),
        ).fetchone()
        batch_id = str(batch["id"])
        review_state["batch_id"] = batch_id
        conn.execute("update import_batches set report = %s::jsonb where id = %s",
                     (json.dumps({**rep.as_dict(), "_review": review_state}, ensure_ascii=False, default=str), batch_id))
        with conn.cursor() as cursor:
            cursor.executemany(
                "insert into import_review_rows (batch_id, row_number, row_data) values (%s, %s, %s::jsonb)",
                ((batch_id, index, _pack_review_row(row))
                 for index, row in enumerate(rows, start=1)),
            )
        conn.commit()
        return _public_review(rep.as_dict(), mapping, rows) | {"batch_id": batch_id, "status": "review"}


def get_review(batch_id: str) -> dict[str, Any]:
    batch_id = str(uuid.UUID(batch_id))
    with connect() as conn:
        batch, rows = _read_review(conn, batch_id)
        state = batch["internal"]
        mapping = _mapping_snapshot(conn, rows, state.get("selected_property_id"), state)
        return _public_review(batch["report"], mapping, rows)


def resolve_review(batch_id: str, property_id: str | None = None,
                   prompt_resolutions: dict[str, str] | None = None,
                   engine_resolutions: dict[str, str] | None = None,
                   competitor_resolutions: dict[str, str] | None = None,
                   confirm_property: bool | None = None,
                   confirm_unmatched_competitors: bool | None = None,
                   accept_invalid_rows: bool | None = None) -> dict[str, Any]:
    batch_id = str(uuid.UUID(batch_id))
    with connect() as conn:
        batch, rows = _read_review(conn, batch_id, for_update=True)
        state = batch["internal"]
        if property_id is not None:
            property_id = str(uuid.UUID(property_id))
            if not conn.execute("select 1 from properties where id = %s", (property_id,)).fetchone():
                raise ValueError("Selected property not found")
            if property_id != state.get("selected_property_id"):
                state["property_confirmed"] = False
            state["selected_property_id"] = property_id
        if confirm_property is not None:
            state["property_confirmed"] = confirm_property
        if confirm_unmatched_competitors is not None:
            state["competitors_confirmed"] = confirm_unmatched_competitors
        if accept_invalid_rows is not None:
            state["invalid_rows_confirmed"] = accept_invalid_rows
        state.setdefault("prompt_resolutions", {}).update(prompt_resolutions or {})
        state.setdefault("engine_resolutions", {}).update(engine_resolutions or {})
        state.setdefault("competitor_resolutions", {}).update(competitor_resolutions or {})
        mapping = _mapping_snapshot(conn, rows, state.get("selected_property_id"), state)
        report = batch["report"]
        report["_review"] = state
        conn.execute("update import_batches set report = %s::jsonb where id = %s",
                     (json.dumps(report, ensure_ascii=False, default=str), batch_id))
        conn.commit()
        result = _public_review(report, mapping, rows)
        result["batch_id"] = batch_id
        result["status"] = "review"
        return result


def _apply_mappings(rows: list[dict[str, Any]], mapping: dict[str, Any]) -> list[dict[str, Any]]:
    prompts = {item["key"]: item for item in mapping["prompts"]}
    engines = {item["source"]: item for item in mapping["engines"]}
    competitors = {normalize(item["source"]): item for item in mapping["competitors"]}
    mapped_rows = []
    for source in rows:
        prompt = prompts[prompt_key(source.get("topic_name") or "", source.get("query") or "")]
        engine = engines[source["ai_engine"]]
        competitor_ids = {}
        for rank in range(1, 16):
            name = source.get(f"rank{rank}_brandname")
            mapped_competitor = competitors.get(normalize(name)) if name else None
            if mapped_competitor and mapped_competitor["status"] == "MATCHED" and mapped_competitor["id"]:
                competitor_ids[name.strip()] = mapped_competitor["id"]
        mapped_rows.append({"property_id": mapping["property"]["selected_id"],
                            "prompt_id": prompt["id"], "engine_id": engine["id"],
                            "competitor_ids": competitor_ids})
    return mapped_rows


def save_review(batch_id: str, uploaded_by: str | None = None) -> dict[str, Any]:
    batch_id = str(uuid.UUID(batch_id))
    with connect() as conn:
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", (loader.LOCK_KEY,))
            batch, stored_rows = _read_review(conn, batch_id, for_update=True)
            report = batch["report"]
            state = batch["internal"]
            mapping = _mapping_snapshot(conn, stored_rows, state.get("selected_property_id"), state)
            readiness = _status(mapping, report, bool(state.get("competitors_confirmed")))
            if int(report.get("rows_rejected") or 0) and not state.get("invalid_rows_confirmed"):
                readiness["ready"] = False
                readiness["blocking_reasons"].append("Acknowledge the invalid rows excluded from save")
            if not readiness["ready"]:
                raise ValueError("Import review is not ready to save: " + "; ".join(dict.fromkeys(readiness["blocking_reasons"])))
            mapped_rows = _apply_mappings(stored_rows, mapping)
            rep_data = {key: value for key, value in report.items() if key != "_review"}
            rep = IngestReport(**{key: rep_data[key] for key in IngestReport.__dataclass_fields__ if key in rep_data})
            loaded = loader.load_rows_in_transaction(conn, stored_rows, rep, uploaded_by,
                                                      mapped_rows=mapped_rows, batch_id=batch_id)
            added = loaded["added"]
            prompt_ids = {item["key"]: item["id"] for item in mapping["prompts"]}
            engine_ids = {item["source"]: item["id"] for item in mapping["engines"]}
            expected_answers = len({(
                prompt_ids[prompt_key(row.get("topic_name") or "", row.get("query") or "")],
                engine_ids[row["ai_engine"]], row["timestamp"]
            ) for row in stored_rows})
            report["mapping"] = mapping
            report["review_confirmed"] = True
            report["save_summary"] = {"rows_processed": len(stored_rows), "invalid_rows_skipped": rep.rows_rejected,
                                       "measurements_inserted": added["measurements"],
                                       "measurements_skipped": max(0, expected_answers - added["measurements"]),
                                       "mentions_inserted": added["mentions"], "evidence_inserted": added["evidence"],
                                       "competitors_added": added["competitors"]}
            conn.execute(
                """update import_batches set status = 'loaded', uploaded_by = coalesce(%s, uploaded_by),
                   measurements_added = %s, mentions_added = %s, evidence_added = %s, report = %s::jsonb
                   where id = %s""",
                (uploaded_by, added["measurements"], added["mentions"], added["evidence"],
                 json.dumps({key: value for key, value in report.items() if key != "_review"}, default=str), batch_id),
            )
            conn.execute("delete from import_review_rows where batch_id = %s", (batch_id,))
            return {"batch_id": batch_id, "added": added, "summary": report["save_summary"],
                    "report": {key: value for key, value in report.items() if key != "_review"}}
