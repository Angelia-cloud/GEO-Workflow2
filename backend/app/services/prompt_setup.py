"""Phase 1 · Prompt — one run per kickoff: brief + transcript → intents → prompts per engine → export.

The whole review state lives in one prompt_generation_runs row (inputs.workflow = 'prompt_setup'):
  inputs      brief, transcript and selected engines
  intent_map  { items: [{id, intent, audience, description, status, revision}], source, notes }
  summary     { prompts: {"engine::item": {text, feedback, status, confidence, revision}}, generated: [...],
                sheet: {...}, status, completed_at }
Completing a run writes the intents and prompts to the intents / prompts tables so Rankscale tracking,
dashboards and the diagnosis agent all use the same prompt set.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import uuid
import re
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from agents.prompt_setup import agent

from ..db import connect

WORKFLOW = "prompt_setup"
# The 16 engines Komosion tracks.
ENGINES = [
    ("ai-overview", "Google AI Overview GUI", "AI Overview GUI", "GUI", "842025311"),
    ("ai-mode", "Google AI Mode GUI", "AI Mode GUI", "GUI", "632582511"),
    ("gemini", "Google Gemini GUI", "Gemini GUI", "GUI", "68562467"),
    ("chatgpt", "ChatGPT GUI", "ChatGPT GUI", "GUI", "1689210951"),
    ("perplexity", "Perplexity GUI", "Perplexity GUI", "GUI", "1853057730"),
    ("grok", "xAI Grok GUI", "xAI Grok GUI", "GUI", "1038756664"),
    ("copilot", "Bing Copilot GUI", "Bing Copilot GUI", "GUI", "1570071987"),
    ("sonar", "Perplexity Sonar API", "Sonar API", "API", "570263255"),
    ("sonar-pro", "Perplexity Sonar-Pro API", "Sonar-Pro API", "API", "316490773"),
    ("sonar-reasoning-pro", "Perplexity Sonar-Reasoning-Pro API", "Sonar-Reasoning-Pro API", "API", "638526534"),
    ("gpt-5-api", "OpenAI GPT-5 API", "OpenAI GPT-5 API", "API", "844212904"),
    ("gemini-3-flash", "Google Gemini 3 Flash API", "Gemini 3 Flash API", "API", "1776075750"),
    ("gemini-3-1-pro", "Google Gemini 3.1 Pro API", "Gemini 3.1 Pro API", "API", "845150401"),
    ("claude-4-5-haiku", "Anthropic Claude 4.5 Haiku API", "Claude 4.5 Haiku API", "API", "436892216"),
    ("deepseek-v3", "DeepSeek V3 API", "DeepSeek V3 API", "API", "1657145304"),
    ("mistral-large", "Mistral Large API", "Mistral Large API", "API", "1128102955"),
]
STATUSES = {"Generated", "Edited", "Approved"}


def engines() -> list[dict[str, Any]]:
    return [{"id": eid, "name": name, "sheetName": tab, "type": kind} for eid, name, tab, kind, _gid in ENGINES]


def _engine_ids() -> set[str]:
    return {e[0] for e in ENGINES}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _key(engine_id: str, item_id: str) -> str:
    return f"{engine_id}::{item_id}"


def _intent_of(item_id: str) -> str:
    """Prompt ids look like "I01.2"; the intent id is the part before the dot."""
    return str(item_id).split(".")[0]


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(text).lower()).split())


def _prompt_items(run: dict[str, Any]) -> list[dict[str, str]]:
    ids = sorted({k.split("::", 1)[1] for k in run["summary"]["prompts"]},
                 key=lambda i: (_intent_of(i), int(i.split(".")[1]) if "." in i and i.split(".")[1].isdigit() else 0))
    return [{"id": i, "intentId": _intent_of(i)} for i in ids]


# ---- persistence ---------------------------------------------------------------------------
def _load(conn, run_id: str) -> dict[str, Any]:
    try:
        uuid.UUID(str(run_id))
    except ValueError as error:
        raise LookupError("Prompt run not found") from error
    row = conn.execute("select id, property_id, model, inputs, intent_map, summary, created_by, created_at "
                       "from prompt_generation_runs where id = %s for update", (run_id,)).fetchone()
    if not row or (row["inputs"] or {}).get("workflow") != WORKFLOW:
        raise LookupError("Prompt run not found")
    row = dict(row)
    row["intent_map"] = row["intent_map"] or {"items": []}
    row["summary"] = row["summary"] or {}
    row["summary"].setdefault("prompts", {})
    row["summary"].setdefault("generated", [])
    return row


def _save(conn, run: dict[str, Any], model: str | None = None) -> None:
    conn.execute("update prompt_generation_runs set intent_map = %s, summary = %s, model = coalesce(%s, model) where id = %s",
                 (Jsonb(run["intent_map"]), Jsonb(run["summary"]), model, run["id"]))


def _brief(conn, run: dict[str, Any]) -> dict[str, Any]:
    inputs = run["inputs"]
    prop = conn.execute("select name, location, website_url, aliases from properties where id = %s",
                        (run["property_id"],)).fetchone()
    brief = {**inputs.get("brief", {}), "transcript": inputs.get("transcript", ""),
             "location": prop["location"] if prop else None, "website": prop["website_url"] if prop else None,
             "aliases": (prop["aliases"] if prop else []) or [], "analysis": run["summary"].get("analysis")}
    brief["property"] = brief.get("property") or (prop["name"] if prop else "")
    try:  # verified facts, when the property has a brief file
        from agents.prompt_generation.pipeline import load_brief
        brief["facts"] = [f["fact"] for f in load_brief(brief["property"]).get("facts", [])][:12]
    except (FileNotFoundError, KeyError, TypeError):
        pass
    return brief


def _public(run: dict[str, Any]) -> dict[str, Any]:
    inputs = run["inputs"]
    summary = run["summary"]
    status = summary.get("status", "draft")
    default_step = {"prompt_review": 4, "complete": 5}.get(
        status, 3 if status == "intent_review" else 2
    )
    return {"id": str(run["id"]), "clientId": str(run["property_id"]), "brief": inputs.get("brief", {}),
            "transcript": inputs.get("transcript", ""), "transcriptName": inputs.get("transcriptName"),
            "items": run["intent_map"].get("items", []),
            "intentSource": run["intent_map"].get("source"), "prompts": summary.get("prompts", {}),
            "generated": summary.get("generated", []), "engineIds": summary.get("engineIds", summary.get("generated", [])),
            "step": summary.get("step", default_step), "status": status,
            "sheet": summary.get("sheet"), "analysis": summary.get("analysis"),
            "promptItems": _prompt_items(run), "createdBy": run["created_by"],
            "createdAt": run["created_at"].isoformat() if run.get("created_at") else None}


# ---- workflow ------------------------------------------------------------------------------
def start_run(data: dict[str, Any]) -> dict[str, Any]:
    client_id = str(data.get("clientId") or "")
    transcript = str(data.get("transcript") or "").strip()
    if not transcript:
        raise ValueError("Add the kickoff transcript before continuing.")
    if len(transcript.split()) < 30:
        raise ValueError("The transcript is too short to analyse. Add at least 30 words of kickoff notes.")
    if len(transcript) > 100000:
        raise ValueError("Shorten the transcript to 100,000 characters or fewer.")
    brief = {"client": str(data.get("client") or ""), "property": str(data.get("property") or ""),
             "targetAudience": str(data.get("targetAudience") or ""), "goals": str(data.get("goals") or "")}
    if not all(brief[k].strip() for k in ("property", "targetAudience", "goals")):
        raise ValueError("Complete the client, property, target audience and goals first.")
    with connect() as conn:
        try:
            uuid.UUID(client_id)
        except ValueError as error:
            raise LookupError("Client not found") from error
        if not conn.execute("select 1 from properties where id = %s", (client_id,)).fetchone():
            raise LookupError("Client not found")
        row = conn.execute(
            """insert into prompt_generation_runs (property_id, model, inputs, intent_map, summary, created_by)
               values (%s, 'prompt_setup', %s, %s, %s, %s) returning id""",
            (client_id, Jsonb({"workflow": WORKFLOW, "brief": brief, "transcript": transcript,
                               "transcriptName": data.get("transcriptName")}),
             Jsonb({"items": []}), Jsonb({"prompts": {}, "generated": [], "engineIds": [], "step": 2, "status": "transcript"}),
             data.get("createdBy")),
        ).fetchone()
        conn.commit()
    return get_run(str(row["id"]))


def get_run(run_id: str) -> dict[str, Any]:
    with connect() as conn:
        return _public(_load(conn, run_id))


def latest_run_for_client(client_id: str) -> dict[str, Any]:
    with connect() as conn:
        try:
            uuid.UUID(str(client_id))
        except ValueError as error:
            raise LookupError("Prompt run not found") from error
        row = conn.execute(
            "select id from prompt_generation_runs where property_id = %s and inputs->>'workflow' = %s "
            "order by created_at desc limit 1", (client_id, WORKFLOW)).fetchone()
    if not row:
        raise LookupError("Prompt run not found")
    return get_run(str(row["id"]))


def save_run_state(run_id: str, data: dict[str, Any]) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        if data.get("engineIds") is not None:
            engine_ids = list(dict.fromkeys(data["engineIds"]))
            unknown = set(engine_ids) - _engine_ids()
            if unknown:
                raise ValueError("Select valid AI engines before continuing.")
            run["summary"]["engineIds"] = engine_ids
        if data.get("step") is not None:
            step = data["step"]
            if isinstance(step, bool) or step not in range(1, 6):
                raise ValueError("The saved workflow step is invalid.")
            run["summary"]["step"] = step
        _save(conn, run)
        conn.commit()
        return _public(run)


def generate_intents(run_id: str, llm=None) -> dict[str, Any]:
    """Client Analysis Agent, then Intent Agent. Nothing reaches the intents/prompts tables until approval."""
    with connect() as conn:
        run = _load(conn, run_id)
        brief = _brief(conn, run)
    analysis = agent.analyse_client(brief, llm)
    result = agent.extract_intents({**brief, "analysis": analysis}, llm)
    items = [{"id": f"I{n:02d}", "promptId": f"P{n:02d}", "intent": item["intent"], "audience": item["audience"],
              "category": item.get("category", ""), "description": item.get("description", ""),
              "sourceQuotes": item.get("sourceQuotes", []), "status": "Generated", "revision": 0}
             for n, item in enumerate(result["items"], start=1)]
    with connect() as conn:
        run = _load(conn, run_id)
        run["intent_map"] = {"items": items, "source": result["source"], "notes": result.get("notes", ""),
                             "generated_at": _now()}
        run["summary"].update(prompts={}, generated=[], status="intent_review", step=3, analysis=analysis)
        run["summary"].pop("exports", None)
        _save(conn, run, result.get("model"))
        conn.commit()
    return {"items": items, "source": result["source"], "notes": result.get("notes", ""), "analysis": analysis}


def update_intents(run_id: str, updates: list[dict[str, Any]], reviewer: str | None = None) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        items = {item["id"]: item for item in run["intent_map"]["items"]}
        for update in updates:
            item = items.get(str(update.get("id")))
            if not item:
                raise LookupError("Intent not found in this run")
            changed = False
            for field in ("intent", "audience"):
                value = update.get(field)
                if isinstance(value, str) and value.strip() and value.strip() != item[field]:
                    item[field] = value.strip()[:3000]
                    changed = True
            if changed:
                item["revision"] = item.get("revision", 0) + 1
                for key, prompt in run["summary"]["prompts"].items():  # linked prompts need a fresh look
                    if _intent_of(key.split("::", 1)[1]) == item["id"]:
                        prompt.update(status="Edited" if prompt.get("revision") else "Generated", confidence=None)
            status = update.get("status")
            if status in STATUSES:
                if status == "Approved" and not item.get("sourceQuotes"):
                    raise ValueError(f"\"{item['intent']}\" has no supporting transcript evidence, so it cannot be approved.")
                item["status"] = status
                if status == "Approved":
                    item["reviewer"], item["reviewedAt"] = reviewer, _now()
            elif changed:
                item["status"] = "Edited"
        _save(conn, run)
        conn.commit()
        return _public(run)


def add_intent(run_id: str, data: dict[str, Any], reviewer: str | None = None) -> dict[str, Any]:
    """A reviewer-added intent must quote the transcript, like every generated intent."""
    intent, audience = str(data.get("intent") or "").strip(), str(data.get("audience") or "").strip()
    evidence = " ".join(str(data.get("evidence") or "").split())
    if not intent or not audience:
        raise ValueError("Add both the intent and the audience.")
    with connect() as conn:
        run = _load(conn, run_id)
        if len(_norm(evidence)) < 8 or _norm(evidence) not in _norm(run["inputs"].get("transcript", "")):
            raise ValueError("Paste a quote from the transcript that supports this intent. It must appear in the transcript exactly.")
        items = run["intent_map"]["items"]
        if any(agent._stem_key(i["intent"]) == agent._stem_key(intent) for i in items):
            raise ValueError("This intent already exists.")
        number = max([int(i["id"][1:]) for i in items if str(i["id"])[1:].isdigit()] + [0]) + 1
        item = {"id": f"I{number:02d}", "promptId": f"P{number:02d}", "intent": intent[:3000], "audience": audience[:3000],
                "category": str(data.get("category") or "")[:100], "description": str(data.get("description") or "")[:1000],
                "sourceQuotes": [evidence[:400]], "manual": True, "status": "Generated", "revision": 0}
        items.append(item)
        _save(conn, run)
        conn.commit()
    return item


def delete_intent(run_id: str, item_id: str) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        items = run["intent_map"]["items"]
        if not any(i["id"] == item_id for i in items):
            raise LookupError("Intent not found in this run")
        run["intent_map"]["items"] = [i for i in items if i["id"] != item_id]
        run["summary"]["prompts"] = {k: v for k, v in run["summary"]["prompts"].items()
                                     if _intent_of(k.split("::", 1)[1]) != item_id}
        _save(conn, run)
        conn.commit()
    return {"ok": True}


def generate_prompts(run_id: str, engine_ids: list[str], intents: list[dict[str, Any]] | None = None, llm=None) -> dict[str, Any]:
    """2–3 prompts per APPROVED intent, copied to every selected engine."""
    engine_ids = [e for e in engine_ids if e in _engine_ids()]
    if not engine_ids:
        raise ValueError("Select at least one engine before generating prompts.")
    with connect() as conn:
        run = _load(conn, run_id)
        if intents:  # the reviewer's latest wording and approvals win
            current = {item["id"]: item for item in run["intent_map"]["items"]}
            for intent in intents:
                item = current.get(str(intent.get("id")))
                if item:
                    item["intent"] = str(intent.get("intent") or item["intent"])
                    item["audience"] = str(intent.get("audience") or item["audience"])
                    if intent.get("status") in STATUSES:
                        item["status"] = intent["status"]
        items = [i for i in run["intent_map"]["items"] if i.get("status") == "Approved"]
        if not items:
            raise ValueError("Approve at least one intent before generating prompts.")
        _save(conn, run)
        conn.commit()
        brief = _brief(conn, run)
        existing = [r["prompt_text"] for r in conn.execute(
            "select p.prompt_text from prompts p join intents i on i.id = p.intent_id where i.property_id = %s and p.status <> 'rejected'",
            (run["property_id"],)).fetchall()]
    result = _reuse_prompts(run, items)  # the same questions are tracked on every engine
    if result is None:
        result = agent.write_prompts(brief, items, existing, llm)
    rows = []
    with connect() as conn:
        run = _load(conn, run_id)
        approved_ids = {i["id"] for i in items}
        run["summary"]["prompts"] = {k: v for k, v in run["summary"]["prompts"].items()
                                     if k.split("::")[0] not in engine_ids or _intent_of(k.split("::", 1)[1]) not in approved_ids}
        for engine_id in engine_ids:
            for prompt_id, prompt in result["prompts"].items():
                run["summary"]["prompts"][_key(engine_id, prompt_id)] = {
                    "text": prompt["text"], "feedback": "", "status": "Generated", "confidence": prompt["confidence"], "revision": 0}
                rows.append({"engineId": engine_id, "itemId": prompt_id, "intentId": prompt["intentId"],
                             "text": prompt["text"], "confidence": prompt["confidence"]})
        run["summary"]["generated"] = sorted(set(run["summary"]["generated"]) | set(engine_ids))
        run["summary"].update(status="prompt_review", step=4)
        _save(conn, run)
        conn.commit()
        public = _public(run)
    return {"prompts": rows, "promptItems": public["promptItems"], "source": result["source"],
            "message": "Prompts generated by the Prompt Generation agent and scored by the QA agent. Edit, approve or delete them."}


def _reuse_prompts(run: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """When another engine already has prompts for exactly these approved intents (unchanged since),
    copy them instead of asking the agent again, so every engine tracks the same questions."""
    done = run["summary"].get("generated") or []
    if not done:
        return None
    source = done[0]
    copied: dict[str, dict[str, Any]] = {}
    for key, prompt in run["summary"]["prompts"].items():
        engine_id, prompt_id = key.split("::", 1)
        if engine_id == source and prompt.get("text"):
            copied[prompt_id] = {"intentId": _intent_of(prompt_id), "text": prompt["text"], "confidence": prompt.get("confidence")}
    wanted = {i["id"] for i in items}
    have = {p["intentId"] for p in copied.values()}
    stale = any(p.get("confidence") is None and p.get("status") != "Approved"
                for k, p in run["summary"]["prompts"].items() if k.startswith(f"{source}::"))
    if not copied or have != wanted or stale:
        return None  # intents changed, or the first engine's prompts were edited: write fresh ones
    return {"prompts": copied, "source": "copied"}


def update_prompts(run_id: str, updates: list[dict[str, Any]], reviewer: str | None = None) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        prompts = run["summary"]["prompts"]
        for update in updates:
            key = _key(str(update.get("engineId")), str(update.get("itemId")))
            if key not in prompts:
                raise LookupError("Prompt not found in this run")
            prompt = prompts[key]
            status = update.get("status")
            if isinstance(update.get("text"), str) and status == "Approved" and not update["text"].strip():
                raise ValueError("Add prompt wording before approving it.")
            if isinstance(update.get("text"), str) and update["text"].strip():
                if update["text"].strip() != prompt["text"]:
                    prompt["revision"] = prompt.get("revision", 0) + 1
                prompt["text"] = update["text"].strip()[:3000]
                prompt["confidence"] = update.get("confidence") if isinstance(update.get("confidence"), (int, float)) else None
            if isinstance(update.get("feedback"), str):
                prompt["feedback"] = update["feedback"].strip()[:1000]
                if prompt["feedback"]:
                    run["summary"].setdefault("feedback_log", []).append(
                        {"key": key, "feedback": prompt["feedback"], "reviewer": reviewer, "at": _now()})
            if status in STATUSES:
                if status == "Approved" and not str(prompt.get("text") or "").strip():
                    raise ValueError("Add prompt wording before approving it.")
                if status == "Approved":
                    engine_id = str(update.get("engineId"))
                    duplicate = any(
                        other_key != key
                        and other_key.startswith(f"{engine_id}::")
                        and _norm(other.get("text", "")) == _norm(prompt.get("text", ""))
                        for other_key, other in prompts.items()
                    )
                    if duplicate:
                        raise ValueError("This prompt duplicates another prompt for the selected engine. Edit it before approving.")
                prompt["status"] = status
                if status == "Approved":
                    prompt["reviewer"], prompt["reviewedAt"] = reviewer, _now()
        _save(conn, run)
        conn.commit()
        return {"ok": True}


def delete_prompt(run_id: str, engine_id: str, item_id: str) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        if run["summary"]["prompts"].pop(_key(engine_id, item_id), None) is None:
            raise LookupError("Prompt not found in this run")
        _save(conn, run)
        conn.commit()
    return {"ok": True}


def regenerate_prompt(run_id: str, data: dict[str, Any], llm=None) -> dict[str, Any]:
    feedback = str(data.get("feedback") or "").strip()
    text = str(data.get("text") or "").strip()
    if not feedback:
        raise ValueError("Add feedback before regenerating.")
    if not text:
        raise ValueError("Add prompt wording first.")
    with connect() as conn:
        run = _load(conn, run_id)
        brief = _brief(conn, run)
        item = next((i for i in run["intent_map"]["items"] if i["id"] == _intent_of(data.get("itemId") or "")), None)
    if not item:
        raise LookupError("Intent not found in this run")
    intent = {**item, **{k: v for k, v in (data.get("intent") or {}).items() if isinstance(v, str) and v}}
    result = agent.rewrite_prompt(brief, intent, text, feedback, llm)
    with connect() as conn:
        run = _load(conn, run_id)
        run["summary"].setdefault("feedback_log", []).append(
            {"key": _key(str(data.get("engineId")), str(data.get("itemId"))), "feedback": feedback,
             "regenerated": result["text"], "at": _now()})
        _save(conn, run)
        conn.commit()
    return result


# ---- export --------------------------------------------------------------------------------
def _rows_for_export(run: dict[str, Any], engine_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Approved prompts of approved intents, with intent name and ids."""
    names = {e["id"]: e["name"] for e in engines()}
    approved = {i["id"]: i for i in run["intent_map"]["items"] if i.get("status") == "Approved"}
    selected = engine_ids or run["summary"].get("generated", [])
    out = []
    for engine_id in selected:
        for variant in _prompt_items(run):
            item, prompt = approved.get(variant["intentId"]), run["summary"]["prompts"].get(_key(engine_id, variant["id"]))
            if item and prompt and prompt.get("text") and prompt.get("status") == "Approved":
                out.append({"engineId": engine_id, "engine": names.get(engine_id, engine_id), "itemId": variant["id"],
                            "intentId": item["id"], "promptId": f"P{variant['id'][1:]}", "intent": item["intent"],
                            "audience": item["audience"], "prompt": prompt["text"], "status": "Approved",
                            "confidence": prompt.get("confidence"), "evidence": " | ".join(item.get("sourceQuotes", []))})
    return out


