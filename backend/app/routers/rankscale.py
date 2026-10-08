"""Phase 2 · Rankscale: upload files for a client and read the saved answer history."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..services import rankscale_history as service
from ..settings import max_upload_mb

router = APIRouter(prefix="/api/clients/{client_id}/rankscale", tags=["rankscale"])


@router.get("")
def history(client_id: str, date_from: str | None = None, date_to: str | None = None, rows: bool = True):
    try:
        return service.load_history(client_id, date_from, date_to, include_rows=rows)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/imports")
async def import_file(client_id: str, file: UploadFile = File(...), imported_by: str | None = Form(None)):
    raw = await file.read()
    if len(raw) > max_upload_mb() * 1024 * 1024:
        raise HTTPException(413, f"Choose a Rankscale file smaller than {max_upload_mb()} MB.")
    try:
        return service.import_file(client_id, raw, file.filename or "Rankscale export", imported_by)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
