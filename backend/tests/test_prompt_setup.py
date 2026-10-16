"""Phase 1 (Workflow 1): transcript extraction, evidence-backed intents, approved-only prompts, Supabase save,
and Google Sheets export. The Groq agents are stubbed; the database is the real Supabase connection."""
from __future__ import annotations

import csv
import io
import json
import uuid
import zipfile

import pytest
from fastapi.testclient import TestClient

from agents.llm import LLM
from agents.prompt_generation.schema import PromptReviews
from agents.prompt_setup.schema import ClientAnalysis, Rewrite, SetupIntents, SetupPrompts
from app.db import connect
from app.main import app
from app.services import google_sheets

client = TestClient(app)
TRANSCRIPT = (
    "Kickoff call notes. Families love the beach and ask for rooms near the pool. "
    "Couples ask about the spa and a quiet weekend away. "
    "Corporate planners want meeting rooms for a two day offsite. "
    "We also host birthday celebrations in the ballroom."
)
CALLS: list[str] = []


def _stub(system, user, schema):
    data = json.loads(user)
    CALLS.append(schema.__name__)
    if schema is ClientAnalysis:
        return {"brand_positioning": "Beachfront hotel.", "personas": ["Families"], "key_attributes": ["Beach"],
                "goals": ["More family stays"], "missing_info": []}
    if schema is SetupIntents:
        assert "CLIENT_ANALYSIS_CONTEXT" in data
        return {"intents": [
            {"intent": "Beach family holidays", "audience": "Parents with kids", "category": "family",
             "source_quotes": ["Families love the beach"]},
            {"intent": "Spa weekends", "audience": "Couples", "category": "wellness",
             "source_quotes": ["Couples ask about the spa"]},
            {"intent": "Spa weekend", "audience": "Couples", "category": "wellness", "source_quotes": ["Couples ask about the spa"]},
            {"intent": "Pickleball play", "audience": "Active guests", "category": "activities",
             "source_quotes": ["guests play pickleball every morning"]},
            {"intent": "Brand-name check", "audience": "Everyone", "category": "brand", "source_quotes": []}]}
    if schema is SetupPrompts:
        out = []
        for i in data["INTENTS"]:
            tag = i["intent"].lower()
            out += [{"intent_id": i["intent_id"], "prompt_text": f"Which hotel is best for {tag} near the beach?"},
                    {"intent_id": i["intent_id"], "prompt_text": f"Which hotel is best for {tag} near the beach?"},  # duplicate
                    {"intent_id": i["intent_id"], "prompt_text": f"Where can I book {tag} in Sydney this summer?"},
                    {"intent_id": i["intent_id"], "prompt_text": f"Top hotels in Sydney for {tag} with good reviews?"},
                    {"intent_id": i["intent_id"], "prompt_text": f"Fourth hotel option for {tag} in Sydney?"},  # over the cap
                    {"intent_id": "I99", "prompt_text": "A prompt for an intent that does not exist?"}]
        return {"prompts": out}
    if schema is PromptReviews:
        return {"reviews": [{"index": p["index"], "decision": "keep", "realism": 0.9, "intent_fit": 0.8, "measurability": 0.9,
                             "reason": "ok"} for p in data["PROMPTS"]]}
    if schema is Rewrite:
        return {"prompt_text": data["PROMPT"].rstrip("?") + " with a kids club?", "note": "added kids club"}
    raise AssertionError(schema)


@pytest.fixture
def stubbed(monkeypatch):
    stub = LLM(provider="stub", stub=_stub)
    monkeypatch.setattr("agents.prompt_setup.agent._llm", lambda llm=None: stub)
    CALLS.clear()


@pytest.fixture
def new_client():
    suffix = uuid.uuid4().hex[:8]
    created = client.post("/api/clients", json={"name": f"PS Client {suffix}", "property": f"PS Hotel {suffix}",
                                                 "targetAudience": "Families and couples", "goals": "Grow family and spa bookings"})
    assert created.status_code == 201, created.text
    yield created.json()
    with connect() as conn:
        conn.execute("delete from properties where id = %s", (created.json()["id"],))
        conn.commit()


