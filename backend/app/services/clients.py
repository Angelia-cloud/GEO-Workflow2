"""Clients shown in the workspace header. A client is a row in `properties` plus the brief fields
(client / team name, target audience and goals) that Phase 1 collects."""
from __future__ import annotations

import re
import uuid
from typing import Any

from ..db import connect

MAX_NAME, MAX_AUDIENCE, MAX_GOALS = 180, 2000, 4000


class DuplicateClientError(ValueError):
    pass


def _key(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _row_to_client(row: dict[str, Any]) -> dict[str, Any]:
    name = row.get("client_name") or row["name"]
    return {
        "id": str(row["id"]),
        "name": name,
        "property": row["name"],
        "team": row.get("team_name") or name,
        "detail": row["name"],
        "targetAudience": row.get("target_audience") or "",
        "goals": row.get("goals") or "",
        "aliases": row.get("aliases") or [],
        "website": row.get("website_url"),
        "location": row.get("location"),
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
        "hasMeasurements": bool(row.get("has_measurements")),
        "storageMode": "server",
    }


_SELECT = """
    select p.id, p.name, p.client_name, p.team_name, p.target_audience, p.goals, p.aliases, p.website_url,
           p.location, p.created_at,
           exists (select 1 from intents i join prompts pr on pr.intent_id = i.id
                   join measurements m on m.prompt_id = pr.id where i.property_id = p.id) as has_measurements
    from properties p"""


def list_clients() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(_SELECT + " order by lower(coalesce(p.client_name, p.name))").fetchall()
    return [_row_to_client(row) for row in rows]


def get_client(client_id: str) -> dict[str, Any]:
    try:
        uuid.UUID(str(client_id))
    except ValueError as error:
        raise LookupError("Client not found") from error
    with connect() as conn:
        row = conn.execute(_SELECT + " where p.id = %s", (client_id,)).fetchone()
    if not row:
        raise LookupError("Client not found")
    return _row_to_client(row)


def _clean(data: dict[str, Any]) -> dict[str, str]:
    return {
        "name": " ".join(str(data.get("name") or "").split()),
        "property": " ".join(str(data.get("property") or "").split()),
        "targetAudience": str(data.get("targetAudience") or "").strip(),
        "goals": str(data.get("goals") or "").strip(),
    }


def create_client(data: dict[str, Any]) -> dict[str, Any]:
    values = _clean(data)
    if not values["name"]:
        raise ValueError("Enter a client or team name.")
    if not values["property"]:
        raise ValueError("Enter a property name.")
    if len(values["name"]) > MAX_NAME or len(values["property"]) > MAX_NAME:
        raise ValueError("Keep client and property names within 180 characters.")
    if len(values["targetAudience"]) > MAX_AUDIENCE or len(values["goals"]) > MAX_GOALS:
        raise ValueError("Keep the audience within 2,000 characters and goals within 4,000 characters.")
    with connect() as conn:
        existing = conn.execute("select client_name, name from properties").fetchall()
        if any(_key(row["client_name"] or row["name"]) == _key(values["name"]) for row in existing):
            raise DuplicateClientError("A client with this name already exists. Choose it from the client list or use a different name.")
        if any(_key(row["name"]) == _key(values["property"]) for row in existing):
            raise DuplicateClientError("A property with this name already exists. Choose its client from the client list.")
        row = conn.execute(
            """insert into properties (name, aliases, client_name, team_name, target_audience, goals)
               values (%s, %s, %s, %s, %s, %s) returning id""",
            (values["property"], [values["property"]], values["name"], values["name"],
             values["targetAudience"], values["goals"]),
        ).fetchone()
        conn.commit()
    return get_client(str(row["id"]))


def update_client(client_id: str, data: dict[str, Any]) -> dict[str, Any]:
    current = get_client(client_id)
    updates: dict[str, str] = {}
    if isinstance(data.get("targetAudience"), str):
        updates["target_audience"] = data["targetAudience"].strip()[:MAX_AUDIENCE]
    if isinstance(data.get("goals"), str):
        updates["goals"] = data["goals"].strip()[:MAX_GOALS]
    if isinstance(data.get("property"), str):
        name = " ".join(data["property"].split())
        if name and name != current["property"]:
            with connect() as conn:
                clash = conn.execute("select 1 from properties where lower(name) = lower(%s) and id <> %s",
                                     (name, client_id)).fetchone()
            if clash:
                raise DuplicateClientError("A property with this name already exists.")
            updates["name"] = name[:MAX_NAME]
    if not updates:
        return current
    sets = ", ".join(f"{column} = %({column})s" for column in updates)
    with connect() as conn:
        conn.execute(f"update properties set {sets} where id = %(id)s", {**updates, "id": client_id})
        if "name" in updates:  # keep the new property name as an alias so its answers still match
            conn.execute("update properties set aliases = array_append(aliases, name) "
                         "where id = %s and not (name = any(aliases))", (client_id,))
        conn.commit()
    return get_client(client_id)
