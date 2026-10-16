"""Per-client report setup: names, questions that name the hotel, comparison hotels and baseline are client
data (nothing is written into the SQL for one hotel), and saving them updates answers already loaded."""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.main import app
from app.services import monthly

client = TestClient(app)
SAMPLE_EXPORT = Path(__file__).parent.parent / "sample_data" / "rankscale_export_sample.csv"


@pytest.fixture
def loaded_client():
    suffix = uuid.uuid4().hex[:6]
    created = client.post("/api/clients", json={"name": f"Setup Client {suffix}", "property": f"Setup Hotel {suffix}"}).json()
    pid = created["id"]
    result = client.post(f"/api/clients/{pid}/rankscale/imports", files={"file": ("export.csv", SAMPLE_EXPORT.read_bytes())})
    assert result.status_code == 200, result.text
    yield pid
    with connect() as conn:
        conn.execute("delete from library_entries where client_id = %s", (pid,))
        conn.execute("delete from properties where id = %s", (pid,))
        conn.commit()


def _payload(setup: dict, **changes) -> dict:
    body = {k: setup[k] for k in ("shortName", "aliases", "ignoredNames", "ownDomains", "namedTerms", "competitors")}
    body["baseline"] = None
    body.update(changes)
    return body


def test_new_client_starts_without_coogee_setup(loaded_client):
    setup = client.get(f"/api/clients/{loaded_client}/report-setup").json()
    assert setup["competitors"] == [] and setup["namedTerms"] == [] and setup["baseline"] is None
    assert setup["aliases"] == [setup["property"]]
    # the answers suggest names and comparison hotels to choose from
    assert setup["suggestions"]["competitors"] and setup["suggestions"]["aliases"]
    report = monthly.month_report(loaded_client, "2026-09")
    assert report["competitors"] == [] and report["property"]["short_name"] == setup["property"]


def test_saving_the_setup_drives_the_report(loaded_client):
    pid = loaded_client
    setup = client.get(f"/api/clients/{pid}/report-setup").json()
    own = "InterContinental Sydney Coogee Beach"  # the sample export's own-brand name
    rival = next(s["name"] for s in setup["suggestions"]["competitors"] if s["name"] != own)
    body = _payload(setup, shortName="Setup Bay", aliases=[setup["property"], own, "Shutters*"],
                    namedTerms=["Coogee", "Randwick"], ownDomains=["https://www.example-hotel.com/rooms"],
                    competitors=[{"name": "Rival", "displayName": rival, "aliases": [rival]}],
                    baseline={"label": "Kick-off", "asOf": "2026-08-01", "detection": 40, "visibility": 35.5})
    saved = client.put(f"/api/clients/{pid}/report-setup", json=body)
    assert saved.status_code == 200, saved.text
    after = saved.json()
    assert after["ownDomains"] == ["example-hotel.com"] and after["shortName"] == "Setup Bay"
    assert after["baseline"] == {"label": "Kick-off", "asOf": "2026-08-01", "detection": 40.0, "visibility": 35.5, "derived": False}
    assert 0 < after["questions"]["neutral"] < after["questions"]["total"]  # questions naming the hotel are left out
    with connect() as conn:
        own_mentions = conn.execute("""select count(*) n from measurement_mentions mm join measurements m on m.id = mm.measurement_id
                                       join prompts p on p.id = m.prompt_id join intents i on i.id = p.intent_id
                                       where i.property_id = %s and mm.is_own_brand""", (pid,)).fetchone()["n"]
    assert own_mentions > 0  # answers already loaded now recognise the hotel's other names
    monthly.clear_cache(pid)
    report = monthly.month_report(pid, "2026-09")
    assert report["property"]["short_name"] == "Setup Bay"
    assert [c["name"] for c in report["competitors"]] == ["Rival"]
    assert report["baseline"]["label"] == "Kick-off"

    # an untouched baseline is kept; removing the comparison set removes the ranking
    kept = client.put(f"/api/clients/{pid}/report-setup", json={**body, "competitors": [], "baseline": None,
                                                                 "baselineUnchanged": True}).json()
    assert kept["baseline"]["label"] == "Kick-off" and kept["competitors"] == []
    cleared = client.put(f"/api/clients/{pid}/report-setup", json={**body, "competitors": [], "baseline": None}).json()
    assert cleared["baseline"] is None


def test_setup_is_validated(loaded_client):
    pid = loaded_client
    setup = client.get(f"/api/clients/{pid}/report-setup").json()
    bad = [
        _payload(setup, namedTerms=["ab"]),
        _payload(setup, competitors=[{"name": "A", "aliases": ["X"]}, {"name": "a", "aliases": ["Y"]}]),
        _payload(setup, aliases=["Shared Name"], competitors=[{"name": "B", "aliases": ["Shared Name"]}]),
        _payload(setup, baseline={"label": "x", "detection": 140}),
    ]
    for body in bad:
        assert client.put(f"/api/clients/{pid}/report-setup", json=body).status_code == 422
    assert client.get(f"/api/clients/{uuid.uuid4()}/report-setup").status_code == 404


def test_uploads_no_longer_reset_coogee_setup():
    with connect() as conn:
        coogee = conn.execute("select id from properties where name = 'InterContinental Sydney Coogee Beach'").fetchone()
    if not coogee:
        pytest.skip("Coogee is not set up in this database")
    pid = str(coogee["id"])
    setup = client.get(f"/api/clients/{pid}/report-setup").json()
    body = _payload(setup, aliases=setup["aliases"] + ["Coogee Test Alias"], baselineUnchanged=True)
    assert client.put(f"/api/clients/{pid}/report-setup", json=body).status_code == 200
    try:
        raw = (Path(__file__).parent / "fixtures" / "synthetic_rankscale.csv").read_bytes()
        from app.services import ingest, loader
        rows, rep = ingest.parse_rankscale(raw, "synthetic.csv")
        loader.load_rows(rows, rep, "test")
        with connect() as conn:
            aliases = conn.execute("select aliases from properties where id = %s", (pid,)).fetchone()["aliases"]
        assert "Coogee Test Alias" in aliases  # the loader used to reset Coogee's names on every upload
    finally:
        client.put(f"/api/clients/{pid}/report-setup", json={**body, "aliases": setup["aliases"]})
