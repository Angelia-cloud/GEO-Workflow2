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
import io
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from agents.prompt_setup import agent

from ..db import connect

WORKFLOW = "prompt_setup"
DEFAULT_SHEET = "https://docs.google.com/spreadsheets/d/1EhRUo3rB9yT4x0Vu9sdQWGyUSa2-7VuTQuZqC4u7-AM/edit"
# The 16 engines Komosion tracks. gid = the engine's tab in the default Komosion workbook.
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


def sheet_url() -> str:
    return os.environ.get("GEO_PROMPT_SHEET_URL") or DEFAULT_SHEET


def engines() -> list[dict[str, Any]]:
    base = sheet_url()
    default = base == DEFAULT_SHEET
    return [{"id": eid, "name": name, "sheetName": tab, "type": kind,
             "sheetUrl": f"{base}#gid={gid}" if default else base} for eid, name, tab, kind, gid in ENGINES]


def _engine_ids() -> set[str]:
    return {e[0] for e in ENGINES}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _key(engine_id: str, item_id: str) -> str:
    return f"{engine_id}::{item_id}"


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
             "aliases": (prop["aliases"] if prop else []) or []}
    brief["property"] = brief.get("property") or (prop["name"] if prop else "")
    try:  # verified facts, when the property has a brief file
        from agents.prompt_generation.pipeline import load_brief
        brief["facts"] = [f["fact"] for f in load_brief(brief["property"]).get("facts", [])][:12]
    except (FileNotFoundError, KeyError, TypeError):
        pass
    return brief


def _public(run: dict[str, Any]) -> dict[str, Any]:
    inputs = run["inputs"]
    return {"id": str(run["id"]), "clientId": str(run["property_id"]), "brief": inputs.get("brief", {}),
            "transcriptName": inputs.get("transcriptName"), "items": run["intent_map"].get("items", []),
            "intentSource": run["intent_map"].get("source"), "prompts": run["summary"].get("prompts", {}),
            "generated": run["summary"].get("generated", []), "status": run["summary"].get("status", "draft"),
            "sheet": run["summary"].get("sheet"), "createdBy": run["created_by"],
            "createdAt": run["created_at"].isoformat() if run.get("created_at") else None}


# ---- workflow ------------------------------------------------------------------------------
def start_run(data: dict[str, Any]) -> dict[str, Any]:
    client_id = str(data.get("clientId") or "")
    transcript = str(data.get("transcript") or "").strip()
    if not transcript:
        raise ValueError("Add the kickoff transcript before continuing.")
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
             Jsonb({"items": []}), Jsonb({"prompts": {}, "generated": [], "status": "transcript"}),
             data.get("createdBy")),
        ).fetchone()
        conn.commit()
    return get_run(str(row["id"]))


def get_run(run_id: str) -> dict[str, Any]:
    with connect() as conn:
        return _public(_load(conn, run_id))


def generate_intents(run_id: str, llm=None) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        brief = _brief(conn, run)
    result = agent.extract_intents(brief, llm)
    items = [{"id": f"I{n:02d}", "promptId": f"P{n:02d}", "intent": item["intent"], "audience": item["audience"],
              "description": item.get("description", ""), "sourceQuotes": item.get("sourceQuotes", []),
              "template": item.get("template"), "status": "Generated", "revision": 0}
             for n, item in enumerate(result["items"], start=1)]
    with connect() as conn:
        run = _load(conn, run_id)
        run["intent_map"] = {"items": items, "source": result["source"], "notes": result.get("notes", ""),
                             "generated_at": _now()}
        run["summary"].update(prompts={}, generated=[], status="intent_review")
        _save(conn, run, result.get("model"))
        conn.commit()
    return {"items": [{k: v for k, v in item.items() if k != "template"} for item in items],
            "source": result["source"], "notes": result.get("notes", "")}


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
                    if key.endswith(f"::{item['id']}"):
                        prompt.update(status="Edited" if prompt.get("revision") else "Generated", confidence=None)
            status = update.get("status")
            if status in STATUSES:
                item["status"] = status
                if status == "Approved":
                    item["reviewer"], item["reviewedAt"] = reviewer, _now()
            elif changed:
                item["status"] = "Edited"
        _save(conn, run)
        conn.commit()
        return _public(run)


