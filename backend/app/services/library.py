"""Saved files: prompt workbooks, uploaded transcripts and Rankscale files, approved datasets,
generated reports and completed reviews. One JSON document per entry plus an optional file."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from ..db import connect

TYPES = {"sheet", "data", "review", "upload", "report"}
_META = {"id", "type", "clientId", "createdAt", "updatedAt", "fileStored", "fileName", "fileSize", "fileType",
         "fileStorageMode", "storageMode"}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _client_id(conn, entry: dict[str, Any]) -> str | None:
    """Link the entry to a client: by id first, then by client / property name."""
    candidate = entry.get("clientId") or entry.get("client_id")
    if candidate:
        try:
            uuid.UUID(str(candidate))
            if conn.execute("select 1 from properties where id = %s", (str(candidate),)).fetchone():
                return str(candidate)
        except ValueError:
            pass
    for name in (entry.get("property"), entry.get("propertyName"), entry.get("client")):
        if isinstance(name, str) and name.strip():
            row = conn.execute(
                """select id from properties where lower(name) = lower(%(n)s) or lower(client_name) = lower(%(n)s)
                   or lower(%(n)s) = any(select lower(a) from unnest(aliases) a) limit 1""",
                {"n": name.strip()}).fetchone()
            if row:
                return str(row["id"])
    return None


def _to_entry(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row["data"] or {})
    entry = {**data, "id": row["id"], "type": row["type"], "createdAt": data.get("createdAt") or _iso(row["created_at"]),
             "updatedAt": _iso(row["updated_at"]), "storageMode": "server"}
    if row.get("client_id"):
        entry["clientId"] = data.get("clientId") or str(row["client_id"])
    if row.get("file_name"):
        entry.update(fileStored=True, fileName=row["file_name"], fileSize=row["size_bytes"],
                     fileType=row["content_type"], fileStorageMode="server")
    return entry


_SELECT = """select e.id, e.type, e.client_id, e.data, e.created_at, e.updated_at,
                    f.file_name, f.size_bytes, f.content_type
             from library_entries e left join library_files f on f.entry_id = e.id"""


def list_entries(client_id: str | None = None, entry_type: str | None = None) -> list[dict[str, Any]]:
    where, params = [], {}
    if client_id:
        where.append("e.client_id = %(client)s")
        params["client"] = client_id
    if entry_type:
        where.append("e.type = %(type)s")
        params["type"] = entry_type
    sql = _SELECT + (" where " + " and ".join(where) if where else "") + " order by e.created_at desc"
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_to_entry(row) for row in rows]


def get_entry(entry_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(_SELECT + " where e.id = %s", (entry_id,)).fetchone()
    if not row:
        raise LookupError("Library entry not found")
    return _to_entry(row)


def save_entry(entry: dict[str, Any], created_by: str | None = None) -> dict[str, Any]:
    if not isinstance(entry, dict) or entry.get("type") not in TYPES:
        raise ValueError("Choose a valid library record type.")
    entry_id = str(entry.get("id") or f"geo-{entry['type']}-{uuid.uuid4().hex[:12]}")
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,200}", entry_id):
        raise ValueError("Library ids may only use letters, numbers, dots, dashes and colons.")
    now = datetime.now(timezone.utc).isoformat()
    data = {key: value for key, value in entry.items() if key not in _META and key not in ("file", "blob")}
    with connect() as conn:
        current = conn.execute("select data, created_at from library_entries where id = %s", (entry_id,)).fetchone()
        merged = {**(current["data"] if current else {}), **data}
        merged["createdAt"] = entry.get("createdAt") or merged.get("createdAt") or (current and _iso(current["created_at"])) or now
        client_id = _client_id(conn, {**merged, "clientId": entry.get("clientId")})
        if entry.get("clientId"):
            merged["clientId"] = str(entry["clientId"])
        conn.execute(
            """insert into library_entries (id, type, client_id, data, created_by) values (%s, %s, %s, %s, %s)
               on conflict (id) do update set type = excluded.type, client_id = excluded.client_id,
                     data = excluded.data, updated_at = now()""",
            (entry_id, entry["type"], client_id, Jsonb(json.loads(json.dumps(merged, default=str))),
             created_by or merged.get("createdBy")),
        )
        conn.commit()
    return get_entry(entry_id)


def save_file(entry_id: str, file_name: str, content_type: str | None, content: bytes) -> dict[str, Any]:
    with connect() as conn:
        if not conn.execute("select 1 from library_entries where id = %s", (entry_id,)).fetchone():
            raise LookupError("Library entry not found")
        conn.execute(
            """insert into library_files (entry_id, file_name, content_type, size_bytes, content)
               values (%s, %s, %s, %s, %s)
               on conflict (entry_id) do update set file_name = excluded.file_name, content_type = excluded.content_type,
                     size_bytes = excluded.size_bytes, content = excluded.content, uploaded_at = now()""",
            (entry_id, file_name or "upload", content_type, len(content), content),
        )
        conn.commit()
    return get_entry(entry_id)


def get_file(entry_id: str) -> tuple[str, str, bytes]:
    with connect() as conn:
        row = conn.execute("select file_name, content_type, content from library_files where entry_id = %s",
                           (entry_id,)).fetchone()
    if not row:
        raise LookupError("No file is stored for this entry")
    return row["file_name"], row["content_type"] or "application/octet-stream", bytes(row["content"])


def delete_entry(entry_id: str) -> None:
    with connect() as conn:
        if not conn.execute("delete from library_entries where id = %s", (entry_id,)).rowcount:
            raise LookupError("Library entry not found")
        conn.commit()
