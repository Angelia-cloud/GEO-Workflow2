"""Saved files (Settings → Imports, Prompt CSV exports, generated reports)."""
from __future__ import annotations

import json
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from ..services import library as service
from ..settings import max_upload_mb

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("")
def list_entries(client_id: str | None = None, type: str | None = None):
    return service.list_entries(client_id, type)


@router.post("")
async def save_entry(entry: str = Form(...), file: UploadFile | None = File(None), created_by: str | None = Form(None)):
    """Create or update an entry. `entry` is the JSON document; an optional file is stored with it."""
    try:
        data = json.loads(entry)
        saved = service.save_entry(data, created_by)
        if file is not None:
            raw = await file.read()
            if len(raw) > max_upload_mb() * 1024 * 1024:
                raise HTTPException(413, f"File is larger than {max_upload_mb()} MB.")
            saved = service.save_file(saved["id"], file.filename or data.get("fileName") or "upload", file.content_type, raw)
        return saved
    except json.JSONDecodeError as error:
        raise HTTPException(422, "The library entry must be JSON.") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/{entry_id}")
def get_entry(entry_id: str):
    try:
        return service.get_entry(entry_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.get("/{entry_id}/file")
def get_file(entry_id: str):
    try:
        name, content_type, content = service.get_file(entry_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    return Response(content, media_type=content_type,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: str):
    try:
        service.delete_entry(entry_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
