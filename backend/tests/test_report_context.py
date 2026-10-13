"""Stage 1: verified-context checks. READ-ONLY against Supabase (no inserts/updates/deletes)."""
from __future__ import annotations

from app import settings  # noqa: F401  (loads .env)
from agents.llm import LLM
from agents.report_assistant.agent import answer
from app.db import fetch_all, fetch_one
from app.services.report_context import build_context

COOGEE = "9ff3cbe8-bbb5-4e8e-8eb0-11e0e8737e45"


def test_non_verified_batches_never_reach_the_flat_view():
    # After the Coogee reset no synthetic batch remains; the guarantee still holds if one is ever flagged.
    flagged = {r["import_batch"] for r in fetch_all(
        "select import_batch from import_batch_provenance where data_origin <> 'verified'")}
    if flagged:
        leaked = fetch_one("select count(*) n from v_measurements_flat where import_batch = any(%s)", (list(flagged),))
        assert leaked["n"] == 0


def test_verified_coogee_scope():
    row = fetch_one("""select count(*) n, count(distinct prompt_id) p, count(distinct engine) e
                       from v_measurements_flat where property_id = %s""", (COOGEE,))
    assert row["n"] == 3357 and row["e"] == 6 and row["p"] > 0   # Aug-Oct 2026 RankScale imports


def test_server_context_states_period_and_definitions():
    ctx = build_context(COOGEE)
    ids = {t["id"] for t in ctx["topics"]}
    assert {"method", "summary", "intents", "competitors", "findings", "recommendations", "commercial", "limits"} <= ids
    assert "Australia/Sydney" in ctx["periodLabel"]
    method = next(t for t in ctx["topics"] if t["id"] == "method")["text"]
    assert "Detection rate = share of answers" in method
    assert "Lantern" not in " ".join(t["text"] for t in ctx["topics"])
    assert "Detection rate" in ctx["footer"]


def test_assistant_cites_topics_and_appends_basis():
    ctx = build_context(COOGEE)
    stub = LLM(provider="stub", stub=lambda s, u, schema: {"answer": "ok", "supported": True, "topic_ids": ["summary"], "coverage": 80})
    out = answer("What is detection?", ctx, stub)
    assert out["supported"] and out["sources"][0]["id"] == "summary" and "Basis:" in out["text"]
