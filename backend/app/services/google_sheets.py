"""Optional Google Sheets sync for Phase 1 (Step 5).

Configure in .env:
  GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json   (or GOOGLE_SERVICE_ACCOUNT_JSON='{...}')
  GEO_PROMPT_SHEET_ID=<spreadsheet id>        share the sheet with the service account's email (Editor)
Requires `pip install google-auth requests`. Without configuration the UI shows the team's workbook link.
"""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
API = "https://sheets.googleapis.com/v4/spreadsheets"
HEADER = ["#", "Intent", "Persona / audience", "Prompt", "Confidence", "Status"]


def configured() -> bool:
    return bool(os.environ.get("GEO_PROMPT_SHEET_ID") and
                (os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE") or os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")))


def _session():
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account
    if os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        creds = service_account.Credentials.from_service_account_info(json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]), scopes=SCOPES)
    else:
        creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"], scopes=SCOPES)
    return AuthorizedSession(creds)


def write_prompt_tabs(brief: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """One tab per engine (created when missing), overwritten with the reviewed prompts."""
    if not configured():
        return None
    sheet_id = os.environ["GEO_PROMPT_SHEET_ID"]
    session = _session()
    meta = session.get(f"{API}/{sheet_id}?fields=sheets.properties").json()
    if "error" in meta:
        raise RuntimeError(meta["error"].get("message", "Google Sheets request failed"))
    tabs = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}
    by_engine: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_engine.setdefault(row["engine"], []).append(row)
    missing = [name for name in by_engine if name not in tabs]
    if missing:
        reply = session.post(f"{API}/{sheet_id}:batchUpdate", json={"requests": [
            {"addSheet": {"properties": {"title": name}}} for name in missing]}).json()
        for added in reply.get("replies", []):
            props = added["addSheet"]["properties"]
            tabs[props["title"]] = props["sheetId"]
    for engine, engine_rows in by_engine.items():
        rng = quote(f"'{engine}'!A1:F1000", safe="")
        session.post(f"{API}/{sheet_id}/values/{rng}:clear")
        values = [[f"{brief.get('property', '')} · {engine}"], HEADER] + [
            [n + 1, r["intent"], r["audience"], r["prompt"], "" if r["confidence"] is None else f"{r['confidence']}%", r["status"]]
            for n, r in enumerate(engine_rows)]
        session.put(f"{API}/{sheet_id}/values/{quote(f"'{engine}'!A1", safe='')}?valueInputOption=RAW", json={"values": values})
    base = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    from .prompt_setup import ENGINES
    names = {name: eid for eid, name, *_ in ENGINES}
    return {"sheetUrl": base, "engines": {names.get(engine, engine): f"{base}#gid={tabs[engine]}" for engine in by_engine}}
