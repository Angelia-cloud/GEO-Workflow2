"""End-to-end property onboarding tests using the existing database model."""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from agents.llm import LLM
from agents.prompt_generation import onboarding, pipeline
from agents.prompt_generation.schema import DraftPrompts, IntentMap, PromptReviews
from app.db import connect
from app.main import app

client = TestClient(app)


def onboarding_stub(system, user, schema):
    assert system
    data = json.loads(user)
    if schema is IntentMap:
        if data.get("CLIENT_INPUT") == "none":
            return {"intents": [{
                "name": intent["name"], "is_new": False, "description": intent["description"] or intent["name"],
                "category": "occasion", "personas": ["couple"], "occasions_or_needs": [intent["name"]],
                "priority": "medium", "reason": "Use the approved intent.", "source_quotes": [],
                "prompts_to_generate": 2,
            } for intent in data["CURRENT_INTENTS"]]}
        assert "We are planning" in data["CLIENT_INPUT"]
        tag = data["CLIENT_INPUT"].split()[-1]
        return {"intents": [
            {"name": f"Beach Weddings {tag}", "is_new": True, "description": "Beach wedding planning",
             "category": "occasion", "personas": ["couple planning a wedding"],
             "occasions_or_needs": ["beach wedding"], "priority": "high",
             "reason": "Kickoff notes ask for beach weddings.", "source_quotes": ["We are planning beach weddings"],
             "prompts_to_generate": 2},
            {"name": f"Beach Wedding Events {tag}", "is_new": True, "description": "Beach wedding planning for couples",
             "category": "occasion", "personas": ["couple planning a wedding"],
             "occasions_or_needs": ["beach wedding"], "priority": "medium",
             "reason": "A second wording for the same need.", "source_quotes": ["We are planning beach weddings"],
             "prompts_to_generate": 1},
            {"name": f"Accessible Stays {tag}", "is_new": True, "description": "Accessible hotel rooms",
             "category": "accessibility", "personas": ["traveller needing an accessible room"],
             "occasions_or_needs": ["step-free room"], "priority": "medium",
             "reason": "Kickoff notes mention accessibility.", "source_quotes": ["Accessible rooms matter"],
             "prompts_to_generate": 1},
        ], "notes": "Grouped from kickoff input."}
    if schema is DraftPrompts:
        intent = data["INTENT"]
        assert intent["description"] == "Reviewed beach wedding intent"
        return {"prompts": [
            {"prompt_text": f"Where can I plan a beach wedding near Sydney? Tell me about {intent['name']} options.",
             "intent": intent["name"], "prompt_type": "occasion", "persona": "couple", "rationale": "Tests wedding discovery."},
            {"prompt_text": f"Which Sydney beachfront venues host wedding receptions for couples? Ask about {intent['name']} services.",
             "intent": intent["name"], "prompt_type": "comparison", "persona": "couple", "rationale": "Tests reception coverage."},
        ]}
    if schema is PromptReviews:
        return {"reviews": [{"index": prompt["index"], "decision": "keep", "realism": 0.9,
                             "intent_fit": 0.9, "measurability": 0.9, "reason": "Clear traveller question."}
                            for prompt in data["PROMPTS"]]}
    raise AssertionError(schema)


def test_property_create_validation_and_duplicate():
    suffix = uuid.uuid4().hex[:10]
    name = f"Onboarding Test Property {suffix}"
    created = None
    try:
        invalid = client.post("/api/properties", json={"name": "   "})
        assert invalid.status_code == 422
        response = client.post("/api/properties", json={"name": name, "location": "Sydney", "website_url": "https://example.com"})
        assert response.status_code == 201, response.text
        created = response.json()
        assert created["name"] == name
        assert name in created["aliases"]
        duplicate = client.post("/api/properties", json={"name": name})
        assert duplicate.status_code == 409
        assert any(row["id"] == created["id"] for row in client.get("/api/properties").json())
    finally:
        if created:
            with connect() as conn:
                conn.execute("delete from properties where id = %s", (created["id"],))
                conn.commit()
    assert client.post("/api/onboarding/runs", json={"property_id": str(uuid.uuid4()), "client_input": "notes"}).status_code == 404
    assert client.post("/api/onboarding/runs", json={"property_id": str(uuid.uuid4()), "client_input": "   "}).status_code == 422


