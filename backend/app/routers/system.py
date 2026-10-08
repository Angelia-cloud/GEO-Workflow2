"""Health, agent status and the team accounts shown on the sign-in screen."""
from __future__ import annotations

from fastapi import APIRouter

from ..db import fetch_all, fetch_one
from ..settings import llm_status

router = APIRouter(tags=["system"])


@router.get("/api/health")
def health():
    row = fetch_one("select count(*) as properties from properties")
    return {"ok": True, **row, "llm": llm_status()}


@router.get("/api/team")
def team():
    rows = fetch_all("select id, name, role, initials from team_members where is_active order by created_at, name")
    for row in rows:
        row["initials"] = row["initials"] or "".join(part[0] for part in row["name"].split()[:2]).upper()
    return rows
