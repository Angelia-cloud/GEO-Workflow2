"""Phase 2 · Rankscale: upload files for a client and read the saved answer history."""
from __future__ import annotations

from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from ..services import clients, library
from ..services import rankscale_history as service
from ..settings import max_upload_mb

router = APIRouter(prefix="/api/clients/{client_id}/rankscale", tags=["rankscale"])


@router.get("")
def history(client_id: str, date_from: str | None = None, date_to: str | None = None, rows: bool = True):
    try:
        return service.load_history(client_id, date_from, date_to, include_rows=rows)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


def _keep_file(entry_id: str, file_name: str, content_type: str | None, raw: bytes) -> None:
    try:
        library.save_file(entry_id, file_name, content_type or "text/csv", raw)
    except Exception:  # noqa: BLE001 — the records are saved even if the copy of the file is not
        pass


@router.get("/imports/{import_id}")
def import_status(client_id: str, import_id: str):
    """Background progress of one upload: pending → loaded (report ready) or failed."""
    try:
        return service.import_status(client_id, import_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/imports")
async def import_file(
    client_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    imported_by: str | None = Form(None),
):
    raw = await file.read()
    if len(raw) > max_upload_mb() * 1024 * 1024:
        raise HTTPException(413, f"Choose a Rankscale file smaller than {max_upload_mb()} MB.")
    try:
        file_name = file.filename or "Rankscale export"
        result = await run_in_threadpool(service.import_file, client_id, raw, file_name, imported_by)
        import_id = result["latestImport"]["id"]
        # Keep the original file in the import history, saved here rather than uploaded a second time.
        owner = clients.get_client(client_id)
        entry = library.save_entry({
            "id": f"upload-{import_id}", "type": "upload", "phase": 2, "clientId": str(client_id),
            "client": owner.get("name"), "property": owner.get("property") or owner.get("name"),
            "title": file_name, "fileName": file_name, "kind": "upload", "source": "rankscale",
            "createdBy": imported_by or "Not recorded", "status": "stored", "importId": import_id,
            "summary": {"rowCount": result["latestImport"].get("rowsProcessed")},
        }, imported_by)
        background_tasks.add_task(service.load_measurements, client_id, raw, file_name, imported_by, import_id,
                                  result.get("added"))
        background_tasks.add_task(_keep_file, entry["id"], file_name, file.content_type, raw)
        return {**result, "libraryEntryId": entry["id"]}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
