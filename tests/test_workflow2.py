"""Workflow 2 additions: rule-based diagnosis, human review with learning memory, outcome logging,
auto alerts and the report sections that mirror the Aug 2026 deck. Needs db/09_workflow2.sql applied."""
from fastapi.testclient import TestClient

from app.db import connect
from app.main import app

client = TestClient(app)


def _pid():
    with connect() as conn:
        return str(conn.execute("select id from properties order by name limit 1").fetchone()["id"])


def _cleanup(diagnosis_ids):
    with connect() as conn:
        conn.execute("delete from learning_memory where reviewer = 'wf2-test'")
        conn.execute("delete from diagnoses where id = any(%s::uuid[])", (diagnosis_ids,))
        conn.commit()


def test_rules_diagnosis_review_memory_and_outcome():
    pid = _pid()
    batch = client.post("/api/diagnoses/batch", json={"property_id": pid, "limit": 2, "mode": "rules"})
    assert batch.status_code == 200, batch.text
    diag_ids = [r["diagnosis_id"] for r in batch.json()["results"] if r["diagnosis_id"]]
    try:
        assert diag_ids, "expected at least one undiagnosed miss in the sample data"
        queue = client.get(f"/api/recommendations?property_id={pid}&status=proposed").json()
        rec = next(r for r in queue if str(r["diagnosis_id"]) in diag_ids)
        assert rec["lens"] in ("Relevance", "Clarity", "Credibility", "Unclear")

        # edit → applied + remembered
        edited = client.post("/api/feedback", json={"target": "recommendation", "target_id": rec["recommendation_id"],
                                                    "reviewer": "wf2-test", "decision": "edit", "comment": "more specific",
                                                    "changes": {"title": "Publish a baby shower page"}})
        assert edited.status_code == 200, edited.text
        assert edited.json()["learning_memory_id"]
        with connect() as conn:
            assert conn.execute("select title from recommendations where id = %s",
                                (rec["recommendation_id"],)).fetchone()["title"] == "Publish a baby shower page"
            # the next brief carries the correction back to the agent
            from agents.diagnosis.agent import build_brief
            brief = build_brief(conn, rec["measurement_id"])
            assert any(c.get("reason") == "more specific" for c in brief.get("PAST_CORRECTIONS", []))
            assert brief["RULE_CHECK"]["cause"] in (None, "content_gap", "competitor", "unclear")

        # an edit with no editable change is refused
        bad = client.post("/api/feedback", json={"target": "recommendation", "target_id": rec["recommendation_id"],
                                                 "reviewer": "wf2-test", "decision": "edit", "changes": {"id": "x"}})
        assert bad.status_code == 400

        # approve → next action → done logs a before/after outcome
        client.post("/api/feedback", json={"target": "recommendation", "target_id": rec["recommendation_id"],
                                           "reviewer": "wf2-test", "decision": "approve"})
        with connect() as conn:
            day = conn.execute("select max(day) as d from v_answer_scores where property_id = %s", (pid,)).fetchone()["d"]
        done = client.put(f"/api/recommendations/{rec['recommendation_id']}",
                          json={"status": "done", "done_on": str(day), "window_days": 2, "reviewer": "wf2-test"})
        assert done.status_code == 200, done.text
        assert done.json()["outcome"]["done_on"] == str(day)
        logged = client.get(f"/api/outcomes/{pid}").json()
        assert any(o["recommendation_id"] == rec["recommendation_id"] for o in logged)
        assert client.get(f"/api/learning-memory/{pid}").json()
        assert any(v["step"] == "diagnosis" for v in client.get("/api/agent-versions").json())
    finally:
        _cleanup(diag_ids)


def test_insight_review_and_alert_run():
    pid = _pid()
    run = client.post(f"/api/alerts/{pid}/run")
    assert run.status_code == 200, run.text
    assert "checked" in run.json()
    client.post("/api/insights/generate", json={"property_id": pid})
    insight = client.get(f"/api/insights/{pid}").json()[0]
    r = client.post("/api/feedback", json={"target": "intelligence", "target_id": insight["id"],
                                           "reviewer": "wf2-test", "decision": "reject", "comment": "noise"})
    assert r.status_code == 200, r.text
    with connect() as conn:
        assert conn.execute("select status from intelligence where id = %s", (insight["id"],)).fetchone()["status"] == "rejected"
        conn.execute("update intelligence set status = 'draft' where id = %s", (insight["id"],))
        conn.execute("delete from learning_memory where reviewer = 'wf2-test'")
        conn.commit()


def test_report_has_deck_sections():
    pid = _pid()
    d = client.get(f"/api/report/{pid}").json()
    for key in ("lenses", "source_playbook", "prompt_set_answers", "competitive_notes", "engine_view", "alerts", "outcomes"):
        assert key in d, key
    assert {l["lens"] for l in d["lenses"]} >= {"Relevance", "Clarity", "Credibility"}
    assert all("interpretation" in o and "target" in o for o in d["overall"])
    assert all("implication" in x for x in d["neutral_vs_benchmark"])
    assert [p["source"] for p in d["source_playbook"]][0] == "Owned site"
