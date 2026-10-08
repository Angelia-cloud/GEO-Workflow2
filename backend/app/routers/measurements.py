"""Rankscale measurement imports: validate → map → human review → save (Workflow 2, step 1)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..db import connect, fetch_all, fetch_one
from ..services import loader
from ..services.followups import after_load
from ..services.ingest import parse_rankscale
from ..settings import max_upload_mb

router = APIRouter()


@router.post("/api/imports")
async def import_rankscale(file: UploadFile = File(...),
                           dry_run: bool = Form(False),
                           uploaded_by: str | None = Form(None)):
    """Upload a Rankscale export. dry_run=true validates only (nothing is written)."""
    raw = await file.read()
    if len(raw) > max_upload_mb() * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {max_upload_mb()} MB.")
    rows, rep = parse_rankscale(raw, file.filename or "upload.csv")
    if rep.ok and rows:
        with connect() as conn:
            loader.check_brand_references(conn, rows, rep)
    if not rep.ok:
        batch = None if dry_run else loader.record_rejected(rep, uploaded_by)
        raise HTTPException(422, {"message": rep.errors[0]["message"], "batch_id": batch, "report": rep.as_dict()})
    if dry_run:
        return {"status": "validated", "report": rep.as_dict()}
    try:
        result = loader.load_rows(rows, rep, uploaded_by)
    except Exception as e:  # surface DB errors to the UI in plain words
        raise HTTPException(500, {"message": f"Loading failed and nothing was saved: {e}",
                                  "report": rep.as_dict()}) from e
    follow = {}
    for prop in fetch_all("select id from properties"):
        follow = after_load(str(prop["id"])) or follow
    return {"status": "loaded", **result, "report": rep.as_dict(), "follow_up": follow}


# ---------------------------------------------------------------------------
# Workflow 2 · Measurements — validate → map → human review → save
# ---------------------------------------------------------------------------
@router.post("/api/import-reviews")
async def create_import_review(file: UploadFile = File(...), property_id: str | None = Form(None),
                               uploaded_by: str | None = Form(None)):
    """Validate a Rankscale export and hold it for mapping review. Nothing is written to measurements."""
    from ..services.import_review import create_review
    raw = await file.read()
    if len(raw) > max_upload_mb() * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {max_upload_mb()} MB.")
    try:
        result = create_review(raw, file.filename or "upload.csv", property_id or None, uploaded_by)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if result.get("status") == "invalid":
        raise HTTPException(422, {"message": (result["validation"].get("errors") or [{"message": "File is not valid"}])[0]["message"],
                                  "report": result["validation"]})
    return result


@router.get("/api/import-reviews/{batch_id}")
def get_import_review(batch_id: str):
    from ..services.import_review import get_review
    try:
        return get_review(batch_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class MappingUpdate(BaseModel):
    property_id: str | None = None
    confirm_property: bool | None = None
    prompt_resolutions: dict[str, str] | None = None
    engine_resolutions: dict[str, str] | None = None
    competitor_resolutions: dict[str, str] | None = None
    confirm_unmatched_competitors: bool | None = None
    accept_invalid_rows: bool | None = None


@router.put("/api/import-reviews/{batch_id}/mapping")
def update_import_mapping(batch_id: str, body: MappingUpdate):
    from ..services.import_review import resolve_review
    try:
        return resolve_review(batch_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class SaveReview(BaseModel):
    confirmed: bool = False
    uploaded_by: str | None = None


@router.post("/api/import-reviews/{batch_id}/save")
def save_import_review(batch_id: str, body: SaveReview):
    from ..services.import_review import save_review
    if not body.confirmed:
        raise HTTPException(400, "Tick the confirmation before saving: the mappings will be written to Supabase.")
    try:
        result = save_review(batch_id, body.uploaded_by)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Saving failed and nothing was written: {e}") from e
    pid = (result.get("report", {}).get("mapping", {}).get("property", {}) or {}).get("selected_id")
    return {**result, "follow_up": after_load(pid)}


@router.get("/api/imports")
def list_imports(limit: int = 20):
    return fetch_all("""select id, filename, uploaded_by, status, rows_in_file, rows_valid, rows_rejected,
                               measurements_added, mentions_added, evidence_added, created_at
                        from import_batches order by created_at desc limit %s""", (limit,))


@router.get("/api/imports/{batch_id}")
def get_import(batch_id: str):
    row = fetch_one("select * from import_batches where id = %s", (batch_id,))
    if not row:
        raise HTTPException(404, "batch not found")
    return row
