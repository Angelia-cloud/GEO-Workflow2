"""Opportunity assessment tests.

ISOLATION: all DB work runs in one transaction that is rolled back, so nothing is committed to Supabase.
Visibility figures come from the REAL Coogee RankScale measurements (read-only). The commercial priorities
used here are MOCK TEST INPUTS, created inside the rolled-back transaction; they are not hotel business data.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

import pytest

from app import db, settings  # noqa: F401
from app.services import opportunities, report, report_context

COOGEE = "9ff3cbe8-bbb5-4e8e-8eb0-11e0e8737e45"


class _Txn:
    """Shares one connection; commit/close are no-ops so every write stays in the rolled-back transaction."""
    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def rollback(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)

START, END = date(2026, 9, 1), date(2026, 9, 30)


@pytest.fixture()
def conn(monkeypatch):
    import psycopg
    from psycopg.rows import dict_row
    c = psycopg.connect(db.database_url(), row_factory=dict_row, autocommit=False)

    @contextmanager
    def fake():
        yield _Txn(c)

    for m in (db, opportunities, report, report_context):
        monkeypatch.setattr(m, "connect", fake, raising=False)
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def _member(c):
    r = c.execute("select id from team_members where is_active limit 1").fetchone()
    assert r, "needs an active team member"
    return r["id"]


def _by_intent(result):
    return {o["intent"]: o for o in result["opportunities"]}


def test_without_priorities_everything_requires_validation_and_nothing_is_ranked(conn):
    c = conn.execute("delete from intent_business_priorities where property_id=%s", (COOGEE,))
    res = opportunities.assess(COOGEE, START, END, save=False)
    assert res["opportunities"]
    for o in res["opportunities"]:
        assert o["commercial"]["status"] == opportunities.VALIDATION_REQUIRED
        assert o["commercial"]["rank"] is None and o["commercial"]["priority"] is None
    gaps = [o for o in res["opportunities"] if o["visibility"]["status"] == "gap"]
    assert gaps and all(o["visibility"]["kind"] == "verified_rankscale_finding" for o in gaps)
    assert all(o["proposed_action"] is None or o["proposed_action"]["kind"] == "potential_geo_improvement" for o in gaps)


def test_visibility_gap_matches_real_measurements(conn):
    res = opportunities.assess(COOGEE, START, END, save=False)
    for o in res["opportunities"]:
        v = o["visibility"]
        if v["status"] == "gap":
            assert v["gap_points"] == pytest.approx(v["top_competitor_visibility"] - v["hotel_visibility"], abs=0.02)
            assert v["answers"] >= opportunities.MIN_NEUTRAL_ANSWERS
            assert o["evidence"]["engines"] and o["evidence"]["prompts"]


def test_unconfirmed_or_incomplete_priority_is_not_ranked(conn):
    uid = _member(conn)
    iid = opportunities.list_priorities(COOGEE)[0]["intent_id"]
    opportunities.save_priority(COOGEE, iid, uid, {"commercial_importance": "high", "confirmation_status": "proposed"})
    o = [x for x in opportunities.assess(COOGEE, START, END, save=False)["opportunities"] if x["intent_id"] == iid][0]
    assert o["commercial"]["status"] == opportunities.VALIDATION_REQUIRED
    assert "client_confirmation" in o["commercial"]["missing"] and o["commercial"]["rank"] is None


def test_confirmed_priority_is_ranked_and_saved_with_evidence(conn):
    uid = _member(conn)
    conn.execute("delete from intent_business_priorities where property_id=%s", (COOGEE,))
    base = {"commercial_importance": "high", "strategic_relevance": "medium", "feasibility": "high",
            "confirmation_status": "confirmed", "evidence_source": "MOCK TEST INPUT - not hotel data"}
    pri = opportunities.list_priorities(COOGEE)
    for p in pri:
        opportunities.save_priority(COOGEE, p["intent_id"], uid, base)
    res = opportunities.assess(COOGEE, START, END, save=True)
    ranked = [o for o in res["opportunities"] if o["commercial"]["rank"]]
    gaps = [o for o in res["opportunities"] if o["visibility"]["status"] == "gap"]
    assert len(ranked) == len(gaps) and gaps
    assert [o["commercial"]["rank"] for o in ranked] == list(range(1, len(ranked) + 1))
    scores = [o["commercial"]["rank_score"] for o in ranked]
    assert scores == sorted(scores, reverse=True)
    saved = conn.execute("select count(*) n from opportunity_assessments where property_id=%s and period_start=%s",
                         (COOGEE, START)).fetchone()["n"]
    assert saved == len(res["opportunities"])
    row = conn.execute("select evidence, priority_snapshot from opportunity_assessments where property_id=%s and priority_rank=1",
                       (COOGEE,)).fetchone()
    assert row["evidence"]["engines"] and row["priority_snapshot"]["evidence_source"].startswith("MOCK")
    assert conn.execute("select count(*) n from intent_business_priority_history").fetchone()["n"] >= len(pri)


def test_validation_rules(conn):
    uid, iid = _member(conn), opportunities.list_priorities(COOGEE)[0]["intent_id"]
    with pytest.raises(PermissionError):
        opportunities.save_priority(COOGEE, iid, "no-such-user", {"confirmation_status": "proposed"})
    with pytest.raises(ValueError):
        opportunities.save_priority(COOGEE, iid, uid, {"confirmation_status": "confirmed", "commercial_importance": "high"})
    with pytest.raises(ValueError):
        opportunities.save_priority(COOGEE, iid, uid, {"revenue_potential": 1000, "confirmation_status": "proposed"})
    with pytest.raises(ValueError):
        opportunities.save_priority(COOGEE, iid, uid, {"commercial_importance": "huge"})
    with pytest.raises(LookupError):
        opportunities.save_priority(COOGEE, "00000000-0000-0000-0000-000000000000", uid, {})


def test_chatbot_context_reports_commercial_status(conn):
    ctx = report_context.build_context(COOGEE, START, END)
    topic = [t for t in ctx["topics"] if t["id"] == "commercial"][0]
    assert "Commercial validation required" in topic["text"] or "Commercially validated" in topic["text"]
    assert "not stored" in topic["text"]
