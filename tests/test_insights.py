"""Aggregated insight generation and evidence assembly use the existing report model."""
from app.main import app
from app.db import connect
from app.insights import _evidence_package, _generate_insights, _list_insights
from fastapi.testclient import TestClient

client = TestClient(app)


def test_generate_list_and_evidence_are_idempotent_and_rollback_safe():
    with connect() as conn:
        property_row = conn.execute("select id from properties order by name limit 1").fetchone()
        span = conn.execute(
            "select min(day) as first_day, max(day) as last_day from v_answer_scores where property_id = %s",
            (property_row["id"],),
        ).fetchone()
        property_id = str(property_row["id"])
        date_from, date_to = span["first_day"], span["last_day"]
        try:
            generated = _generate_insights(conn, property_id, date_from, date_to)
            assert generated["generated"] >= 1

            rows = _list_insights(conn, property_id, date_from, date_to)
            generated_rows = [row for row in rows if row["id"] in generated["insight_ids"]]
            assert generated_rows
            assert all("detection" in row["metrics"] for row in generated_rows)

            package = _evidence_package(conn, generated_rows[0]["id"])
            assert package["insight"]["title"]
            assert package["measurement_count"] > 0
            assert package["engine_breakdown"]
            assert package["relevant_measurements"]

            repeated = _generate_insights(conn, property_id, date_from, date_to)
            assert repeated["insight_ids"] == generated["insight_ids"]
        finally:
            conn.rollback()


def test_invalid_insight_identifiers_return_http_errors():
    assert client.get("/api/insights/not-a-uuid").status_code == 404
    assert client.get("/api/insights/item/not-a-uuid/evidence").status_code == 404
    response = client.post("/api/insights/generate", json={"property_id": "not-a-uuid"})
    assert response.status_code == 400