def generate_prompts(run_id: str, engine_ids: list[str], intents: list[dict[str, Any]] | None = None, llm=None) -> dict[str, Any]:
    engine_ids = [e for e in engine_ids if e in _engine_ids()]
    if not engine_ids:
        raise ValueError("Select at least one engine before generating prompts.")
    with connect() as conn:
        run = _load(conn, run_id)
        if intents:  # the reviewer's latest wording wins
            current = {item["id"]: item for item in run["intent_map"]["items"]}
            for intent in intents:
                item = current.get(str(intent.get("id")))
                if item:
                    item["intent"] = str(intent.get("intent") or item["intent"])
                    item["audience"] = str(intent.get("audience") or item["audience"])
        items = run["intent_map"]["items"]
        if not items:
            raise ValueError("Generate and review the intents first.")
        brief = _brief(conn, run)
        existing = [r["prompt_text"] for r in conn.execute(
            "select p.prompt_text from prompts p join intents i on i.id = p.intent_id where i.property_id = %s and p.status <> 'rejected'",
            (run["property_id"],)).fetchall()]
    result = agent.write_prompts(brief, items, existing, llm)
    rows = []
    with connect() as conn:
        run = _load(conn, run_id)
        for engine_id in engine_ids:
            for item in run["intent_map"]["items"]:
                prompt = result["prompts"].get(item["id"]) or {"text": "", "confidence": None}
                run["summary"]["prompts"][_key(engine_id, item["id"])] = {
                    "text": prompt["text"], "feedback": "", "status": "Generated", "confidence": prompt["confidence"], "revision": 0}
                rows.append({"engineId": engine_id, "itemId": item["id"], "text": prompt["text"], "confidence": prompt["confidence"]})
        run["summary"]["generated"] = sorted(set(run["summary"]["generated"]) | set(engine_ids))
        run["summary"]["status"] = "prompt_review"
        run["summary"]["prompt_source"] = result["source"]
        _save(conn, run)
        conn.commit()
    message = ("Prompts generated by the Prompt Writer and scored by the QA agent. Edit or export them."
               if result["source"] == "ai" else
               "Rule-based prompts generated (no LLM key configured). Edit them before export.")
    return {"prompts": rows, "source": result["source"], "message": message}


def update_prompts(run_id: str, updates: list[dict[str, Any]], reviewer: str | None = None) -> dict[str, Any]:
    with connect() as conn:
        run = _load(conn, run_id)
        prompts = run["summary"]["prompts"]
        for update in updates:
            key = _key(str(update.get("engineId")), str(update.get("itemId")))
            if key not in prompts:
                raise LookupError("Prompt not found in this run")
            prompt = prompts[key]
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
            status = update.get("status")
            if status in STATUSES:
                prompt["status"] = status
                if status == "Approved":
                    prompt["reviewer"], prompt["reviewedAt"] = reviewer, _now()
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
        item = next((i for i in run["intent_map"]["items"] if i["id"] == data.get("itemId")), None)
    if not item:
        raise LookupError("Intent not found in this run")
    intent = {**item, **{k: v for k, v in (data.get("intent") or {}).items() if isinstance(v, str) and v}}
    result = agent.rewrite_prompt(brief, intent, text, feedback, llm)
    with connect() as conn:
        run = _load(conn, run_id)
        run["summary"].setdefault("feedback_log", []).append(
            {"key": _key(str(data.get("engineId")), item["id"]), "feedback": feedback, "regenerated": result["text"], "at": _now()})
        _save(conn, run)
        conn.commit()
    return result


# ---- export --------------------------------------------------------------------------------
def _rows_for_export(run: dict[str, Any], engine_ids: list[str] | None = None) -> list[dict[str, Any]]:
    names = {e["id"]: e["name"] for e in engines()}
    selected = engine_ids or run["summary"].get("generated", [])
    out = []
    for engine_id in selected:
        for item in run["intent_map"]["items"]:
            prompt = run["summary"]["prompts"].get(_key(engine_id, item["id"]))
            if prompt and prompt.get("text"):
                out.append({"engineId": engine_id, "engine": names.get(engine_id, engine_id), "itemId": item["id"],
                            "intent": item["intent"], "audience": item["audience"], "prompt": prompt["text"],
                            "status": prompt.get("status", "Generated"), "confidence": prompt.get("confidence")})
    return out


