"""Clients (properties) shown in the workspace client picker."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import clients as service
from ..services import report_setup

router = APIRouter(prefix="/api/clients", tags=["clients"])


class ClientIn(BaseModel):
    name: str = ""
    property: str = ""
    targetAudience: str = ""
    goals: str = ""


class ClientPatch(BaseModel):
    property: str | None = None
    targetAudience: str | None = None
    goals: str | None = None


@router.get("")
def list_clients():
    return service.list_clients()


@router.post("", status_code=201)
def create_client(body: ClientIn):
    try:
        return service.create_client(body.model_dump())
    except service.DuplicateClientError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/{client_id}")
def get_client(client_id: str):
    try:
        return service.get_client(client_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.patch("/{client_id}")
def update_client(client_id: str, body: ClientPatch):
    try:
        return service.update_client(client_id, body.model_dump(exclude_none=True))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except service.DuplicateClientError as error:
        raise HTTPException(409, str(error)) from error


class Competitor(BaseModel):
    name: str
    displayName: str = ""
    aliases: list[str] = []


class Baseline(BaseModel):
    label: str = ""
    asOf: str | None = None
    detection: float
    visibility: float | None = None


class ReportSetup(BaseModel):
    shortName: str = ""
    aliases: list[str] = []
    ignoredNames: list[str] = []
    ownDomains: list[str] = []
    namedTerms: list[str] = []
    competitors: list[Competitor] = []
    baseline: Baseline | None = None
    baselineUnchanged: bool = False  # keep the saved baseline as it is


@router.get("/{client_id}/report-setup")
def get_report_setup(client_id: str):
    """The hotel's names, comparison set and baseline used by its report, with suggestions from its answers."""
    try:
        return report_setup.get_setup(client_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.put("/{client_id}/report-setup")
def save_report_setup(client_id: str, body: ReportSetup):
    try:
        return report_setup.save_setup(client_id, body.model_dump())
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