def _validate_coverage(run: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    approved = [i for i in run["intent_map"]["items"] if i.get("status") == "Approved"]
    if not approved:
        raise ValueError("Approve at least one intent first.")
    covered = {row["intentId"] for row in rows}
    missing = [i["intent"] for i in approved if i["id"] not in covered]
    if missing:
        raise ValueError("Every approved intent needs at least one approved prompt. Missing: " + ", ".join(missing))


def approved_prompts(run_id: str, engine_ids: list[str] | None = None) -> dict[str, Any]:
    """Approved prompts exactly as they are exported, plus the saved export status."""
    with connect() as conn:
        run = _load(conn, run_id)
    rows = _rows_for_export(run, engine_ids)
    return {"rows": [{k: r[k] for k in ("promptId", "intentId", "intent", "prompt", "engineId", "engine", "audience", "confidence", "status")}
                     for r in rows],
            "sheet": run["summary"].get("sheet")}


def export_csv(run_id: str, engine_id: str | None = None) -> str:
    """Rankscale import file: one search term per row, topic = intent."""
    with connect() as conn:
        run = _load(conn, run_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["search_term", "topic", "tags", "engine", "audience", "status", "intent_id", "prompt_id"])
    for row in _rows_for_export(run, [engine_id] if engine_id else None):
        writer.writerow([row["prompt"], row["intent"], "komosion,prompt_setup", row["engine"], row["audience"], row["status"], row["intentId"], row["promptId"]])
    return buf.getvalue()


def prepare_sheet(run_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Export the approved prompts to a Google spreadsheet (new or existing), once per unchanged content."""
    from . import google_sheets
    with connect() as conn:
        run = _load(conn, run_id)
    rows = _rows_for_export(run, data.get("engineIds"))
    if not rows:
        raise ValueError("Approve at least one prompt before exporting.")
    _validate_coverage(run, rows)
    brief = run["inputs"].get("brief", {})
    spreadsheet_id = str(data.get("spreadsheetId") or "").strip()
    created = False
    if not spreadsheet_id:
        # Reuse this run's spreadsheet so reopening the step does not create a new one each time.
        spreadsheet_id = str((run["summary"].get("sheet") or {}).get("spreadsheetId") or "")
        if spreadsheet_id and spreadsheet_id not in {s["id"] for s in google_sheets.list_spreadsheets()}:
            spreadsheet_id = ""  # created by another account: no longer reachable
    if not spreadsheet_id:
        title = str(data.get("title") or "").strip() or f"Komosion GEO — {brief.get('property') or 'Prompts'}"
        try:
            spreadsheet_id = google_sheets.create_spreadsheet(title)["id"]
            created = True
        except google_sheets.SheetsError:
            # The service account may not be allowed to create files; use a spreadsheet shared with it instead.
            shared = google_sheets.list_spreadsheets()
            if not shared:
                raise
            spreadsheet_id = shared[0]["id"]
    fingerprint = hashlib.sha256(json.dumps([[r["promptId"], r["intent"], r["prompt"]] for r in rows], sort_keys=True).encode()).hexdigest()
    exports = run["summary"].get("exports", {})
    previous = exports.get(spreadsheet_id)
    if previous and previous.get("fingerprint") == fingerprint:
        return {**previous["result"], "alreadyExported": True, "created": False}
    result = google_sheets.write_prompts(spreadsheet_id, brief, rows)
    result.update(rows=len(rows), created=created, alreadyExported=False, exportedAt=_now())
    with connect() as conn:
        run = _load(conn, run_id)
        run["summary"].setdefault("exports", {})[spreadsheet_id] = {"fingerprint": fingerprint, "result": result}
        run["summary"]["sheet"] = result
        _save(conn, run)
        conn.commit()
    return result


def complete_run(run_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Save the reviewed intents and prompts into the tracking tables and close the run."""
    reviewer = str(data.get("reviewer") or "").strip()
    if not reviewer:
        raise ValueError("Sign in before saving the prompts.")
    with connect() as conn:
        run = _load(conn, run_id)
        if data.get("intents"):
            update_payload = [{"id": i.get("id"), "intent": i.get("intent"), "audience": i.get("audience"), "status": i.get("status")}
                              for i in data["intents"] if i.get("id")]
        else:
            update_payload = []
    if update_payload:
        update_intents(run_id, update_payload, reviewer)
    if data.get("prompts"):
        update_prompts(run_id, [{"engineId": p.get("engineId"), "itemId": p.get("itemId"), "text": p.get("text"),
                                 "confidence": p.get("confidence"), "status": p.get("status")} for p in data["prompts"]
                                if p.get("engineId") and p.get("itemId")], reviewer)
    with connect() as conn:
        run = _load(conn, run_id)
        property_id = str(run["property_id"])
        rows = _rows_for_export(run, data.get("engineIds"))
        _validate_coverage(run, rows)
        approved_items = [i for i in run["intent_map"]["items"] if i.get("status") == "Approved"]
        intent_ids: dict[str, Any] = {}
        with conn.cursor() as cur:  # all intents in one round trip, then all prompts in one more
            cur.executemany(
                """insert into intents (property_id, name, description) values (%s, %s, %s)
                   on conflict (property_id, name) do update set description = coalesce(intents.description, excluded.description)
                   returning id, name""",
                [(property_id, item["intent"][:300], item.get("description") or item["audience"]) for item in approved_items],
                returning=True)
            while True:
                row = cur.fetchone()
                if row:
                    intent_ids[row["name"]] = row["id"]
                if not cur.nextset():
                    break
        prompt_rows = []
        for item in approved_items:
            texts = {}
            for row in rows:
                if row["intentId"] == item["id"]:
                    texts.setdefault(_norm(row["prompt"]), row)
            for row in texts.values():
                score = row["confidence"] / 100 if isinstance(row["confidence"], (int, float)) else None
                prompt_rows.append(
                    (intent_ids[item["intent"][:300]], row["prompt"], "approved" if row["status"] == "Approved" else "candidate",
                     run["id"], "branded" if "brand" in item["intent"].lower() else "unbranded_discovery", item["audience"][:300],
                     f"Phase 1 prompt setup · {row['engine']}", round(score, 2) if score is not None else None))
        if prompt_rows:
            conn.cursor().executemany(
                """insert into prompts (intent_id, prompt_text, source, status, generation_run_id, prompt_type, persona,
                                        rationale, quality_score, is_active)
                   values (%s, %s, 'prompt_agent', %s, %s, %s, %s, %s, %s, false)
                   on conflict (intent_id, prompt_text) do update set
                     persona = excluded.persona, quality_score = coalesce(excluded.quality_score, prompts.quality_score),
                     status = case when prompts.status in ('tracked', 'exported') then prompts.status else excluded.status end""",
                prompt_rows)
        saved_prompts = len(prompt_rows)
        run["summary"].update(status="complete", step=5, completed_at=_now(), completed_by=reviewer)
        _save(conn, run)
        conn.commit()
    sheet = run["summary"].get("sheet") or {}
    return {"ok": True, "runId": run_id, "intents": sum(1 for i in run["intent_map"]["items"] if i.get("status") == "Approved"),
            "prompts": saved_prompts, "sheetUrl": sheet.get("sheetUrl"), "exportUrl": f"/api/prompt-setup/runs/{run_id}/export.csv"}
