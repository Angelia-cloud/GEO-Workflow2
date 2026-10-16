"""Google Sheets export for Phase 1 (Step 5), using a service account.

Configure in backend/.env:
  GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json   (or GOOGLE_SERVICE_ACCOUNT_JSON='{...}')
  GEO_SHEET_PUBLIC=reader | writer | off   (optional; who may open spreadsheets this app creates via the link.
                                            Default reader. "off" keeps them private to the shared accounts.)
Enable the Google Sheets API and Google Drive API for the service account's project. To use an existing
spreadsheet, share it with the service account's email as Editor.
"""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
DRIVE_API = "https://www.googleapis.com/drive/v3"
TAB = "Prompts"
HEADER = ["Intent ID", "Intent", "Prompt ID", "Engine", "Audience", "Prompt", "Confidence", "Status"]


class SheetsError(RuntimeError):
    pass


def _info() -> dict[str, Any] | None:
    if os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        return json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return None


def status() -> dict[str, Any]:
    info = _info()
    return {"configured": bool(info), "serviceAccount": (info or {}).get("client_email"),
            "message": "" if info else "Google Sheets is not connected. Set GOOGLE_SERVICE_ACCOUNT_FILE in backend/.env."}


def _session():
    info = _info()
    if not info:
        raise SheetsError("Google Sheets is not connected. Set GOOGLE_SERVICE_ACCOUNT_FILE (or GOOGLE_SERVICE_ACCOUNT_JSON) in backend/.env.")
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account
    return AuthorizedSession(service_account.Credentials.from_service_account_info(info, scopes=SCOPES))


def _check(response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        message = (body.get("error") or {}).get("message") or f"HTTP {response.status_code}"
        raise SheetsError(f"Google API error: {message}")
    return body


def _url(spreadsheet_id: str, gid: int | None = None) -> str:
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit" + (f"#gid={gid}" if gid is not None else "")


def list_spreadsheets() -> list[dict[str, str]]:
    session = _session()
    body = _check(session.get(f"{DRIVE_API}/files", params={
        "q": "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        "fields": "files(id,name,modifiedTime)", "orderBy": "modifiedTime desc", "pageSize": 50,
        "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}))
    return [{"id": f["id"], "name": f["name"], "url": _url(f["id"])} for f in body.get("files", [])]


def create_spreadsheet(title: str) -> dict[str, str]:
    session = _session()
    body = _check(session.post(SHEETS_API, json={"properties": {"title": title[:200]}}))
    spreadsheet_id = body["spreadsheetId"]
    access = (os.environ.get("GEO_SHEET_PUBLIC") or "reader").lower()
    if access in ("reader", "writer"):  # anyone with the link, no sign-in or access request
        _check(session.post(f"{DRIVE_API}/files/{spreadsheet_id}/permissions",
                            json={"type": "anyone", "role": access, "allowFileDiscovery": False}))
    return {"id": spreadsheet_id, "url": _url(spreadsheet_id)}


def _drop_empty_default_tab(session, spreadsheet_id: str, tabs: dict[str, int]) -> None:
    """Remove Google's blank default "Sheet1" so the workbook only shows the prompts. Never touches a tab that has data."""
    if "Sheet1" not in tabs or len(tabs) < 2:
        return
    body = _check(session.get(f"{SHEETS_API}/{spreadsheet_id}/values/Sheet1"))
    if body.get("values"):
        return
    _check(session.post(f"{SHEETS_API}/{spreadsheet_id}:batchUpdate",
                        json={"requests": [{"deleteSheet": {"sheetId": tabs["Sheet1"]}}]}))
    tabs.pop("Sheet1")


def write_prompts(spreadsheet_id: str, brief: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Overwrite the "Prompts" tab with the approved prompts, so re-exporting never duplicates rows."""
    session = _session()
    meta = _check(session.get(f"{SHEETS_API}/{spreadsheet_id}", params={"fields": "properties.title,sheets.properties"}))
    tabs = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}
    if TAB not in tabs:
        reply = _check(session.post(f"{SHEETS_API}/{spreadsheet_id}:batchUpdate",
                                    json={"requests": [{"addSheet": {"properties": {"title": TAB}}}]}))
        tabs[TAB] = reply["replies"][0]["addSheet"]["properties"]["sheetId"]
    _check(session.post(f"{SHEETS_API}/{spreadsheet_id}/values/{quote(TAB, safe='')}:clear", json={}))
    values = [HEADER] + [[r["intentId"], r["intent"], r["promptId"], r["engine"], r["audience"], r["prompt"],
                          "" if r["confidence"] is None else f"{r['confidence']}%", r["status"]] for r in rows]
    _check(session.put(f"{SHEETS_API}/{spreadsheet_id}/values/{quote(TAB + '!A1', safe='')}",
                       params={"valueInputOption": "RAW"}, json={"values": values}))
    _drop_empty_default_tab(session, spreadsheet_id, tabs)
    return {"spreadsheetId": spreadsheet_id, "title": meta["properties"]["title"], "sheetUrl": _url(spreadsheet_id, tabs[TAB]),
            "tab": TAB}
