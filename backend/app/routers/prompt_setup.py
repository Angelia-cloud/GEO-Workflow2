"""Phase 1 · Prompt: client brief + kickoff transcript → intents → prompts per engine → export."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..services import prompt_setup as service
from ..settings import llm_status

router = APIRouter(prefix="/api/prompt-setup", tags=["prompt setup"])


def _call(fn, *args, **kwargs):
    from agents.llm import LLMError
    try:
        return fn(*args, **kwargs)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except LLMError as error:
        raise HTTPException(502, f"The agent could not complete this step: {error}") from error
    except Exception as error:  # noqa: BLE001 — provider/network errors
        if type(error).__module__.split(".")[0] in ("openai", "anthropic", "httpx"):
            raise HTTPException(502, f"The LLM call failed: {error}. Check the API key in backend/.env.") from error
        raise


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


class Complete(BaseModel):
    reviewer: str
    intents: list[dict[str, Any]] | None = None
    prompts: list[dict[str, Any]] | None = None
    engineIds: list[str] | None = None


@router.get("/engines")
def engines():
    return {"engines": service.engines(), "sheetUrl": service.sheet_url()}


@router.get("/agents")
def agents():
    status = llm_status()
    return {**status, "label": "AI agents" if status["ready"] else "Rule-based agents"}


@router.post("/runs", status_code=201)
def start_run(body: RunIn):
    return _call(service.start_run, body.model_dump())


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    return _call(service.get_run, run_id)


@router.post("/runs/{run_id}/intents")
def generate_intents(run_id: str):
    return _call(service.generate_intents, run_id)


@router.patch("/runs/{run_id}/intents")
def update_intents(run_id: str, body: Updates):
    return _call(service.update_intents, run_id, body.updates, body.reviewer)


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
    return _call(service.prepare_sheet, run_id, body.engineIds)


@router.post("/runs/{run_id}/complete")
def complete(run_id: str, body: Complete):
    return _call(service.complete_run, run_id, body.model_dump())


@router.get("/runs/{run_id}/export.csv", response_class=PlainTextResponse)
def export_csv(run_id: str, engine: str | None = None):
    text = _call(service.export_csv, run_id, engine)
    name = f"rankscale-prompts{('-' + engine) if engine else ''}.csv"
    return PlainTextResponse(text, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={name}"})
