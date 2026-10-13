"""Month-by-month reporting from verified Supabase measurements (Australia/Sydney calendar months)."""
from __future__ import annotations

import uuid

from datetime import date

from fastapi import APIRouter, HTTPException

from ..services import monthly

router = APIRouter(prefix="/api/monthly", tags=["monthly"])


def _check(property_id: str) -> None:
    try:
        uuid.UUID(property_id)
    except ValueError as error:
        raise HTTPException(404, "Client not found") from error


@router.get("/{property_id}/months")
def months(property_id: str):
    _check(property_id)
    return {"months": monthly.list_months(property_id)}


@router.get("/{property_id}/range")
def date_range(property_id: str, date_from: date, date_to: date):
    """Same report as the monthly one, for any Australia/Sydney date range."""
    _check(property_id)
    if date_from > date_to:
        raise HTTPException(422, "From date must not be later than To date.")
    try:
        return monthly.cached_range_report(property_id, date_from, date_to)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(404, str(error)) from error


@router.get("/{property_id}/{month}")
def month(property_id: str, month: str):
    _check(property_id)
    try:
        return monthly.cached_month_report(property_id, month)
    except ValueError as error:
        raise HTTPException(422 if "month must" in str(error) else 404, str(error)) from error
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
