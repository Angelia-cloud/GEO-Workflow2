"""Opportunity assessment (visibility gap x hotel-confirmed commercial priority)."""
from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import opportunities
from ..db import fetch_one

router = APIRouter(prefix="/api/opportunities", tags=["opportunities"])
Level = Literal["high", "medium", "low"]


class PriorityBody(BaseModel):
    user_id: str = Field(min_length=1)
    commercial_importance: Level | None = None
    revenue_potential: float | None = Field(default=None, ge=0)
    revenue_currency: str | None = Field(default=None, max_length=8)
    revenue_basis: str | None = Field(default=None, max_length=500)
    strategic_relevance: Level | None = None
    feasibility: Level | None = None
    confirmation_status: Literal["not_provided", "proposed", "confirmed"] = "proposed"
    evidence_source: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


def _id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise HTTPException(404, "Not found") from error


@router.get("/{property_id}")
def get_assessment(property_id: str, date_from: date | None = None, date_to: date | None = None, save: bool = True):
    """Defaults to the full span of verified measurements when no dates are given."""
    pid = _id(property_id)
    if date_from is None or date_to is None:
        span = fetch_one("select min(day) a, max(day) b from v_answer_scores where property_id = %s", (pid,))
        if not span or span["a"] is None:
            raise HTTPException(404, "No verified measurements for this client")
        date_from, date_to = date_from or span["a"], date_to or span["b"]
    if date_from > date_to:
        raise HTTPException(400, "date_from must not be after date_to")
    return {**opportunities.assess(pid, date_from, date_to, save=save),
            "period": {"from": date_from.isoformat(), "to": date_to.isoformat()}}


@router.get("/{property_id}/priorities")
def get_priorities(property_id: str):
    return {"priorities": opportunities.list_priorities(_id(property_id))}


@router.put("/{property_id}/priorities/{intent_id}")
def put_priority(property_id: str, intent_id: str, body: PriorityBody):
    data = body.model_dump(exclude={"user_id"})
    try:
        result = opportunities.save_priority(_id(property_id), _id(intent_id), body.user_id, data)
        from ..services import monthly
        monthly.clear_cache(_id(property_id))  # commercial flags in cached month reports are now stale
        return result
    except PermissionError as error:
        raise HTTPException(403, str(error)) from error
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