def export_csv(run_id: str, engine_id: str | None = None) -> str:
    """Rankscale import file: one search term per row, topic = intent."""
    with connect() as conn:
        run = _load(conn, run_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["search_term", "topic", "tags", "engine", "audience", "status"])
    for row in _rows_for_export(run, [engine_id] if engine_id else None):
        writer.writerow([row["prompt"], row["intent"], "komosion,prompt_setup", row["engine"], row["audience"], row["status"]])
    return buf.getvalue()


def prepare_sheet(run_id: str, engine_ids: list[str] | None = None) -> dict[str, Any]:
    """Write the reviewed prompts to Google Sheets when a service account is configured; otherwise
    return the team's workbook link."""
    with connect() as conn:
        run = _load(conn, run_id)
    rows = _rows_for_export(run, engine_ids)
    links = {e["id"]: e["sheetUrl"] for e in engines()}
    result = {"sheetUrl": sheet_url(), "engines": links, "synced": False,
              "title": "Komosion GEO — Engine Intent & Prompt Review"}
    try:
        from . import google_sheets
        synced = google_sheets.write_prompt_tabs(run["inputs"].get("brief", {}), rows)
    except Exception as error:  # noqa: BLE001 — the workbook link still works without the sync
        synced = {"error": str(error)}
    if synced and synced.get("sheetUrl"):
        result.update(synced, synced=True)
    elif synced and synced.get("error"):
        result["syncError"] = synced["error"]
    with connect() as conn:
        run = _load(conn, run_id)
        run["summary"]["sheet"] = {k: v for k, v in result.items() if k != "engines"}
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
            update_payload = [{"id": i.get("id"), "intent": i.get("intent"), "audience": i.get("audience")} for i in data["intents"]]
        else:
            update_payload = []
    if update_payload:
        update_intents(run_id, update_payload, reviewer)
    if data.get("prompts"):
        update_prompts(run_id, [{"engineId": p.get("engineId"), "itemId": p.get("itemId"), "text": p.get("text"),
                                 "confidence": p.get("confidence")} for p in data["prompts"]
                                if p.get("engineId") and p.get("itemId")], reviewer)
    with connect() as conn:
        run = _load(conn, run_id)
        property_id = str(run["property_id"])
        rows = _rows_for_export(run, data.get("engineIds"))
        saved_prompts = 0
        for item in run["intent_map"]["items"]:
            intent_row = conn.execute(
                """insert into intents (property_id, name, description) values (%s, %s, %s)
                   on conflict (property_id, name) do update set description = coalesce(intents.description, excluded.description)
                   returning id""", (property_id, item["intent"][:300], item.get("description") or item["audience"])).fetchone()
            texts = {}
            for row in rows:
                if row["itemId"] == item["id"]:
                    texts.setdefault(row["prompt"], row)
            for text, row in texts.items():
                approved = row["status"] == "Approved"
                score = row["confidence"] / 100 if isinstance(row["confidence"], (int, float)) else None
                conn.execute(
                    """insert into prompts (intent_id, prompt_text, source, status, generation_run_id, prompt_type, persona,
                                            rationale, quality_score, is_active)
                       values (%s, %s, 'prompt_agent', %s, %s, %s, %s, %s, %s, false)
                       on conflict (intent_id, prompt_text) do update set
                         persona = excluded.persona, quality_score = coalesce(excluded.quality_score, prompts.quality_score),
                         status = case when prompts.status in ('tracked', 'exported') then prompts.status else excluded.status end""",
                    (intent_row["id"], text, "approved" if approved else "candidate", run["id"],
                     "branded" if "brand" in item["intent"].lower() else "unbranded_discovery", item["audience"][:300],
                     f"Phase 1 prompt setup · {row['engine']}", round(score, 2) if score is not None else None))
                saved_prompts += 1
        run["summary"].update(status="complete", completed_at=_now(), completed_by=reviewer)
        _save(conn, run)
        conn.commit()
    sheet = run["summary"].get("sheet") or {}
    return {"ok": True, "runId": run_id, "intents": len(run["intent_map"]["items"]), "prompts": saved_prompts,
            "sheetUrl": sheet.get("sheetUrl") or sheet_url(), "exportUrl": f"/api/prompt-setup/runs/{run_id}/export.csv"}
