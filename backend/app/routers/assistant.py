"""'Ask this report' — answers grounded in verified Supabase measurements built on the server.

The browser sends only the question (and optional report dates). The facts the assistant answers from are
built here by app.services.report_context, so a client can never supply its own "report".
"""
from __future__ import annotations

import time
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.report_context import build_context
from ..settings import llm_status

_CACHE: dict[tuple, tuple[float, dict]] = {}
CACHE_SECONDS = 300  # building the report takes ~20 s; measurements only change on import

router = APIRouter(prefix="/api/report-assistant", tags=["report assistant"])


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    date_from: date | None = None
    date_to: date | None = None
    month: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


@router.post("/ask", status_code=410)
def ask_with_client_context():
    raise HTTPException(410, "Client-supplied report context is no longer accepted. "
                             "Use POST /api/report-assistant/{property_id}/ask, which builds verified context on the server.")


@router.get("/{property_id}/context")
def context(property_id: str, date_from: date | None = None, date_to: date | None = None, month: str | None = None):
    return _context(property_id, date_from, date_to, month)


@router.post("/{property_id}/ask")
def ask(property_id: str, body: Ask):
    ctx = _context(property_id, body.date_from, body.date_to, body.month)
    if not ctx.get("ready"):
        return {"text": "There are no verified measurements for this client yet, so I cannot answer report questions.",
                "confidence": None, "confidenceReason": "No verified measurements.", "sources": [], "supported": False,
                "mode": "none"}
    if not llm_status()["ready"]:
        return {"fallback": True, "mode": "rules", "context": ctx,
                "reason": "No LLM key is configured; the keyword matcher answers from the same server-built context."}
    from agents.llm import LLM, LLMError
    from agents.report_assistant.agent import answer
    try:
        return answer(body.question, ctx, LLM())
    except LLMError as error:
        raise HTTPException(502, f"The report assistant could not answer: {error}") from error
    except Exception as error:  # noqa: BLE001 — provider errors: let the browser use the keyword matcher
        return {"fallback": True, "mode": "rules", "context": ctx, "reason": f"The LLM call failed ({error}); using the keyword matcher."}


def _context(property_id: str, date_from: date | None, date_to: date | None, month: str | None = None) -> dict:
    try:
        uuid.UUID(property_id)
    except ValueError as error:
        raise HTTPException(404, "Client not found") from error
    if month:
        from ..services.monthly import parse_month
        try:
            date_from, date_to = parse_month(month)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    key = (property_id, date_from, date_to)
    hit = _CACHE.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    try:
        ctx = build_context(property_id, date_from, date_to)
        _CACHE[key] = (time.monotonic(), ctx)
        return ctx
    except ValueError as error:
        raise HTTPException(404, str(error)) from error
