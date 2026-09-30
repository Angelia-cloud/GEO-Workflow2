"""Validate the staged import review and save flow using already-loaded sample observations."""
import csv
import io

from fastapi.testclient import TestClient

from app.db import connect
from app.ingest import REQUIRED, parse_rankscale
from app.main import app

client = TestClient(app)
SAMPLE = "sample_data/rankscale_export_sample.csv"


def _property_id():
    with connect() as conn:
        row = conn.execute("select id from properties where name = %s", ("InterContinental Sydney Coogee Beach",)).fetchone()
    return str(row["id"])


def _small_duplicate_export():
    with open(SAMPLE, "rb") as source:
        rows, report = parse_rankscale(source.read(), SAMPLE)
    assert report.ok and rows
    row = rows[0]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(REQUIRED)
    writer.writerow([row[field] or "" for field in REQUIRED])
    return output.getvalue().encode("utf-8"), row


def _measurement_count(property_id):
    with connect() as conn:
        return conn.execute(
            """select count(*) as count from measurements m
               join prompts p on p.id = m.prompt_id join intents i on i.id = p.intent_id
               where i.property_id = %s""", (property_id,)
        ).fetchone()["count"]


def test_sample_preview_maps_without_writing_measurements():
    property_id = _property_id()
    before = _measurement_count(property_id)
    batch_id = None
    try:
        with open(SAMPLE, "rb") as source:
            response = client.post("/api/import-reviews", files={
                "file": ("sample.csv", source, "text/csv")},
                data={"property_id": property_id, "uploaded_by": "review-test"})
        assert response.status_code == 200, response.text
        review = response.json()
        batch_id = review["batch_id"]
        assert review["validation"]["rows_valid"] == 292
        assert review["summary"]["prompts"] == 22
        assert review["summary"]["engines"] == 6
        assert review["mapping"]["property"]["status"] == "MATCHED"
        assert all(item["status"] == "MATCHED" for item in review["mapping"]["prompts"])
        assert all(item["status"] == "MATCHED" for item in review["mapping"]["engines"])
        assert review["readiness"]["unmatched_competitors"] > 0
        assert not review["readiness"]["ready"]
        resolved = client.put(f"/api/import-reviews/{batch_id}/mapping", json={"confirm_unmatched_competitors": True})
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["readiness"]["ready"]
        assert _measurement_count(property_id) == before
    finally:
        if batch_id:
            with connect() as conn:
                conn.execute("delete from import_batches where id = %s", (batch_id,))
                conn.commit()


def test_confirmed_duplicate_observation_saves_without_duplicate_measurement():
    property_id = _property_id()
    raw, source_row = _small_duplicate_export()
    before = _measurement_count(property_id)
    batch_id = None
    try:
        response = client.post("/api/import-reviews", files={
            "file": ("single-duplicate.csv", raw, "text/csv")},
            data={"property_id": property_id, "uploaded_by": "review-test"})
        assert response.status_code == 200, response.text
        review = response.json()
        batch_id = review["batch_id"]
        assert review["readiness"]["ready"]
        assert review["mapping"]["prompts"][0]["intent"] == source_row["topic_name"]
        assert review["mapping"]["engines"][0]["rankscale_code"] == source_row["ai_engine"]

        not_confirmed = client.post(f"/api/import-reviews/{batch_id}/save", json={"confirmed": False})
        assert not_confirmed.status_code == 400
        saved = client.post(f"/api/import-reviews/{batch_id}/save", json={"confirmed": True, "uploaded_by": "review-test"})
        assert saved.status_code == 200, saved.text
        result = saved.json()
        assert result["summary"]["measurements_inserted"] == 0
        assert result["summary"]["measurements_skipped"] == 1
        assert _measurement_count(property_id) == before
    finally:
        if batch_id:
            with connect() as conn:
                conn.execute("delete from import_batches where id = %s", (batch_id,))
                conn.commit()


def test_unmatched_property_and_prompt_require_resolution_then_save_by_ids():
    property_id = _property_id()
    raw, source_row = _small_duplicate_export()
    before = _measurement_count(property_id)
    changed = dict(source_row)
    changed["brand_reference"] = "Unmatched RankScale brand reference"
    changed["query"] = "Renamed RankScale question requiring human mapping"
    import csv
    import io
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=REQUIRED)
    writer.writeheader()
    writer.writerow({field: changed.get(field) or "" for field in REQUIRED})
    batch_id = None
    try:
        response = client.post("/api/import-reviews", files={
            "file": ("unmatched-mapping.csv", buffer.getvalue().encode(), "text/csv")},
            data={"property_id": property_id, "uploaded_by": "review-test"})
        assert response.status_code == 200, response.text
        review = response.json()
        batch_id = review["batch_id"]
        assert review["mapping"]["property"]["status"] == "WARNING"
        assert review["mapping"]["prompts"][0]["status"] == "UNMATCHED"
        assert not review["readiness"]["ready"]
        prompt_options = review["mapping"]["prompts"][0]["options"]
        target = next(item for item in prompt_options if item["prompt"] == source_row["query"])
        update = client.put(f"/api/import-reviews/{batch_id}/mapping", json={
            "property_id": property_id, "confirm_property": True,
            "prompt_resolutions": {review["mapping"]["prompts"][0]["key"]: target["id"]},
        })
        assert update.status_code == 200, update.text
        mapped = update.json()
        assert mapped["mapping"]["prompts"][0]["id"] == target["id"]
        assert mapped["mapping"]["prompts"][0]["intent_id"] == target["intent_id"]
        assert mapped["readiness"]["ready"]
        saved = client.post(f"/api/import-reviews/{batch_id}/save", json={"confirmed": True})
        assert saved.status_code == 200, saved.text
        assert saved.json()["summary"]["measurements_inserted"] == 0
        assert saved.json()["summary"]["measurements_skipped"] == 1
        assert _measurement_count(property_id) == before
    finally:
        if batch_id:
            with connect() as conn:
                conn.execute("delete from import_batches where id = %s", (batch_id,))
                conn.commit()