def _start(cid, name, transcript=TRANSCRIPT):
    return client.post("/api/prompt-setup/runs", json={
        "clientId": cid, "client": name, "property": name, "targetAudience": "Families and couples",
        "goals": "More family stays", "createdBy": "test", "transcript": transcript})


def _counts(pid):
    with connect() as conn:
        return (conn.execute("select count(*) n from intents where property_id = %s", (pid,)).fetchone()["n"],
                conn.execute("select count(*) n from prompts p join intents i on i.id = p.intent_id where i.property_id = %s",
                             (pid,)).fetchone()["n"])


def _docx(paragraphs):
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def test_extract_text_from_txt_docx_pdf():
    import pymupdf
    assert client.post("/api/prompt-setup/extract", files={"file": ("n.txt", b"Hello kickoff notes")}).json()["text"] == "Hello kickoff notes"
    docx = client.post("/api/prompt-setup/extract", files={"file": ("n.docx", _docx(["First line", "Second line"]))})
    assert docx.json()["text"] == "First line\nSecond line"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Families love the beach")
    pdf = client.post("/api/prompt-setup/extract", files={"file": ("n.pdf", doc.tobytes())})
    assert "Families love the beach" in pdf.json()["text"]
    assert client.post("/api/prompt-setup/extract", files={"file": ("n.docx", b"not a zip")}).status_code == 422
    assert client.post("/api/prompt-setup/extract", files={"file": ("n.exe", b"x")}).status_code == 422
    blank = pymupdf.open()
    blank.new_page()
    assert client.post("/api/prompt-setup/extract", files={"file": ("b.pdf", blank.tobytes())}).status_code == 422


def test_transcript_needs_30_words_and_is_saved(new_client):
    short = _start(new_client["id"], new_client["property"], "test")
    assert short.status_code == 422 and "30 words" in short.json()["detail"]
    ok = _start(new_client["id"], new_client["property"])
    assert ok.status_code == 201
    with connect() as conn:
        row = conn.execute("select inputs from prompt_generation_runs where id = %s", (ok.json()["id"],)).fetchone()
    assert row["inputs"]["transcript"] == TRANSCRIPT
    assert client.post("/api/prompt-setup/runs", json={"clientId": str(uuid.uuid4()), "transcript": TRANSCRIPT, "property": "p",
                                                       "targetAudience": "a", "goals": "g"}).status_code == 404