def test_property_input_intent_review_prompt_traceability_and_cleanup(monkeypatch):
    with connect() as conn:
        property_row = conn.execute("select id, name from properties order by name limit 1").fetchone()
    property_id = str(property_row["id"])
    input_run = None
    prompt_run_ids: list[str] = []
    approved_intent_ids: list[str] = []
    created_prompt_ids: list[str] = []
    llm = LLM(provider="stub", stub=onboarding_stub)
    monkeypatch.setattr(onboarding, "LLM", lambda: llm)
    monkeypatch.setattr(pipeline, "LLM", lambda: llm)
    # Save and reload raw input before running the candidate agent.
    kickoff = f"We are planning beach weddings. Accessible rooms matter. RUN-{uuid.uuid4().hex}"
    saved_response = client.post("/api/onboarding/runs", json={
        "property_id": property_id, "client_input": kickoff, "created_by": "test-reviewer"})
    assert saved_response.status_code == 201, saved_response.text
    input_run = saved_response.json()["id"]
    try:
        run_response = client.get(f"/api/onboarding/runs/{input_run}")
        assert run_response.status_code == 200
        run = run_response.json()
        assert run["property_id"] == property_id
        assert "Accessible rooms matter" in run["client_input"]
        generated_response = client.post(f"/api/onboarding/runs/{input_run}/generate-intents")
        assert generated_response.status_code == 200, generated_response.text
        generated = generated_response.json()
        assert generated["summary"]["candidate_count"] == 2
        assert len(generated["intent_map"]["intents"][0]["merged_sources"]) == 1
        with pytest.raises(ValueError, match="Review every intent candidate"):
            onboarding.generate_onboarding_prompts(input_run, llm=llm)
        blocked = client.post(f"/api/onboarding/runs/{input_run}/generate-prompts", json={})
        assert blocked.status_code == 422
        current = client.get(f"/api/onboarding/runs/{input_run}").json()
        assert all(item["status"] == "draft" for item in current["intent_map"]["intents"])
        wedding = next(item for item in current["intent_map"]["intents"] if item["category"] == "occasion")
        accessible = next(item for item in current["intent_map"]["intents"] if item["category"] == "accessibility")
        added_response = client.post(f"/api/onboarding/runs/{input_run}/intents", json={
            "name": f"Reviewer Added {uuid.uuid4().hex[:8]}", "description": "Added after kickoff review",
            "reviewer": "test-reviewer"})
        assert added_response.status_code == 200, added_response.text
        added = added_response.json()
        review_added = client.post(f"/api/onboarding/runs/{input_run}/intents/{added['candidate']['candidate_id']}/review",
                                   json={"action": "reject", "reviewer": "test-reviewer"})
        assert review_added.status_code == 200
        edited_name = f"Approved Beach Weddings {uuid.uuid4().hex[:8]}"
        edit_response = client.post(f"/api/onboarding/runs/{input_run}/intents/{wedding['candidate_id']}/review",
                                    json={"action": "edit", "reviewer": "test-reviewer",
                                          "edits": {"name": edited_name, "description": "Reviewed beach wedding intent"}})
        assert edit_response.status_code == 200, edit_response.text
        approve_response = client.post(f"/api/onboarding/runs/{input_run}/intents/{wedding['candidate_id']}/review",
                                       json={"action": "approve", "reviewer": "test-reviewer"})
        assert approve_response.status_code == 200
        reject_response = client.post(f"/api/onboarding/runs/{input_run}/intents/{accessible['candidate_id']}/review",
                                      json={"action": "reject", "reviewer": "test-reviewer"})
        assert reject_response.status_code == 200
        reviewed = client.get(f"/api/onboarding/runs/{input_run}").json()
        approved = [item for item in reviewed["intent_map"]["intents"] if item["status"] == "approved"]
        rejected = [item for item in reviewed["intent_map"]["intents"] if item["status"] == "rejected"]
        assert len(approved) == 1 and len(rejected) == 2
        assert approved[0]["name"] == edited_name
        approved_intent_ids = [approved[0]["approved_intent_id"]]
        prompts_response = client.post(f"/api/onboarding/runs/{input_run}/generate-prompts", json={
            "total": 5, "created_by": "test-reviewer"})
        assert prompts_response.status_code == 200, prompts_response.text
        prompts_result = prompts_response.json()
        prompt_run_ids.append(prompts_result["run_id"])
        assert prompts_result["summary"]["drafted"] > 0
        with connect() as conn:
            prompt_run = conn.execute("select inputs from prompt_generation_runs where id = %s", (prompts_result["run_id"],)).fetchone()
            linked_intents = {item["intent_id"] for item in prompt_run["inputs"]["approved_intent_ids"]}
            prompt_rows = conn.execute("select id, intent_id, status from prompts where generation_run_id = %s", (prompts_result["run_id"],)).fetchall()
        created_prompt_ids.extend(str(row["id"]) for row in prompt_rows)
        assert linked_intents == set(approved_intent_ids)
        assert prompt_rows and {str(row["intent_id"]) for row in prompt_rows} == linked_intents
        assert all(row["status"] == "candidate" for row in prompt_rows)
        first_prompt = str(prompt_rows[0]["id"])
        edited_prompt = f"Edited approved-intent prompt {uuid.uuid4().hex[:8]}?"
        edit_prompt_response = client.post(f"/api/onboarding/prompts/{first_prompt}/review", json={
            "action": "edit", "reviewer": "test-reviewer", "prompt_text": edited_prompt})
        assert edit_prompt_response.status_code == 200
        assert edit_prompt_response.json()["status"] == "candidate"
        approve_prompt_response = client.post(f"/api/onboarding/prompts/{first_prompt}/review", json={
            "action": "approve", "reviewer": "test-reviewer"})
        assert approve_prompt_response.status_code == 200
        second_prompt = str(prompt_rows[1]["id"])
        reject_prompt_response = client.post(f"/api/onboarding/prompts/{second_prompt}/review", json={
            "action": "reject", "reviewer": "test-reviewer"})
        assert reject_prompt_response.status_code == 200
        extra_response = client.post(f"/api/onboarding/prompt-runs/{prompts_result['run_id']}/prompts", json={
            "intent_id": approved_intent_ids[0], "prompt_text": "What beach wedding venues are near Sydney for couples?",
            "prompt_type": "occasion", "persona": "couple", "rationale": "Manual coverage",
            "reviewer": "test-reviewer"})
        assert extra_response.status_code == 200, extra_response.text
        extra = extra_response.json()
        created_prompt_ids.append(extra["id"])
        assert client.post(f"/api/onboarding/prompts/{extra['id']}/review", json={
            "action": "approve", "reviewer": "test-reviewer"}).status_code == 200
        with connect() as conn:
            final_rows = conn.execute("select id, intent_id, prompt_text, status from prompts where generation_run_id = %s", (prompts_result["run_id"],)).fetchall()
        by_id = {str(row["id"]): row for row in final_rows}
        assert by_id[first_prompt]["prompt_text"] == edited_prompt
        assert by_id[first_prompt]["status"] == "approved"
        assert by_id[second_prompt]["status"] == "rejected"
        assert by_id[extra["id"]]["status"] == "approved"
        assert all(str(row["intent_id"]) in linked_intents for row in final_rows)
        assert all(str(row["intent_id"]) in set(approved_intent_ids) for row in final_rows)
        rejected_intent_id = str(uuid.uuid4())
        rejected_manual = client.post(f"/api/onboarding/prompt-runs/{prompts_result['run_id']}/prompts", json={
            "intent_id": rejected_intent_id, "prompt_text": "A rejected intent prompt?", "reviewer": "test-reviewer"})
        assert rejected_manual.status_code == 422
        export_response = client.get(f"/api/onboarding/prompt-runs/{prompts_result['run_id']}/export.csv")
        assert export_response.status_code == 200
        assert edited_prompt in export_response.text
        assert "What beach wedding venues are near Sydney for couples?" in export_response.text
    finally:
        with connect() as conn:
            audit_ids = prompt_run_ids + ([input_run] if input_run else []) + created_prompt_ids
            if audit_ids:
                conn.execute("delete from activity_history where entity_id = any(%s::uuid[])", (audit_ids,))
            if prompt_run_ids:
                conn.execute("delete from prompts where generation_run_id = any(%s::uuid[])", (prompt_run_ids,))
            if prompt_run_ids:
                conn.execute("delete from prompt_generation_runs where id = any(%s::uuid[])", (prompt_run_ids,))
            if approved_intent_ids:
                conn.execute("delete from intents where id = any(%s::uuid[])", (approved_intent_ids,))
            if input_run:
                conn.execute("delete from prompt_generation_runs where id = %s", (input_run,))
            conn.commit()
