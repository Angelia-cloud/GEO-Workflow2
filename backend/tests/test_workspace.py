"""Workspace endpoints used by the React app: clients, saved files, Rankscale history,
Phase 1 prompt setup (rule-based and stubbed-LLM agents) and the report assistant."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agents.llm import LLM
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
    assert body["rows"] == []
    assert body["followUp"]["status"] == "pending"
    again = client.post(f"/api/clients/{new_client['id']}/rankscale/imports",
                        files={"file": ("synthetic.csv", raw, "text/csv")})
    assert again.status_code == 200, again.text
    assert again.json()["added"] == 0 and again.json()["duplicates"] == 54
    history = client.get(f"/api/clients/{new_client['id']}/rankscale").json()
    assert len(history["imports"]) == 2
    assert history["imports"][0]["followUp"]["measurements_loaded"] is True
    scoped = client.get(f"/api/clients/{new_client['id']}/rankscale?date_from=2026-09-01&date_to=2026-09-30").json()
    assert len(scoped["rows"]) == 27 and scoped["summary"]["rowCount"] == 54
    row = scoped["rows"][0]
    assert {"answerId", "engine", "prompt", "brandFound", "sourceFields"} <= set(row)
    bad = client.post(f"/api/clients/{new_client['id']}/rankscale/imports", files={"file": ("x.csv", b"a,b\n1,2\n")})
    assert bad.status_code == 422 and "Missing Rankscale columns" in bad.json()["detail"]
    with connect() as conn:
        conn.execute("delete from properties where id = %s", (new_client["id"],))  # cascades measurements
        conn.commit()


def test_rankscale_upload_queues_measurement_follow_up(new_client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.routers.rankscale.service.load_measurements",
        lambda *args: calls.append(args),
    )
    raw = (FIXTURES / "synthetic_rankscale.csv").read_bytes()
    result = client.post(
        f"/api/clients/{new_client['id']}/rankscale/imports",
        files={"file": ("synthetic.csv", raw, "text/csv")},
    )
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["rows"] == [] and body["followUp"]["status"] == "pending"
    assert calls[0][0] == new_client["id"]
    assert calls[0][1] == raw
    with connect() as conn:
        conn.execute("delete from properties where id = %s", (new_client["id"],))
        conn.commit()


def test_full_rankscale_export_is_accepted(new_client):
    raw = SAMPLE_EXPORT.read_bytes()
    result = client.post(f"/api/clients/{new_client['id']}/rankscale/imports", files={"file": ("export.csv", raw)})
    assert result.status_code == 200, result.text
    assert result.json()["added"] > 0


def test_report_assistant(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEO_LLM_PROVIDER", "groq")
    context = {"client": {"name": "Coogee"}, "periodLabel": "Sep 2026",
               "topics": [{"id": "summary", "text": "Detection is 48.5%.", "sources": [{"id": "glance", "label": "At a glance"}]}]}
    assert client.post("/api/report-assistant/ask", json={"question": "What is detection?", "context": context}).status_code == 410
    from agents.report_assistant import agent as assistant
    stub = LLM(provider="stub", stub=lambda s, u, schema: {"answer": "Detection is 48.5%.", "supported": True,
                                                            "topic_ids": ["summary"], "coverage": 90})
    out = assistant.answer("What is detection?", context, stub)
    assert out["supported"] and out["confidence"] == 90 and out["sources"] == [{"id": "glance", "label": "At a glance"}]


def test_team_review_prepare_and_diagnose(new_client, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEO_LLM_PROVIDER", "groq")
    pid = new_client["id"]
    empty = client.post(f"/api/review/{pid}/prepare").json()
    assert empty["ready"] is False
    raw = SAMPLE_EXPORT.read_bytes()
    assert client.post(f"/api/clients/{pid}/rankscale/imports", files={"file": ("export.csv", raw)}).status_code == 200
    assert client.get(f"/api/clients/{pid}").json()["hasMeasurements"] is True
    prepared = client.post(f"/api/review/{pid}/prepare")
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["ready"] is True
    insights = client.get(f"/api/insights/{pid}").json()
    assert insights, "insights should be generated from the loaded measurements"
    assert all("intent_name" in i for i in insights)
    again = client.post(f"/api/review/{pid}/prepare").json()
    assert again["insights"] == prepared.json()["insights"]  # idempotent: does not duplicate insights
    diagnoses = client.post(f"/api/review/{pid}/diagnoses", json={"insight_ids": [i["id"] for i in insights[:2]]})
    assert diagnoses.status_code == 200, diagnoses.text
    for d in diagnoses.json():
        assert {"id", "title", "summary"} <= set(d)
