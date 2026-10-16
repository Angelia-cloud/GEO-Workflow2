"""Monthly reporting, name mappings and the data -> opportunity -> chatbot workflow.

ISOLATION: every DB write happens inside one transaction that is rolled back at teardown, so production
Supabase is never modified. Reads of the real Coogee measurements are read-only. The load test builds TEST
rows (clearly future-dated, 2030) from the first rows of a real RankScale export; they are never committed.
"""
from __future__ import annotations

import csv
import io
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pytest

from app import db, settings  # noqa: F401
from app.services import (import_review, insights, loader, monthly, name_mappings, opportunities, report,
                          report_context, workflow2)
from app.services.ingest import parse_rankscale

COOGEE = "9ff3cbe8-bbb5-4e8e-8eb0-11e0e8737e45"
EXPORT = Path.home() / "Downloads" / "Rankscale_export_multiple_search_terms_132_2026-10-12_08-51-59.csv"


class _Txn:
    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def rollback(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture()
def conn(monkeypatch):
    import psycopg
    from psycopg.rows import dict_row
    c = psycopg.connect(db.database_url(), row_factory=dict_row, autocommit=False)

    @contextmanager
    def fake():
        yield _Txn(c)

    for m in (db, monthly, import_review, loader, report, report_context, insights, workflow2, opportunities):
        monkeypatch.setattr(m, "connect", fake, raising=False)
    monthly.clear_cache()
    try:
        yield c
    finally:
        c.rollback()
        c.close()
        monthly.clear_cache()


def test_name_mappings_merge_variants_without_touching_unknown_names():
    assert name_mappings.canonical_intent(" Romance and Events ") == "Romance & Events"
    assert name_mappings.canonical_engine("Copilot") == "Bing Copilot"
    assert name_mappings.canonical_engine("Google AI Overviews") == "Google AI Overview"
    assert name_mappings.canonical_intent("Something New") == "Something New"
    assert name_mappings.canonical_engine(None) is None


def test_month_parsing_and_coverage():
    start, end = monthly.parse_month("2026-02")
    assert (start.day, end.day) == (1, 28)
    with pytest.raises(ValueError):
        monthly.parse_month("2026-13")


def test_period_trend_keeps_historical_context_and_marks_selected_windows(monkeypatch):
    months = [{"month": "2026-08"}, {"month": "2026-09"}]
    segments = monthly._trend_segments(months, date(2026, 9, 12), date(2026, 9, 20))
    assert [(a.isoformat(), b.isoformat()) for a, b, _ in segments] == [
        ("2026-08-01", "2026-08-15"),
        ("2026-08-16", "2026-08-31"),
        ("2026-09-01", "2026-09-11"),
        ("2026-09-12", "2026-09-15"),
        ("2026-09-16", "2026-09-20"),
    ]
    assert [selected for *_, selected in segments] == [False, False, False, True, True]

    # every window's figures are read in one batch and each window becomes one trend point
    def fake_run_many(_conn, statements):
        rows = []
        for sql, params in statements:
            if "min(day) as first_day" in sql:
                start, end = params[1], params[2]
                rows.append([{"first_day": start, "last_day": end, "days_with_data": (end - start).days + 1}])
            elif "competitor_groups" in sql:
                rows.append([{"name": "Coogee", "display_name": "Coogee", "answers": 5, "detection": 40.0,
                              "visibility": 30.0}])
            elif "tracked_questions" in sql:
                rows.append([{"tracked_questions": 2, "comparison_questions": 1}])
            else:
                rows.append([{"answers": 10, "detection": 50.0}])
        return rows

    monkeypatch.setattr(monthly, "run_many", fake_run_many)
    trend = monthly._period_trend(None, "property", "Other hotel", months, date(2026, 9, 12), date(2026, 9, 20))
    assert [(p["from"], p["to"], p["selected_period"]) for p in trend] == [
        (a.isoformat(), b.isoformat(), sel) for a, b, sel in segments]
    assert trend[0]["comparison"]["competitors"][0]["name"] == "Coogee"


def test_months_come_from_measurement_timestamps_and_sum_to_total(conn):
    months = monthly.list_months(COOGEE)
    keys = [m["month"] for m in months]
    assert {"2026-08", "2026-09", "2026-10"} <= set(keys)
    total = conn.execute("select count(*) n from v_answer_scores where property_id=%s", (COOGEE,)).fetchone()["n"]
    assert sum(m["answers"] for m in months) == total
    by = {m["month"]: m for m in months}
    assert by["2026-08"]["partial"] and by["2026-10"]["partial"] and not by["2026-09"]["partial"]


def test_group_by_intent_matches_unmapped_totals(conn):
    start, end = monthly.parse_month("2026-09")
    rows = monthly._group(conn, COOGEE, "intent", start, end)
    overall = monthly._group(conn, COOGEE, None, start, end)[0]
    assert sum(r["answers"] for r in rows) == overall["answers"]
    assert len({r["name"] for r in rows}) == len(rows)


def test_month_comparison_never_invents_a_baseline(conn):
    rep = monthly.month_report(COOGEE, "2026-08")
    assert rep["comparison"]["available"] is False and rep["comparison"]["reason"]
    with pytest.raises(LookupError):
        monthly.month_report(COOGEE, "2027-01")


def test_competitor_trend_uses_one_definition_for_every_month(conn):
    rep = monthly.month_report(COOGEE, "2026-10")
    assert [m["month"] for m in rep["competitor_trend"]] == ["2026-08", "2026-09", "2026-10"]
    for m in rep["competitor_trend"]:
        assert any(c["is_self"] for c in m["competitors"]) or m["competitors"]
        assert all(c["visibility"] is not None for c in m["competitors"])
    assert all(f["commercial_status"] == "Commercial validation required" for f in rep["commercial_flags"])


@pytest.mark.skipif(not EXPORT.exists(), reason="real RankScale export not on this machine")
def test_load_dedupe_monthly_bucketing_and_other_properties_unaffected(conn):
    with EXPORT.open("rb") as fh:
        text = fh.read().decode("utf-16")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    header, sample = rows[0], rows[1:9]
    for n, row in enumerate(sample):
        row[0] = f"2030-0{1 if n < 4 else 2}-1{n}T01:00:00.000Z"   # TEST timestamps in two future months
    out = io.StringIO()
    csv.writer(out, delimiter="\t").writerows([header, *sample])
    raw = out.getvalue().encode("utf-16")

    others_before = conn.execute("select count(*) n from v_answer_scores where property_id <> %s", (COOGEE,)).fetchone()["n"]
    real_before = conn.execute("select count(*) n from v_answer_scores where property_id=%s and day < '2030-01-01'",
                               (COOGEE,)).fetchone()["n"]

    def load():
        parsed, report_ = parse_rankscale(raw, "TEST_future_export.csv")
        assert report_.ok
        mapped = [{"property_id": COOGEE, "prompt_id": None, "engine_id": None, "competitor_ids": {}} for _ in parsed]
        return loader.load_rows_in_transaction(conn, parsed, report_, None, mapped_rows=mapped)

    first = load()
    assert (first["added"] or {}).get("measurements", 0) > 0
    keys = [m["month"] for m in monthly.list_months(COOGEE)]
    assert "2030-01" in keys and "2030-02" in keys and "2026-09" in keys

    second = load()   # re-uploading the same file must not add anything
    assert (second["added"] or {}).get("measurements", 0) == 0

    assert conn.execute("select count(*) n from v_answer_scores where property_id <> %s", (COOGEE,)).fetchone()["n"] == others_before
    assert conn.execute("select count(*) n from v_answer_scores where property_id=%s and day < '2030-01-01'",
                        (COOGEE,)).fetchone()["n"] == real_before


def test_end_to_end_data_to_recommendation_to_chatbot(conn):
    """Real Coogee measurements -> opportunity assessment -> chatbot context. MOCK commercial input exists only in this
    rolled-back transaction and is not hotel business data."""
    member = conn.execute("select id from team_members where is_active limit 1").fetchone()["id"]
    start, end = monthly.parse_month("2026-09")
    before = opportunities.assess(COOGEE, start, end, save=False)
    gap = next(o for o in before["opportunities"] if o["visibility"]["status"] == "gap")
    assert gap["commercial"]["status"] == "Commercial validation required" and gap["commercial"]["rank"] is None

    opportunities.save_priority(COOGEE, gap["intent_id"], member, {
        "commercial_importance": "high", "strategic_relevance": "high", "feasibility": "medium",
        "confirmation_status": "confirmed", "evidence_source": "MOCK TEST INPUT - not hotel data"})
    after = opportunities.assess(COOGEE, start, end, save=False)
    item = next(o for o in after["opportunities"] if o["intent_id"] == gap["intent_id"])
    assert item["commercial"]["status"] == "Commercially validated" and item["commercial"]["rank"] == 1
    assert item["visibility"]["gap_points"] == gap["visibility"]["gap_points"]   # visibility finding is unchanged

    ctx = report_context.build_context(COOGEE, start, end)
    texts = {t["id"]: t["text"] for t in ctx["topics"]}
    assert "September 2026" in ctx["periodLabel"] or "2026-09" in ctx["periodLabel"]
    assert gap["intent"] in texts["commercial"] and "#1" in texts["commercial"]
    assert "monthly" in texts and "2026-08" in texts["monthly"]
