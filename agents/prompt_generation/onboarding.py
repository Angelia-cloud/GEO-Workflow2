"""Property kickoff input, intent-candidate review, and approved-prompt generation."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db import connect

from ..llm import LLM
from . import pipeline
from .schema import IntentMap

WORKFLOW_INPUT = "property_onboarding"
WORKFLOW_PROMPTS = "property_onboarding_prompts"
INTENT_CATEGORIES = {
    "accommodation", "occasion", "dining", "wellness", "family", "business",
    "accessibility", "local_experience", "other",
}


class DuplicatePropertyError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid(value: str, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError(f"{field} must be a UUID") from error


def _normal_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _audit(conn, entity_id: str, actor: str | None, changes: dict[str, Any]) -> None:
    conn.execute(
        """insert into activity_history (entity_table, entity_id, action, actor, changes)
           values ('prompt_generation_runs', %s, 'update', %s, %s::jsonb)""",
        (entity_id, actor or "onboarding", json.dumps(changes, ensure_ascii=False, default=str)),
    )


def create_property(data: dict[str, Any]) -> dict[str, Any]:
    name = " ".join(str(data.get("name", "")).split())
    if not name:
        raise ValueError("Property name is required")
    aliases = list(data.get("aliases") or [])
    if not any(_normal_text(alias) == _normal_text(name) for alias in aliases):
        aliases.insert(0, name)
    aliases = list(dict.fromkeys(" ".join(str(value).split()) for value in aliases if str(value).strip()))
    ignored = list(dict.fromkeys(" ".join(str(value).split()) for value in (data.get("ignored_names") or []) if str(value).strip()))
    own_domains = list(dict.fromkeys(
        str(value).strip().lower() for value in (data.get("own_domains") or []) if str(value).strip()))

    with connect() as conn:
        existing = conn.execute("select id from properties where lower(name) = lower(%s)", (name,)).fetchone()
        if existing:
            raise DuplicatePropertyError("A property with this name already exists")
        row = conn.execute(
            """insert into properties (name, brand_group, location, website_url, aliases, ignored_names, own_domains)
               values (%s, %s, %s, %s, %s, %s, %s)
               on conflict (name) do nothing
               returning id, name, brand_group, location, website_url, aliases""",
            (name, data.get("brand_group"), data.get("location"), data.get("website_url"),
             aliases, ignored, own_domains),
        ).fetchone()
        if not row:
            raise DuplicatePropertyError("A property with this name already exists")
        conn.commit()
        return {**row, "id": str(row["id"])}


def _load_run(conn, run_id: str) -> dict[str, Any]:
    run_id = _uuid(run_id, "run_id")
    row = conn.execute(
        """select id, property_id, inputs, intent_map, summary, created_by, created_at
           from prompt_generation_runs where id = %s""",
        (run_id,),
    ).fetchone()
    if not row or (row["inputs"] or {}).get("workflow") != WORKFLOW_INPUT:
        raise ValueError("Onboarding run not found")
    return dict(row)


def list_onboarding_runs(property_id: str) -> list[dict[str, Any]]:
    property_id = _uuid(property_id, "property_id")
    with connect() as conn:
        if not conn.execute("select 1 from properties where id = %s", (property_id,)).fetchone():
            raise ValueError("Property not found")
        rows = conn.execute(
            """select id, inputs, intent_map, summary, created_by, created_at
               from prompt_generation_runs
               where property_id = %s and inputs->>'workflow' = %s
               order by created_at desc""",
            (property_id, WORKFLOW_INPUT),
        ).fetchall()
        return [{"id": str(row["id"]), "client_input": (row["inputs"] or {}).get("client_input", ""),
                 "intent_map": row["intent_map"] or {}, "summary": row["summary"] or {},
                 "created_by": row["created_by"], "created_at": row["created_at"]} for row in rows]


def get_onboarding_run(run_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = _load_run(conn, run_id)
        result = {"id": str(row["id"]), "property_id": str(row["property_id"]),
                  "client_input": (row["inputs"] or {}).get("client_input", ""),
                  "intent_map": row["intent_map"] or {"intents": [], "notes": ""},
                  "summary": row["summary"] or {}, "created_by": row["created_by"],
                  "created_at": row["created_at"]}
        prompt_run_id = result["summary"].get("latest_prompt_run_id")
        if not prompt_run_id:
            child = conn.execute(
                """select id from prompt_generation_runs
                   where property_id = %s and inputs->>'workflow' = %s and inputs->>'onboarding_run_id' = %s
                   order by created_at desc limit 1""",
                (result["property_id"], WORKFLOW_PROMPTS, result["id"]),
            ).fetchone()
            prompt_run_id = str(child["id"]) if child else None
        result["prompt_run_id"] = prompt_run_id
        result["prompts"] = []
        if prompt_run_id:
            prompts = conn.execute(
                """select p.id, p.intent_id, i.name as intent, p.prompt_text, p.source, p.status,
                          p.prompt_type, p.persona, p.rationale, p.quality_score
                   from prompts p join intents i on i.id = p.intent_id
                   where p.generation_run_id = %s and i.property_id = %s
                   order by i.name, p.created_at, p.id""",
                (prompt_run_id, result["property_id"]),
            ).fetchall()
            result["prompts"] = [{**prompt, "id": str(prompt["id"]), "intent_id": str(prompt["intent_id"])}
                                 for prompt in prompts]
        return result


def save_client_input(property_id: str, client_input: str, created_by: str | None = None) -> dict[str, Any]:
    property_id = _uuid(property_id, "property_id")
    client_input = str(client_input or "").strip()
    if not client_input:
        raise ValueError("Client input cannot be empty")
    if len(client_input) > 50000:
        raise ValueError("Client input must be 50,000 characters or fewer")
    with connect() as conn:
        if not conn.execute("select 1 from properties where id = %s", (property_id,)).fetchone():
            raise ValueError("Property not found")
        row = conn.execute(
            """insert into prompt_generation_runs (property_id, model, inputs, intent_map, summary, created_by)
               values (%s, 'onboarding:input', %s::jsonb, %s::jsonb, %s::jsonb, %s) returning id, created_at""",
            (property_id, json.dumps({"workflow": WORKFLOW_INPUT, "client_input": client_input}),
             json.dumps({"intents": [], "notes": ""}),
             json.dumps({"status": "input_saved", "candidate_count": 0, "approved_count": 0, "rejected_count": 0}),
             created_by),
        ).fetchone()
        conn.commit()
        return {"id": str(row["id"]), "created_at": row["created_at"], "status": "input_saved"}


def _property_brief(conn, property_id: str) -> dict[str, Any]:
    prop = conn.execute(
        "select id, name, brand_group, location, website_url, aliases, own_domains from properties where id = %s",
        (property_id,),
    ).fetchone()
    if not prop:
        raise ValueError("Property not found")
    try:
        brief = pipeline.load_brief(prop["name"])
    except FileNotFoundError:
        brief = {"property_name": prop["name"], "location": prop["location"],
                 "website": prop["website_url"], "facts": [], "audiences": []}
    brief["property_name"] = prop["name"]
    brief["location"] = prop["location"] or brief.get("location")
    brief["website"] = prop["website_url"] or brief.get("website")
    brief["brand_group"] = prop["brand_group"]
    brief["aliases"] = prop["aliases"] or []
    brief["own_domains"] = prop["own_domains"] or []
    return brief


def _candidate_plans(intent_map: IntentMap, raw_input: str, existing_intents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing_by_name = {_normal_text(row["name"]): str(row["id"]) for row in existing_intents}
    candidates: list[dict[str, Any]] = []
    for plan in intent_map.intents:
        data = plan.model_dump()
        name = " ".join(data["name"].split())
        if not name:
            continue
        quote_text = raw_input.casefold()
        quotes = [quote.strip() for quote in data.get("source_quotes", []) if quote.strip()
                  and quote.strip().casefold() in quote_text]
        data["name"] = name
        data["source_quotes"] = list(dict.fromkeys(quotes))
        data["source_reason"] = data.pop("reason", "")
        data["candidate_id"] = str(uuid.uuid4())
        data["status"] = "draft"
        data["approved_intent_id"] = None
        data["existing_intent_id"] = existing_by_name.get(_normal_text(name))
        data["merged_sources"] = []
        description = f"{name} {data.get('description', '')}"
        def is_duplicate(candidate: dict[str, Any]) -> bool:
            name_similarity = pipeline.similarity(name, candidate["name"])
            description_similarity = pipeline.similarity(data.get("description", ""), candidate.get("description", ""))
            same_category = data.get("category") == candidate.get("category")
            shared_quotes = set(data.get("source_quotes", [])) & set(candidate.get("source_quotes", []))
            return (_normal_text(name) == _normal_text(candidate["name"])
                or pipeline.similarity(description, f"{candidate['name']} {candidate.get('description', '')}") >= 0.82
                    or (same_category and bool(shared_quotes))
                    or (same_category and name_similarity >= 0.6 and description_similarity >= 0.5))

        duplicate = next((candidate for candidate in candidates if is_duplicate(candidate)), None)
        if duplicate:
            duplicate["personas"] = list(dict.fromkeys(duplicate["personas"] + data["personas"]))[:5]
            duplicate["occasions_or_needs"] = list(dict.fromkeys(
                duplicate["occasions_or_needs"] + data["occasions_or_needs"]))[:10]
            duplicate["source_quotes"] = list(dict.fromkeys(duplicate["source_quotes"] + data["source_quotes"]))[:5]
            duplicate["merged_sources"].append({"name": name, "description": data["description"],
                                                  "source_reason": data["source_reason"]})
            if len(data["description"]) > len(duplicate["description"]):
                duplicate["description"] = data["description"]
            continue
        candidates.append(data)
    return candidates


def _candidate_counts(candidates: list[dict[str, Any]]) -> dict[str, int]:
    return {"candidate_count": len(candidates),
            "approved_count": sum(candidate["status"] == "approved" for candidate in candidates),
            "rejected_count": sum(candidate["status"] == "rejected" for candidate in candidates),
            "draft_count": sum(candidate["status"] == "draft" for candidate in candidates)}


def _update_run_intents(conn, run: dict[str, Any], candidates: list[dict[str, Any]], notes: str,
                        status: str, actor: str | None, action: str) -> None:
    intent_map = {"intents": candidates, "notes": notes, "updated_at": _now()}
    summary = {**(run["summary"] or {}), **_candidate_counts(candidates), "status": status}
    conn.execute("update prompt_generation_runs set intent_map = %s::jsonb, summary = %s::jsonb where id = %s",
                 (json.dumps(intent_map, ensure_ascii=False), json.dumps(summary, ensure_ascii=False), run["id"]))
    _audit(conn, str(run["id"]), actor, {"action": action, **_candidate_counts(candidates)})


def generate_intents(run_id: str, llm: LLM | None = None, total: int = 24, focus: str | None = None) -> dict[str, Any]:
    llm = llm or LLM()
    with connect() as conn:
        run = _load_run(conn, run_id)
        property_id = str(run["property_id"])
        raw_input = (run["inputs"] or {}).get("client_input", "")
        brief = _property_brief(conn, property_id)
        context = pipeline.load_context(conn, property_id)
        existing_candidates = (run["intent_map"] or {}).get("intents", [])
        if any(candidate.get("status") == "approved" for candidate in existing_candidates):
            raise ValueError("This kickoff already has approved intents; start a new kickoff to regenerate")
    mapped = pipeline.agent1_intent_mapper(llm, brief, context, total, focus, raw_input)
    candidates = _candidate_plans(mapped, raw_input, context["intents"])
    if not candidates:
        raise ValueError("The intent agent returned no distinct candidates")
    with connect() as conn:
        run = _load_run(conn, run_id)
        _update_run_intents(conn, run, candidates, mapped.notes, "intent_review", run["created_by"], "generate_intents")
        conn.commit()
    return {"run_id": str(run_id), "intent_map": {"intents": candidates, "notes": mapped.notes},
            "summary": _candidate_counts(candidates)}


def _check_duplicate_intent(candidates: list[dict[str, Any]], candidate: dict[str, Any], exclude_id: str | None = None) -> None:
    normalized = _normal_text(candidate["name"])
    for current in candidates:
        if current["candidate_id"] == exclude_id or current["status"] == "rejected":
            continue
        if normalized == _normal_text(current["name"]):
            raise ValueError("An intent with this name already exists in the review list")


def review_intent(run_id: str, candidate_id: str, action: str, reviewer: str,
                  edits: dict[str, Any] | None = None) -> dict[str, Any]:
    run_id = _uuid(run_id, "run_id")
    with connect() as conn:
        run = _load_run(conn, run_id)
        intent_map = run["intent_map"] or {"intents": [], "notes": ""}
        candidates = intent_map.get("intents", [])
        candidate = next((item for item in candidates if item["candidate_id"] == candidate_id), None)
        if not candidate:
            raise ValueError("Intent candidate not found")
        if action == "edit":
            if candidate["status"] != "draft":
                raise ValueError("Only draft intent candidates can be edited")
            edits = edits or {}
            for field in ("name", "description", "category", "personas", "occasions_or_needs", "priority",
                          "source_reason", "source_quotes", "prompts_to_generate"):
                if field in edits:
                    candidate[field] = edits[field]
            candidate["name"] = " ".join(str(candidate.get("name", "")).split())
            if not candidate["name"]:
                raise ValueError("Intent name is required")
            if candidate.get("category") not in INTENT_CATEGORIES:
                raise ValueError("Unknown intent category")
            _check_duplicate_intent(candidates, candidate, candidate_id)
        elif action == "approve":
            if candidate["status"] == "rejected":
                raise ValueError("Rejected intent candidates cannot be approved")
            property_id = str(run["property_id"])
            row = conn.execute(
                """insert into intents (property_id, name, description) values (%s, %s, %s)
                   on conflict (property_id, name) do nothing returning id""",
                (property_id, candidate["name"], candidate.get("description")),
            ).fetchone()
            if not row:
                row = conn.execute("select id from intents where property_id = %s and lower(name) = lower(%s)",
                                   (property_id, candidate["name"])).fetchone()
            if not row:
                raise RuntimeError("Could not save the approved intent")
            candidate["status"] = "approved"
            candidate["approved_intent_id"] = str(row["id"])
        elif action == "reject":
            if candidate["status"] == "approved":
                raise ValueError("Approved intents are active; start a new kickoff to change them")
            candidate["status"] = "rejected"
        else:
            raise ValueError("Action must be approve, edit, or reject")
        candidate["review"] = {"action": action, "reviewer": reviewer, "at": _now()}
        status = "intent_review"
        if candidates and all(item["status"] in ("approved", "rejected") for item in candidates):
            status = "intents_reviewed"
        _update_run_intents(conn, run, candidates, intent_map.get("notes", ""), status, reviewer, action)
        conn.commit()
        return {"run_id": run_id, "candidate": candidate, "summary": _candidate_counts(candidates)}


def add_intent_candidate(run_id: str, data: dict[str, Any], reviewer: str) -> dict[str, Any]:
    run_id = _uuid(run_id, "run_id")
    name = " ".join(str(data.get("name", "")).split())
    if not name:
        raise ValueError("Intent name is required")
    category = data.get("category", "other")
    if category not in INTENT_CATEGORIES:
        raise ValueError("Unknown intent category")
    candidate = {
        "candidate_id": str(uuid.uuid4()), "name": name, "description": str(data.get("description", "")).strip(),
        "category": category, "personas": data.get("personas") or ["traveller seeking " + name],
        "occasions_or_needs": data.get("occasions_or_needs") or [name],
        "priority": data.get("priority", "medium"), "source_reason": str(data.get("source_reason", "Added by reviewer")).strip(),
        "source_quotes": data.get("source_quotes") or [], "prompts_to_generate": int(data.get("prompts_to_generate", 3)),
        "status": "draft", "approved_intent_id": None, "existing_intent_id": None, "merged_sources": [],
        "review": {"action": "add", "reviewer": reviewer, "at": _now()},
    }
    if candidate["priority"] not in ("low", "medium", "high") or not 1 <= candidate["prompts_to_generate"] <= 15:
        raise ValueError("Priority or prompt count is invalid")
    with connect() as conn:
        run = _load_run(conn, run_id)
        intent_map = run["intent_map"] or {"intents": [], "notes": ""}
        candidates = intent_map.get("intents", [])
        _check_duplicate_intent(candidates, candidate)
        candidates.append(candidate)
        _update_run_intents(conn, run, candidates, intent_map.get("notes", ""), "intent_review", reviewer, "add_intent")
        conn.commit()
    return {"run_id": run_id, "candidate": candidate, "summary": _candidate_counts(candidates)}


def generate_onboarding_prompts(run_id: str, total: int = 30, focus: str | None = None,
                                created_by: str | None = None, llm: LLM | None = None) -> dict[str, Any]:
    run_id = _uuid(run_id, "run_id")
    with connect() as conn:
        run = _load_run(conn, run_id)
        candidates = (run["intent_map"] or {}).get("intents", [])
        if any(candidate.get("status") == "draft" for candidate in candidates):
            raise ValueError("Review every intent candidate before generating prompts")
        approved = [candidate for candidate in candidates if candidate.get("status") == "approved"
                    and candidate.get("approved_intent_id")]
        if not approved:
            raise ValueError("Approve at least one intent before generating prompts")
        property_id = str(run["property_id"])
        approved_intent_ids = [candidate["approved_intent_id"] for candidate in approved]
        approved_lookup = [{"candidate_id": candidate["candidate_id"], "intent_id": candidate["approved_intent_id"],
                            "name": candidate["name"]} for candidate in approved]
    result = pipeline.generate(property_id, total=total, focus=focus, llm=llm, created_by=created_by,
                               approved_intent_ids=approved_intent_ids, source_intent_run_id=run_id,
                               approved_intent_metadata=approved)
    with connect() as conn:
        run = _load_run(conn, run_id)
        summary = {**(run["summary"] or {}), "status": "prompt_review",
                   "latest_prompt_run_id": result["run_id"], "approved_intents_for_prompts": approved_lookup}
        conn.execute("update prompt_generation_runs set summary = %s::jsonb where id = %s",
                     (json.dumps(summary, ensure_ascii=False), run_id))
        _audit(conn, run_id, created_by, {"action": "generate_prompts", "prompt_run_id": result["run_id"],
                                         "approved_intent_ids": approved_intent_ids})
        conn.commit()
    return result


def add_prompt_candidate(prompt_run_id: str, intent_id: str, prompt_text: str, prompt_type: str | None,
                         persona: str | None, rationale: str | None, reviewer: str) -> dict[str, Any]:
    prompt_run_id = _uuid(prompt_run_id, "prompt_run_id")
    intent_id = _uuid(intent_id, "intent_id")
    prompt_text = " ".join(str(prompt_text or "").split())
    if not prompt_text:
        raise ValueError("Prompt text is required")
    with connect() as conn:
        run = conn.execute("select property_id, inputs from prompt_generation_runs where id = %s", (prompt_run_id,)).fetchone()
        if not run or (run["inputs"] or {}).get("workflow") != WORKFLOW_PROMPTS:
            raise ValueError("Onboarding prompt run not found")
        approved_ids = {str(item["intent_id"]) for item in (run["inputs"] or {}).get("approved_intent_ids", [])}
        if intent_id not in approved_ids:
            raise ValueError("Manual prompts must use an intent approved in this onboarding run")
        intent = conn.execute("select id from intents where id = %s and property_id = %s",
                              (intent_id, run["property_id"])).fetchone()
        if not intent:
            raise ValueError("Intent not found for this property")
        row = conn.execute(
            """insert into prompts (intent_id, prompt_text, source, status, generation_run_id,
                                    prompt_type, persona, rationale, quality_score, is_active)
               values (%s, %s, 'manual', 'candidate', %s, %s, %s, %s, null, false)
               on conflict (intent_id, prompt_text) do nothing returning id""",
            (intent_id, prompt_text, prompt_run_id, prompt_type, persona, rationale),
        ).fetchone()
        if not row:
            raise ValueError("This prompt already exists for the selected intent")
        prompt_id = str(row["id"])
        _audit(conn, prompt_id, reviewer, {"action": "add_prompt", "intent_id": intent_id, "prompt_run_id": prompt_run_id})
        conn.commit()
        return {"id": prompt_id, "intent_id": intent_id, "prompt_text": prompt_text, "status": "candidate"}


def review_prompt_candidate(prompt_id: str, action: str, reviewer: str, prompt_text: str | None = None) -> dict[str, Any]:
    prompt_id = _uuid(prompt_id, "prompt_id")
    if action not in ("approve", "edit", "reject"):
        raise ValueError("Action must be approve, edit, or reject")
    with connect() as conn:
        row = conn.execute(
            """select p.id, p.intent_id, p.prompt_text, p.status, p.generation_run_id, p.source,
                      i.property_id, r.inputs
               from prompts p join intents i on i.id = p.intent_id
               join prompt_generation_runs r on r.id = p.generation_run_id
               where p.id = %s""", (prompt_id,),
        ).fetchone()
        if not row or (row["inputs"] or {}).get("workflow") != WORKFLOW_PROMPTS:
            raise ValueError("Onboarding prompt candidate not found")
        if row["status"] == "rejected":
            raise ValueError("Rejected prompts cannot be edited or approved")
        if action == "edit":
            text = " ".join(str(prompt_text or "").split())
            if not text:
                raise ValueError("Edited prompt text is required")
            try:
                conn.execute("update prompts set prompt_text = %s where id = %s", (text, prompt_id))
            except Exception as error:
                if "unique" in str(error).lower():
                    raise ValueError("That prompt already exists for this intent") from error
                raise
            conn.execute("update prompts set status = 'candidate' where id = %s", (prompt_id,))
        else:
            text = row["prompt_text"]
            new_status = "approved" if action == "approve" else "rejected"
            conn.execute("update prompts set status = %s where id = %s", (new_status, prompt_id))
        _audit(conn, prompt_id, reviewer, {"action": action, "intent_id": str(row["intent_id"]),
                                          "prompt_text": text})
        conn.commit()
        return {"id": prompt_id, "intent_id": str(row["intent_id"]), "prompt_text": text,
                "status": "approved" if action == "approve" else "rejected" if action == "reject" else "candidate"}


def export_onboarding_prompts(prompt_run_id: str) -> str:
    prompt_run_id = _uuid(prompt_run_id, "prompt_run_id")
    with connect() as conn:
        run = conn.execute("select property_id, inputs from prompt_generation_runs where id = %s", (prompt_run_id,)).fetchone()
        if not run or (run["inputs"] or {}).get("workflow") != WORKFLOW_PROMPTS:
            raise ValueError("Onboarding prompt run not found")
        property_id = str(run["property_id"])
    return pipeline.export_rankscale_csv(property_id, ("approved",), run_id=prompt_run_id)