def test_run_state_checkpoint_is_retrievable(new_client):
    run = _start(new_client["id"], new_client["property"]).json()
    assert run["step"] == 2 and run["transcript"] == TRANSCRIPT
    saved = client.patch(f"/api/prompt-setup/runs/{run['id']}/state",
                         json={"step": 1, "engineIds": ["chatgpt"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["step"] == 1 and saved.json()["engineIds"] == ["chatgpt"]
    loaded = client.get(f"/api/prompt-setup/runs/{run['id']}")
    assert loaded.status_code == 200
    assert loaded.json()["step"] == 1 and loaded.json()["engineIds"] == ["chatgpt"]
    assert client.patch(f"/api/prompt-setup/runs/{run['id']}/state", json={"step": 6}).status_code == 422
    assert client.patch(f"/api/prompt-setup/runs/{run['id']}/state", json={"engineIds": ["invalid"]}).status_code == 422


def test_empty_and_duplicate_prompts_cannot_be_approved(new_client, stubbed):
    run_id = _start(new_client["id"], new_client["property"]).json()["id"]
    base = f"/api/prompt-setup/runs/{run_id}"
    client.post(f"{base}/intents")
    assert client.patch(f"{base}/intents", json={"updates": [{"id": "I01", "status": "Approved"}]}).status_code == 200
    generated = client.post(f"{base}/prompts", json={"engineIds": ["chatgpt"]}).json()
    first, second = generated["prompts"][:2]
    empty = client.patch(f"{base}/prompts", json={"updates": [
        {"engineId": first["engineId"], "itemId": first["itemId"], "text": "", "status": "Approved"}]})
    assert empty.status_code == 422 and "wording" in empty.json()["detail"]
    duplicate = client.patch(f"{base}/prompts", json={"updates": [
        {"engineId": first["engineId"], "itemId": first["itemId"], "text": second["text"], "status": "Approved"}]})
    assert duplicate.status_code == 422 and "duplicates" in duplicate.json()["detail"]
    approved = client.patch(f"{base}/prompts", json={"updates": [
        {"engineId": first["engineId"], "itemId": first["itemId"], "status": "Approved"}]})
    assert approved.status_code == 200
    rows = list(csv.reader(client.get(f"{base}/export.csv").text.splitlines()))
    assert len(rows) == 2 and rows[1][0] == first["text"]


def test_full_flow_saves_only_approved_items(new_client, stubbed):
    pid = new_client["id"]
    run_id = _start(pid, new_client["property"]).json()["id"]
    intents = client.post(f"/api/prompt-setup/runs/{run_id}/intents").json()
    assert CALLS[:2] == ["ClientAnalysis", "SetupIntents"] and intents["analysis"]["brand_positioning"]
    labels = [i["intent"] for i in intents["items"]]
    # fabricated quote, duplicate and the no-evidence brand check are all dropped
    assert labels == ["Beach family holidays", "Spa weekends"]
    assert all(i["sourceQuotes"] for i in intents["items"])
    assert _counts(pid) == (0, 0)

    base = f"/api/prompt-setup/runs/{run_id}"
    # prompts need approved intents
    assert client.post(f"{base}/prompts", json={"engineIds": ["chatgpt"]}).status_code == 422
    # manual intents must quote the transcript exactly
    bad = client.post(f"{base}/intents/items", json={"intent": "Pickleball", "audience": "Active", "evidence": "they love pickleball"})
    assert bad.status_code == 422
    added = client.post(f"{base}/intents/items", json={"intent": "Corporate offsites", "audience": "Planners",
                                                       "evidence": "Corporate planners want meeting rooms"})
    assert added.status_code == 201 and added.json()["id"] == "I03" and added.json()["manual"]
    removed = client.post(f"{base}/intents/items", json={"intent": "Birthdays", "audience": "Hosts",
                                                         "evidence": "We also host birthday celebrations"}).json()
    assert client.delete(f"{base}/intents/{removed['id']}").status_code == 200

    client.patch(f"{base}/intents", json={"updates": [{"id": i, "status": "Approved"} for i in ("I01", "I03")], "reviewer": "test"})
    gen = client.post(f"{base}/prompts", json={"engineIds": ["chatgpt", "gemini"]}).json()
    # 2–3 per approved intent per engine, duplicates and unknown intent ids removed, I02 (unapproved) skipped
    per = {}
    for p in gen["prompts"]:
        per.setdefault((p["engineId"], p["intentId"]), []).append(p["text"])
    assert set(per) == {("chatgpt", "I01"), ("chatgpt", "I03"), ("gemini", "I01"), ("gemini", "I03")}
    assert all(len(v) == 3 and len(set(v)) == 3 for v in per.values())
    assert [p["id"] for p in gen["promptItems"]] == ["I01.1", "I01.2", "I01.3", "I03.1", "I03.2", "I03.3"]
    assert _counts(pid) == (0, 0)

    approve = lambda iid, status="Approved": client.patch(f"{base}/prompts", json={"updates": [
        {"engineId": e, "itemId": iid, "status": status} for e in ("chatgpt", "gemini")], "reviewer": "test"})
    approve("I01.1")
    # approved intent I03 has no approved prompt → validation fails and nothing is saved
    fail = client.post(f"{base}/complete", json={"reviewer": "test", "engineIds": ["chatgpt", "gemini"]})
    assert fail.status_code == 422 and "Corporate offsites" in fail.json()["detail"]
    assert _counts(pid) == (0, 0)

    redo = client.post(f"{base}/prompts/regenerate", json={"engineId": "chatgpt", "itemId": "I03.2", "text": "Meeting rooms in Sydney?",
                                                           "feedback": "add kids club"}).json()
    assert redo["text"].endswith("with a kids club?")
    assert client.delete(f"{base}/prompts/chatgpt/I03.3").status_code == 200
    assert client.delete(f"{base}/prompts/chatgpt/I03.3").status_code == 404
    client.patch(f"{base}/prompts", json={"updates": [{"engineId": "chatgpt", "itemId": "I03.2", "text": redo["text"],
                                                       "status": "Approved"}], "reviewer": "test"})
    csv_text = client.get(f"{base}/export.csv").text
    assert "intent_id" in csv_text and "I01" in csv_text and "I03" in csv_text and "Fourth hotel" not in csv_text

    done = client.post(f"{base}/complete", json={"reviewer": "test", "engineIds": ["chatgpt", "gemini"]})
    assert done.status_code == 200, done.text
    assert done.json()["intents"] == 2
    with connect() as conn:
        rows = conn.execute("""select i.name, p.prompt_text, p.status from prompts p join intents i on i.id = p.intent_id
                               where i.property_id = %s order by i.name""", (pid,)).fetchall()
    assert {r["name"] for r in rows} == {"Beach family holidays", "Corporate offsites"}
    assert all(r["status"] == "approved" for r in rows)
    assert len({r["prompt_text"] for r in rows}) == len(rows) == 2  # one row per distinct prompt, not per engine


def test_intent_cannot_be_approved_without_evidence(new_client, stubbed):
    run_id = _start(new_client["id"], new_client["property"]).json()["id"]
    client.post(f"/api/prompt-setup/runs/{run_id}/intents")
    with connect() as conn:
        run = conn.execute("select intent_map from prompt_generation_runs where id = %s", (run_id,)).fetchone()["intent_map"]
        run["items"][0]["sourceQuotes"] = []
        conn.execute("update prompt_generation_runs set intent_map = %s where id = %s", (json.dumps(run), run_id))
        conn.commit()
    res = client.patch(f"/api/prompt-setup/runs/{run_id}/intents", json={"updates": [{"id": "I01", "status": "Approved"}]})
    assert res.status_code == 422 and "evidence" in res.json()["detail"]


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def json(self):
        return self._body


class _FakeSession:
    def __init__(self):
        self.calls = []

    def _reply(self, verb, url, kw):
        self.calls.append((verb, url, kw))
        if verb == "POST" and url == google_sheets.SHEETS_API:
            return _Resp({"spreadsheetId": "created-sheet"})
        if verb == "GET" and google_sheets.SHEETS_API in url:
            return _Resp({"properties": {"title": "T"}, "sheets": [{"properties": {"title": "Sheet1", "sheetId": 0}}]})
        if url.endswith(":batchUpdate"):
            return _Resp({"replies": [{"addSheet": {"properties": {"sheetId": 77}}}]})
        return _Resp({})

    def get(self, url, **kw):
        return self._reply("GET", url, kw)

    def post(self, url, **kw):
        return self._reply("POST", url, kw)

    def put(self, url, **kw):
        return self._reply("PUT", url, kw)


def test_sheet_export_creates_once_and_prevents_duplicates(new_client, stubbed, monkeypatch):
    fake = _FakeSession()
    monkeypatch.setattr(google_sheets, "_session", lambda: fake)
    base_run = _start(new_client["id"], new_client["property"]).json()["id"]
    base = f"/api/prompt-setup/runs/{base_run}"
    client.post(f"{base}/intents")
    client.patch(f"{base}/intents", json={"updates": [{"id": "I01", "status": "Approved"}], "reviewer": "test"})
    client.post(f"{base}/prompts", json={"engineIds": ["chatgpt"]})
    assert client.post(f"{base}/sheet", json={}).status_code == 422  # nothing approved yet
    client.patch(f"{base}/prompts", json={"updates": [{"engineId": "chatgpt", "itemId": "I01.1", "status": "Approved"},
                                                      {"engineId": "chatgpt", "itemId": "I01.2", "status": "Approved"}], "reviewer": "test"})
    first = client.post(f"{base}/sheet", json={"title": "My export"}).json()
    assert first["created"] and first["rows"] == 2 and first["sheetUrl"].startswith("https://docs.google.com/spreadsheets/d/created-sheet")
    put = next(c for c in fake.calls if c[0] == "PUT")
    values = put[2]["json"]["values"]
    assert values[0][:3] == ["Intent ID", "Intent", "Prompt ID"] and values[1][0] == "I01" and values[1][1] == "Beach family holidays"
    again = client.post(f"{base}/sheet", json={"spreadsheetId": "sheet123"}).json()
    assert again["alreadyExported"] is False  # a different spreadsheet is a new export
    repeat = client.post(f"{base}/sheet", json={"spreadsheetId": "sheet123"}).json()
    assert repeat["alreadyExported"] is True and sum(1 for c in fake.calls if c[0] == "PUT") == 2
    shown = client.get(f"{base}/approved-prompts").json()
    assert len(shown["rows"]) == 2 and {r["status"] for r in shown["rows"]} == {"Approved"}
    assert {"intent", "prompt", "engine", "audience", "confidence"} <= set(shown["rows"][0])
    assert shown["sheet"]["rows"] == 2 and shown["sheet"]["spreadsheetId"] == "sheet123"


def test_sheet_export_reports_missing_credentials(new_client, stubbed, monkeypatch):
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_FILE", raising=False)
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    run_id = _start(new_client["id"], new_client["property"]).json()["id"]
    base = f"/api/prompt-setup/runs/{run_id}"
    client.post(f"{base}/intents")
    client.patch(f"{base}/intents", json={"updates": [{"id": "I01", "status": "Approved"}], "reviewer": "test"})
    client.post(f"{base}/prompts", json={"engineIds": ["chatgpt"]})
    client.patch(f"{base}/prompts", json={"updates": [{"engineId": "chatgpt", "itemId": "I01.1", "status": "Approved"}], "reviewer": "test"})
    res = client.post(f"{base}/sheet", json={})
    assert res.status_code == 503 and "not connected" in res.json()["detail"]
    assert client.get("/api/prompt-setup/sheets").json()["configured"] is False


# ---- long transcripts and imperfect quotes ------------------------------------------------------
def test_quotes_are_matched_to_the_transcript_even_when_not_copied_exactly():
    from agents.prompt_setup.quotes import Transcript
    t = Transcript("Client: Couples ask about the spa and a quiet weekend away.\nFacilitator: Anything else?")
    # curly apostrophes, lost punctuation, different casing and a dropped word still find the passage
    assert t.find("couples ask about the spa, and a quiet weekend") == "Couples ask about the spa and a quiet weekend"
    assert t.find("Couples ask about spa and a quiet weekend away") == "Couples ask about the spa and a quiet weekend away"
    # something the transcript never says is rejected
    assert t.find("guests play pickleball every morning") is None
    assert t.find("spa") is None  # too short to prove anything


def test_long_transcript_is_read_in_parts_and_merged(monkeypatch):
    from agents.prompt_setup import agent as A
    from agents.prompt_setup.schema import MergedIntents
    monkeypatch.setenv("GEO_TRANSCRIPT_CHUNK_CHARS", "4000")
    filler = "We talked about general operations and staffing for a while. " * 40
    transcript = ("Families love the beach and ask for rooms near the pool. " + filler + "\n\n"
                  + "Couples ask about the spa and a quiet weekend away. " + filler + "\n\n"
                  + "Families really love the beach in summer. " + filler)
    parts = A.split_transcript(transcript)
    assert len(parts) >= 3 and all(len(p) <= 4000 for p in parts)
    assert " ".join(" ".join(parts).split()) == " ".join(transcript.split())  # nothing is cut off
    seen = []

    def stub(system, user, schema):
        data = json.loads(user)
        if schema is SetupIntents:
            seen.append(data["TRANSCRIPT_PART"])
            text = data["TRANSCRIPT"]
            out = []
            if "Families love the beach" in text:
                out.append({"intent": "Family beach stays", "audience": "Parents", "source_quotes": ["Families love the beach"]})
            if "Couples ask about the spa" in text:
                out.append({"intent": "Spa weekends", "audience": "Couples", "source_quotes": ["couples ask about the spa"]})
            if "Families really love the beach" in text:
                out.append({"intent": "Family beach holidays", "audience": "Parents",
                            "source_quotes": ["families really love the beach in summer"]})
            return {"intents": out or [{"intent": "Staffing", "audience": "Managers", "source_quotes": ["invented quote here"]}]}
        if schema is MergedIntents:
            ids = {c["intent"]: c["id"] for c in data["CANDIDATES"]}
            return {"intents": [
                {"intent": "Family beach stays", "audience": "Parents",
                 "member_ids": [ids["Family beach stays"], ids["Family beach holidays"]]},
                {"intent": "Spa weekends", "audience": "Couples", "member_ids": [ids["Spa weekends"]]},
                {"intent": "Made up", "audience": "Nobody", "member_ids": ["C99"]}]}
        raise AssertionError(schema)

    out = A.extract_intents({"transcript": transcript, "property": "PS Hotel"}, LLM(provider="stub", stub=stub))
    assert seen[0] == f"part 1 of {len(parts)}" and len(seen) == len(parts)
    assert [i["intent"] for i in out["items"]] == ["Family beach stays", "Spa weekends"]
    assert out["items"][0]["sourceQuotes"] == ["Families love the beach", "Families really love the beach in summer"]
    assert out["parts"] == len(parts) and "read in" in out["notes"]


def test_intents_are_generated_when_the_analysis_step_fails(monkeypatch):
    from agents.llm import LLMError
    from agents.prompt_setup import agent as A

    def stub(system, user, schema):
        if schema is ClientAnalysis:
            raise LLMError("rate limited")
        return {"intents": [{"intent": "Spa weekends", "audience": "Couples", "source_quotes": ["Couples ask about the spa"]}]}

    model = LLM(provider="stub", stub=stub)
    brief = {"transcript": TRANSCRIPT, "property": "PS Hotel"}
    assert A.analyse_client(brief, model) is None
    assert A.extract_intents({**brief, "analysis": None}, model)["items"][0]["intent"] == "Spa weekends"


def test_a_second_engine_reuses_the_same_prompts(new_client, stubbed):
    pid = new_client["id"]
    run_id = _start(pid, new_client["property"]).json()["id"]
    base = f"/api/prompt-setup/runs/{run_id}"
    client.post(f"{base}/intents")
    client.patch(f"{base}/intents", json={"updates": [{"id": "I01", "status": "Approved"}], "reviewer": "test"})
    first = client.post(f"{base}/prompts", json={"engineIds": ["chatgpt"]}).json()
    writes = CALLS.count("SetupPrompts")
    second = client.post(f"{base}/prompts", json={"engineIds": ["gemini"]}).json()
    assert CALLS.count("SetupPrompts") == writes  # copied, not written again
    texts = lambda out: sorted(p["text"] for p in out["prompts"])
    assert texts(first) == texts(second) and {p["engineId"] for p in second["prompts"]} == {"gemini"}


def test_prompts_the_client_already_tracks_are_kept_rather_than_failing():
    from agents.prompt_setup import agent as A
    tracked = ["Which hotel is best for spa weekends near the beach?", "Where can I book spa weekends in Sydney this summer?"]

    def stub(system, user, schema):
        if schema is SetupPrompts:
            return {"prompts": [{"intent_id": "I01", "prompt_text": t} for t in tracked]}
        if schema is PromptReviews:
            return {"reviews": []}
        raise AssertionError(schema)

    out = A.write_prompts({"property": "PS Hotel"}, [{"id": "I01", "intent": "Spa weekends", "audience": "Couples"}],
                          tracked, LLM(provider="stub", stub=stub))
    assert sorted(p["text"] for p in out["prompts"].values()) == sorted(tracked)
