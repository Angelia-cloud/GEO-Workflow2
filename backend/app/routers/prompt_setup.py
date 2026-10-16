"""Phase 1 · Prompt: client brief + kickoff transcript → intents → prompts per engine → export."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..services import google_sheets
from ..services import prompt_setup as service
from ..services.transcript_extract import MAX_BYTES, extract_text
from ..settings import llm_status

router = APIRouter(prefix="/api/prompt-setup", tags=["prompt setup"])


def _call(fn, *args, **kwargs):
    from agents.llm import LLMError
    try:
        return fn(*args, **kwargs)
    except google_sheets.SheetsError as error:
        raise HTTPException(503 if "not connected" in str(error) else 502, str(error)) from error
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except LLMError as error:
        raise HTTPException(502, f"The agent could not complete this step: {error}") from error
    except Exception as error:  # noqa: BLE001 — provider/network errors
        if type(error).__module__.split(".")[0] in ("openai", "anthropic", "httpx"):
            raise HTTPException(502, _provider_message(error)) from error
        raise


def _provider_message(error: Exception) -> str:
    """Say what went wrong with the LLM call in terms the reviewer can act on."""
    status = getattr(error, "status_code", None)
    name = type(error).__name__
    if status == 401 or name == "AuthenticationError":
        return "Groq rejected the API key. Check GROQ_API_KEY in backend/.env."
    if status == 429 or name == "RateLimitError":
        return ("Groq's rate limit was reached (the free plan allows about 8,000 tokens per minute). "
                "Wait a minute and try again.")
    if status == 413:
        return ("The request was too large for the Groq plan's per-minute limit. Set GEO_LLM_TPM in backend/.env "
                "to your plan's tokens-per-minute limit (or lower GEO_TRANSCRIPT_CHUNK_CHARS) and try again.")
    if name in ("APIConnectionError", "APITimeoutError", "ConnectError", "ConnectTimeout", "ReadTimeout"):
        return "Groq could not be reached. Check the internet connection and try again."
    return f"The LLM call failed: {error}"


class RunIn(BaseModel):
    clientId: str
    client: str = ""
    property: str = ""
    targetAudience: str = ""
    goals: str = ""
    transcript: str
    transcriptName: str | None = None
    createdBy: str | None = None


class Updates(BaseModel):
    updates: list[dict[str, Any]]
    reviewer: str | None = None


class RunState(BaseModel):
    engineIds: list[str] | None = None
    step: int | None = None


class PromptRequest(BaseModel):
    engineIds: list[str]
    intents: list[dict[str, Any]] | None = None


class Regenerate(BaseModel):
    engineId: str
    itemId: str
    text: str
    feedback: str
    intent: dict[str, Any] | None = None


class SheetRequest(BaseModel):
    engineIds: list[str] | None = None
    spreadsheetId: str | None = None  # empty → create a new spreadsheet
    title: str | None = None


class IntentIn(BaseModel):
    intent: str
    audience: str
    evidence: str  # exact quote from the transcript
    category: str = ""
    description: str = ""
    reviewer: str | None = None


class Complete(BaseModel):
    reviewer: str
    intents: list[dict[str, Any]] | None = None
    prompts: list[dict[str, Any]] | None = None
    engineIds: list[str] | None = None


@router.get("/engines")
def engines():
    return {"engines": service.engines()}


@router.post("/extract")
async def extract(file: UploadFile = File(...)):
    data = await file.read(MAX_BYTES + 1)
    try:
        text = extract_text(file.filename or "", data)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {"text": text, "name": file.filename, "words": len(text.split())}


@router.get("/sheets")
def sheets():
    info = google_sheets.status()
    if info["configured"]:
        info["spreadsheets"] = _call(google_sheets.list_spreadsheets)
    return info


@router.get("/agents")
def agents():
    from agents.prompt_setup.agent import transcript_chunk_chars
    status = llm_status()
    return {**status, "label": "Groq agents" if status["ready"] else "Groq not configured",
            "transcriptChunkChars": transcript_chunk_chars()}


@router.post("/runs", status_code=201)
def start_run(body: RunIn):
    return _call(service.start_run, body.model_dump())


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    return _call(service.get_run, run_id)


@router.get("/clients/{client_id}/latest-run")
def latest_run(client_id: str):
    return _call(service.latest_run_for_client, client_id)


@router.patch("/runs/{run_id}/state")
def save_run_state(run_id: str, body: RunState):
    return _call(service.save_run_state, run_id, body.model_dump(exclude_unset=True))


@router.post("/runs/{run_id}/intents")
def generate_intents(run_id: str):
    return _call(service.generate_intents, run_id)


@router.patch("/runs/{run_id}/intents")
def update_intents(run_id: str, body: Updates):
    return _call(service.update_intents, run_id, body.updates, body.reviewer)


@router.post("/runs/{run_id}/intents/items", status_code=201)
def add_intent(run_id: str, body: IntentIn):
    return _call(service.add_intent, run_id, body.model_dump(), body.reviewer)


@router.delete("/runs/{run_id}/intents/{item_id}")
def delete_intent(run_id: str, item_id: str):
    return _call(service.delete_intent, run_id, item_id)


@router.delete("/runs/{run_id}/prompts/{engine_id}/{item_id}")
def delete_prompt(run_id: str, engine_id: str, item_id: str):
    return _call(service.delete_prompt, run_id, engine_id, item_id)


@router.post("/runs/{run_id}/prompts")
def generate_prompts(run_id: str, body: PromptRequest):
    return _call(service.generate_prompts, run_id, body.engineIds, body.intents)


@router.patch("/runs/{run_id}/prompts")
def update_prompts(run_id: str, body: Updates):
    return _call(service.update_prompts, run_id, body.updates, body.reviewer)


@router.post("/runs/{run_id}/prompts/regenerate")
def regenerate(run_id: str, body: Regenerate):
    return _call(service.regenerate_prompt, run_id, body.model_dump())


@router.post("/runs/{run_id}/sheet")
def sheet(run_id: str, body: SheetRequest):
    return _call(service.prepare_sheet, run_id, body.model_dump())


@router.post("/runs/{run_id}/complete")
def complete(run_id: str, body: Complete):
    return _call(service.complete_run, run_id, body.model_dump())


@router.get("/runs/{run_id}/approved-prompts")
def approved_prompts(run_id: str, engine: str | None = None):
    return _call(service.approved_prompts, run_id, [engine] if engine else None)


@router.get("/runs/{run_id}/export.csv", response_class=PlainTextResponse)
def export_csv(run_id: str, engine: str | None = None):
    text = _call(service.export_csv, run_id, engine)
    name = f"rankscale-prompts{('-' + engine) if engine else ''}.csv"
    return PlainTextResponse(text, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={name}"})
