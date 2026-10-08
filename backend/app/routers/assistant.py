"""'Ask this report' — answers grounded in the report the user is viewing."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..settings import llm_status

router = APIRouter(prefix="/api/report-assistant", tags=["report assistant"])


class Ask(BaseModel):
    question: str
    context: dict[str, Any]


@router.post("/ask")
def ask(body: Ask):
    if not llm_status()["ready"]:
        return {"fallback": True, "mode": "rules", "reason": "No LLM key is configured; the browser's keyword matcher answers instead."}
    from agents.llm import LLM, LLMError
    from agents.report_assistant.agent import answer
    try:
        return answer(body.question, body.context, LLM())
    except LLMError as error:
        raise HTTPException(502, f"The report assistant could not answer: {error}") from error
    except Exception as error:  # noqa: BLE001 — provider errors: let the browser fall back
        return {"fallback": True, "mode": "rules", "reason": f"The LLM call failed ({error}); using the keyword matcher."}
