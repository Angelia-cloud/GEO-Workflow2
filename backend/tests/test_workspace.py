"""Workspace endpoints used by the React app: clients, saved files, Rankscale history,
Phase 1 prompt setup (rule-based and stubbed-LLM agents) and the report assistant."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agents.llm import LLM
from agents.prompt_setup.schema import Rewrite, SetupIntents, SetupPrompts
from agents.prompt_generation.schema import PromptReviews
from app.db import connect
from app.main import app

client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_EXPORT = Path(__file__).parent.parent / "sample_data" / "rankscale_export_sample.csv"


@pytest.fixture
def new_client():
    suffix = uuid.uuid4().hex[:8]
    created = client.post("/api/clients", json={"name": f"Test Client {suffix}", "property": f"Test Hotel {suffix}",
                                                 "targetAudience": "Families planning a beach stay; couples on a weekend away",
                                                 "goals": "Grow family and spa bookings"})
    assert created.status_code == 201, created.text
    yield created.json()
    with connect() as conn:
        conn.execute("delete from library_entries where client_id = %s", (created.json()["id"],))
        conn.execute("delete from properties where id = %s", (created.json()["id"],))
        conn.commit()


def test_health_team_and_clients(new_client):
    health = client.get("/api/health").json()
    assert health["ok"] and "llm" in health
    assert client.get("/api/team").json()[0]["initials"] == "VH"
    clients = client.get("/api/clients").json()
    assert any(c["id"] == new_client["id"] for c in clients)
    assert any(c["property"] == "InterContinental Sydney Coogee Beach" for c in clients)
    assert client.post("/api/clients", json={"name": "  ", "property": "x"}).status_code == 422
    assert client.post("/api/clients", json={"name": new_client["name"], "property": "Other"}).status_code == 409
    patched = client.patch(f"/api/clients/{new_client['id']}", json={"goals": "Updated goals"}).json()
    assert patched["goals"] == "Updated goals" and patched["targetAudience"].startswith("Families")
    assert client.get(f"/api/clients/{uuid.uuid4()}").status_code == 404


def test_library_entries_and_files(new_client):
    entry = {"type": "upload", "title": "Transcript.txt", "clientId": new_client["id"], "client": new_client["name"],
             "phase": 1, "status": "stored"}
    saved = client.post("/api/library", data={"entry": json.dumps(entry)},
                        files={"file": ("Transcript.txt", b"hello kickoff", "text/plain")}).json()
    assert saved["fileStored"] and saved["fileSize"] == 13 and saved["clientId"] == new_client["id"]
    listed = client.get(f"/api/library?client_id={new_client['id']}").json()
    assert [e["id"] for e in listed] == [saved["id"]]
    assert client.get(f"/api/library/{saved['id']}/file").content == b"hello kickoff"
    updated = client.post("/api/library", data={"entry": json.dumps({**entry, "id": saved["id"], "status": "complete"})}).json()
    assert updated["status"] == "complete" and updated["fileStored"]
    assert client.post("/api/library", data={"entry": json.dumps({"type": "nope"})}).status_code == 422
    assert client.delete(f"/api/library/{saved['id']}").status_code == 204


def test_rankscale_history_dedupes_and_loads_measurements(new_client):
    raw = (FIXTURES / "synthetic_rankscale.csv").read_bytes()
    first = client.post(f"/api/clients/{new_client['id']}/rankscale/imports",
                        files={"file": ("synthetic.csv", raw, "text/csv")}, data={"imported_by": "test"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["added"] == 54 and body["duplicates"] == 0
    assert body["summary"]["rowCount"] == 54 and body["summary"]["engineCount"] == 3
    assert body["latestImport"]["rowsAdded"] == 54
    assert body["followUp"]["measurements_loaded"] is True, body["followUp"]
    again = client.post(f"/api/clients/{new_client['id']}/rankscale/imports",
                        files={"file": ("synthetic.csv", raw, "text/csv")}).json()
    assert again["added"] == 0 and again["duplicates"] == 54 and len(again["imports"]) == 2
    scoped = client.get(f"/api/clients/{new_client['id']}/rankscale?date_from=2026-09-01&date_to=2026-09-30").json()
    assert len(scoped["rows"]) == 27 and scoped["summary"]["rowCount"] == 54
    row = scoped["rows"][0]
    assert {"answerId", "engine", "prompt", "brandFound", "sourceFields"} <= set(row)
    bad = client.post(f"/api/clients/{new_client['id']}/rankscale/imports", files={"file": ("x.csv", b"a,b\n1,2\n")})
    assert bad.status_code == 422 and "Missing Rankscale columns" in bad.json()["detail"]
    with connect() as conn:
        conn.execute("delete from properties where id = %s", (new_client["id"],))  # cascades measurements
        conn.commit()


def test_full_rankscale_export_is_accepted(new_client):
    raw = SAMPLE_EXPORT.read_bytes()
    result = client.post(f"/api/clients/{new_client['id']}/rankscale/imports", files={"file": ("export.csv", raw)})
    assert result.status_code == 200, result.text
    assert result.json()["added"] > 0


def _run(cid, name):
    run = client.post("/api/prompt-setup/runs", json={
        "clientId": cid, "client": name, "property": name, "targetAudience": "Families; couples planning a romantic weekend",
        "goals": "More family stays and spa weekends", "createdBy": "test",
        "transcript": "Client: families love the beach. Couples ask about the spa and dining. We host birthday celebrations."})
    assert run.status_code == 201, run.text
    return run.json()["id"]


def test_prompt_setup_rule_based(new_client, monkeypatch):
    monkeypatch.setenv("GEO_LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    engines = client.get("/api/prompt-setup/engines").json()["engines"]
    assert len(engines) == 16 and engines[0]["sheetUrl"].startswith("https://docs.google.com/")
    assert client.get("/api/prompt-setup/agents").json()["mode"] == "rules"
    run_id = _run(new_client["id"], new_client["property"])
    intents = client.post(f"/api/prompt-setup/runs/{run_id}/intents").json()
    labels = [i["intent"] for i in intents["items"]]
    assert intents["source"] == "rules" and "Family stays" in labels and labels[-1] == "Brand-name check"
    item = intents["items"][0]
    client.patch(f"/api/prompt-setup/runs/{run_id}/intents", json={"updates": [{"id": item["id"], "audience": "Beach families"}], "reviewer": "test"})
    prompts = client.post(f"/api/prompt-setup/runs/{run_id}/prompts", json={"engineIds": ["chatgpt", "gemini", "bogus"]}).json()
    assert len(prompts["prompts"]) == 2 * len(labels)
    assert all(isinstance(p["confidence"], int) and 30 <= p["confidence"] <= 95 for p in prompts["prompts"])
    redo = client.post(f"/api/prompt-setup/runs/{run_id}/prompts/regenerate", json={
        "engineId": "chatgpt", "itemId": item["id"], "text": prompts["prompts"][0]["text"], "feedback": "Mention a kids club"}).json()
    assert "kids club" in redo["text"] and redo["source"] == "rules"
    client.patch(f"/api/prompt-setup/runs/{run_id}/prompts", json={"updates": [
        {"engineId": "chatgpt", "itemId": item["id"], "text": redo["text"], "status": "Approved"}], "reviewer": "test"})
    sheet = client.post(f"/api/prompt-setup/runs/{run_id}/sheet", json={"engineIds": ["chatgpt", "gemini"]}).json()
    assert sheet["synced"] is False and sheet["sheetUrl"]
    done = client.post(f"/api/prompt-setup/runs/{run_id}/complete", json={"reviewer": "test", "engineIds": ["chatgpt", "gemini"]}).json()
    assert done["intents"] == len(labels) and done["prompts"] >= len(labels)
    csv_text = client.get(f"/api/prompt-setup/runs/{run_id}/export.csv?engine=chatgpt").text
    assert "search_term" in csv_text and "kids club" in csv_text
    with connect() as conn:
        approved = conn.execute("""select count(*) n from prompts p join intents i on i.id = p.intent_id
                                   where i.property_id = %s and p.status = 'approved'""", (new_client["id"],)).fetchone()["n"]
    assert approved == 1
    assert client.post("/api/prompt-setup/runs", json={"clientId": str(uuid.uuid4()), "transcript": "x", "property": "p",
                                                       "targetAudience": "a", "goals": "g"}).status_code == 404
    assert client.post(f"/api/prompt-setup/runs/{run_id}/prompts", json={"engineIds": []}).status_code == 422


def _stub(system, user, schema):
    data = json.loads(user)
    if schema is SetupIntents:
        return {"intents": [{"intent": "Beach family holidays", "audience": "Parents with young kids", "description": "",
                             "source_quotes": ["families love the beach"]},
                            {"intent": "Spa weekends", "audience": "Couples", "description": ""},
                            {"intent": "Brand-name check", "audience": "All personas", "description": ""}]}
    if schema is SetupPrompts:
        return {"prompts": [{"item_id": i["item_id"], "prompt_text": f"Which hotel near the beach suits {i['audience'].lower()} for {i['intent'].lower()}?"}
                            for i in data["INTENTS"]]}
    if schema is PromptReviews:
        return {"reviews": [{"index": p["index"], "decision": "keep", "realism": 0.9, "intent_fit": 0.8, "measurability": 0.9,
                             "reason": "ok"} for p in data["PROMPTS"]]}
    if schema is Rewrite:
        return {"prompt_text": data["PROMPT"].rstrip("?") + " with a kids club?", "note": "added kids club"}
    raise AssertionError(schema)


def test_prompt_setup_with_agents(new_client, monkeypatch):
    stub = LLM(provider="stub", stub=_stub)
    monkeypatch.setattr("agents.prompt_setup.agent._llm", lambda llm=None: stub)
    run_id = _run(new_client["id"], new_client["property"])
    intents = client.post(f"/api/prompt-setup/runs/{run_id}/intents").json()
    assert intents["source"] == "ai" and [i["intent"] for i in intents["items"]][:2] == ["Beach family holidays", "Spa weekends"]
    prompts = client.post(f"/api/prompt-setup/runs/{run_id}/prompts", json={"engineIds": ["perplexity"]}).json()
    assert prompts["source"] == "ai" and {p["confidence"] for p in prompts["prompts"]} == {87}
    redo = client.post(f"/api/prompt-setup/runs/{run_id}/prompts/regenerate", json={
        "engineId": "perplexity", "itemId": "I01", "text": prompts["prompts"][0]["text"], "feedback": "add kids club"}).json()
    assert redo["text"].endswith("with a kids club?") and redo["confidence"] == 87


def test_report_assistant(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEO_LLM_PROVIDER", "groq")
    context = {"client": {"name": "Coogee"}, "periodLabel": "Sep 2026",
               "topics": [{"id": "summary", "text": "Detection is 48.5%.", "sources": [{"id": "glance", "label": "At a glance"}]}]}
    assert client.post("/api/report-assistant/ask", json={"question": "What is detection?", "context": context}).json()["fallback"]
    from agents.report_assistant import agent as assistant
    stub = LLM(provider="stub", stub=lambda s, u, schema: {"answer": "Detection is 48.5%.", "supported": True,
                                                            "topic_ids": ["summary"], "coverage": 90})
    out = assistant.answer("What is detection?", context, stub)
    assert out["supported"] and out["confidence"] == 90 and out["sources"] == [{"id": "glance", "label": "At a glance"}]
