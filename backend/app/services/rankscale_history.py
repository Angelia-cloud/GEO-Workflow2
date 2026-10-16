"""Phase 2 · Rankscale history: every answer row a client has uploaded, de-duplicated.

Upload flow (POST /api/clients/{id}/rankscale/imports):
  1. parse_rankscale_file()  — decode, detect delimiter, validate and normalise every record
                               (the same rules the original browser preview used)
  2. store_records()         — insert new rows; identical rows already saved are skipped
  3. load_measurements()     — when the file is a full Rankscale export, also load it into the
                               Workflow 2 measurement tables for this client's property and run
                               the auto-alert check (never blocks the upload)

The frontend builds its reports from the normalised records (GET /api/clients/{id}/rankscale).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from ..db import connect
from .ingest import decode

logger = logging.getLogger(__name__)

REQUIRED = ["timestamp", "query", "ai_engine", "result_text", "brand_reference"]
EMPTY = {"", "-", "n/a"}
STORAGE_MODE = "server"


class RankscaleFileError(ValueError):
    pass


def _empty(value: Any) -> bool:
    return str(value if value is not None else "").strip().lower() in EMPTY


def _hash(value: Any) -> str:
    return hashlib.sha1(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]


def _stable(fields: dict[str, str]) -> list[list[str]]:
    return [[key, fields[key]] for key in sorted(fields)]


def detect_delimiter(text: str) -> str:
    counts = {",": 0, "\t": 0, ";": 0}
    quoted = False
    i = 0
    while i < len(text):
        char = text[i]
        if char == '"':
            if quoted and i + 1 < len(text) and text[i + 1] == '"':
                i += 1
            else:
                quoted = not quoted
        elif not quoted and char in "\r\n":
            break
        elif not quoted and char in counts:
            counts[char] += 1
        i += 1
    ranked = sorted(counts.items(), key=lambda item: -item[1])
    if not ranked[0][1]:
        raise RankscaleFileError("No CSV or TSV columns found. Upload the original Rankscale export.")
    if ranked[0][1] == ranked[1][1]:
        raise RankscaleFileError("The file delimiter is ambiguous. Upload a comma- or tab-separated Rankscale export.")
    return ranked[0][0]


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2}|UTC)?$", re.I)


def parse_timestamp(value: str) -> tuple[str, str]:
    """ISO date or timestamp → (UTC ISO timestamp, UTC date). A timestamp without a zone is read as UTC."""
    text = str(value or "").strip()
    if _ISO_DATE.match(text):
        day = datetime.strptime(text, "%Y-%m-%d").date().isoformat()
        return f"{day}T00:00:00.000Z", day
    match = _ISO_TIME.match(text)
    if not match:
        raise ValueError(f"Unsupported date “{text}”. Use an ISO date or timestamp, for example 2026-09-01T10:00:00Z.")
    day, hh, mm, ss, frac, zone = match.groups()
    fraction = (frac or "0")[:6].ljust(6, "0")
    zone = (zone or "Z").upper()
    zone = "+00:00" if zone in ("Z", "UTC") else (zone if ":" in zone else f"{zone[:3]}:{zone[3:]}")
    try:
        moment = datetime.fromisoformat(f"{day}T{hh}:{mm}:{ss or '00'}.{fraction}{zone}")
    except ValueError as error:
        raise ValueError(f"Invalid date “{text}”.") from error
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z", utc.date().isoformat()


def _number(value: str, field: str, record: int, low: float | None = None, high: float | None = None,
            integer: bool = False) -> float | int | None:
    if _empty(value):
        return None
    text = str(value).strip()
    if not re.fullmatch(r"-?(?:\d+(?:\.\d*)?|\.\d+)", text):
        raise ValueError(f"Record {record}: {field} must be a valid number{' with no decimal places' if integer else ''}.")
    number = float(text)
    if (low is not None and number < low) or (high is not None and number > high) or (integer and not number.is_integer()):
        raise ValueError(f"Record {record}: {field} must be a valid number{' with no decimal places' if integer else ''}.")
    return int(number) if integer else number


def parse_rankscale_file(raw: bytes, client_id: str, source_name: str = "Rankscale export",
                         imported_at: str | None = None) -> dict[str, Any]:
    """Validate and normalise a Rankscale CSV/TSV. Raises RankscaleFileError with a plain-English message."""
    imported_at = imported_at or datetime.now(timezone.utc).isoformat()
    try:
        text, _ = decode(raw)
    except UnicodeDecodeError as error:
        raise RankscaleFileError("This file could not be read. Upload a UTF-8 or UTF-16 Rankscale CSV or TSV export.") from error
    text = text.lstrip("﻿")
    if not text.strip():
        raise RankscaleFileError("The file is empty.")
    if "\x00" in text:
        raise RankscaleFileError("This file could not be read. Upload a UTF-8 or UTF-16 Rankscale CSV or TSV export.")
    delimiter = detect_delimiter(text)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    records = [row for row in reader if any(cell.strip() for cell in row)]
    if not records:
        raise RankscaleFileError("The file is empty.")
    headers = [cell.strip().lstrip("﻿").lower() for cell in records[0]]
    if any(not h for h in headers) or len(set(headers)) != len(headers):
        raise RankscaleFileError("The file has blank or duplicate column headers.")
    missing = [column for column in REQUIRED if column not in headers]
    if missing:
        raise RankscaleFileError(f"Missing Rankscale columns: {', '.join(missing)}.")
    if len(records) < 2:
        raise RankscaleFileError("The export contains headers but no data.")

    rows = []
    for offset, cells in enumerate(records[1:]):
        number = offset + 2
        if len(cells) != len(headers):
            raise RankscaleFileError(f"Record {number} has {len(cells)} columns; expected {len(headers)}.")
        fields = dict(zip(headers, cells))
        for column in REQUIRED:
            if _empty(fields[column]):
                raise RankscaleFileError(f"Record {number}: {column} is required.")
        try:
            timestamp, day = parse_timestamp(fields["timestamp"])
        except ValueError as error:
            raise RankscaleFileError(f"Record {number}: {error}") from error
        found = (fields.get("brand_found") or "").strip().lower()
        if found and not _empty(found) and found not in ("yes", "no", "true", "false", "1", "0"):
            raise RankscaleFileError(f"Record {number}: brand_found must be yes or no.")
        try:
            rank = _number(fields.get("brand_rank"), "brand_rank", number, low=1, integer=True)
            sentiment = _number(fields.get("sentiment"), "sentiment", number, low=-1, high=1)
        except ValueError as error:
            raise RankscaleFileError(str(error)) from error
        base = {
            "clientId": str(client_id), "timestamp": timestamp, "date": day,
            "engine": fields["ai_engine"].strip(), "prompt": fields["query"].strip(),
            "answer": fields["result_text"], "brandReference": fields["brand_reference"].strip(),
        }
        rows.append({
            **base,
            "id": "rankscale-" + _hash([str(client_id), _stable(fields)]),
            "answerId": "answer-" + _hash([base["clientId"], timestamp, base["engine"], base["prompt"],
                                           base["brandReference"], base["answer"]]),
            "topic": "" if _empty(fields.get("topic_name")) else fields["topic_name"].strip(),
            "brandFound": None if _empty(found) else found in ("yes", "true", "1"),
            "brandNameMentioned": "" if _empty(fields.get("brand_name_mentioned")) else fields["brand_name_mentioned"].strip(),
            "brandRank": rank,
            "sentiment": sentiment,
            "source": {"name": source_name, "row": number, "importedAt": imported_at},
            "sourceFields": fields,
        })
    return {"rows": rows, "headers": headers, "delimiter": delimiter, "summary": summarise(rows)}


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    dates = sorted({row["date"] for row in rows})
    engines = sorted({row["engine"] for row in rows})
    return {
        "rowCount": len(rows),
        "answerCount": len({row["answerId"] for row in rows}),
        "dateFrom": dates[0] if dates else None,
        "dateTo": dates[-1] if dates else None,
        "promptCount": len({row["prompt"] for row in rows}),
        "engines": engines,
        "engineCount": len(engines),
        "clientMentionCount": len({row["answerId"] for row in rows if row.get("brandFound") is True}),
        "brandReferences": sorted({row["brandReference"] for row in rows}),
        "dates": dates,
    }


def _record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "clientId": str(row["client_id"]), "id": row["id"], "answerId": row["answer_id"],
        "timestamp": row["ts"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{row['ts'].microsecond // 1000:03d}Z",
        "date": row["day"].isoformat(), "engine": row["engine"], "prompt": row["prompt"], "answer": row["answer"],
        "brandReference": row["brand_reference"], "topic": row["topic"], "brandFound": row["brand_found"],
        "brandNameMentioned": row["brand_name_mentioned"], "brandRank": row["brand_rank"],
        "sentiment": float(row["sentiment"]) if row["sentiment"] is not None else None,
        "source": row["source"] or {}, "sourceFields": row["source_fields"] or {},
    }


def _import(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "importedAt": row["imported_at"].isoformat(), "fileName": row["file_name"],
        "importedBy": row["imported_by"], "status": row["status"], "rowsProcessed": row["rows_processed"],
        "rowsTotal": row["rows_total"], "rowsAdded": row["rows_added"], "duplicates": row["duplicates"],
        "answersAdded": row["answers_added"], "evidenceAdded": (row["follow_up"] or {}).get("evidence_added"),
        "fileSize": row["file_size"], "followUp": row["follow_up"] or {}, "storageMode": STORAGE_MODE,
    }


def _check_client(conn, client_id: str) -> None:
    try:
        uuid.UUID(str(client_id))
    except ValueError as error:
        raise LookupError("Client not found") from error
    if not conn.execute("select 1 from properties where id = %s", (client_id,)).fetchone():
        raise LookupError("Client not found")


def load_history(client_id: str, date_from: str | None = None, date_to: str | None = None,
                 include_rows: bool = True) -> dict[str, Any]:
    """Everything saved for a client. `summary` always covers the full history; rows can be date-scoped."""
    with connect() as conn:
        _check_client(conn, client_id)
        all_rows = conn.execute(
            """select client_id, id, answer_id, ts, day, engine, prompt, answer, brand_reference, topic, brand_found,
                      brand_name_mentioned, brand_rank, sentiment, source, source_fields
               from rankscale_records where client_id = %s order by ts, id""", (client_id,)).fetchall()
        imports = conn.execute("select * from rankscale_imports where client_id = %s order by imported_at desc",
                               (client_id,)).fetchall()
    records = [_record(row) for row in all_rows]
    scoped = [row for row in records if (not date_from or row["date"] >= date_from) and (not date_to or row["date"] <= date_to)]
    sources = list(dict.fromkeys(row["source"].get("name") for row in records if row["source"].get("name")))
    return {"clientId": str(client_id), "rows": scoped if include_rows else [], "sources": sources,
            "imports": [_import(row) for row in imports], "summary": summarise(records), "storageMode": STORAGE_MODE}


def store_records(client_id: str, parsed: dict[str, Any], file_name: str, imported_by: str | None,
                  file_size: int | None) -> dict[str, Any]:
    started = time.perf_counter()
    copy_seconds = duplicate_seconds = insert_seconds = 0.0
    rows = parsed["rows"]
    if any(row["clientId"] != str(client_id) for row in rows):
        raise ValueError("Rankscale data must belong to the selected client.")
    import_id = f"rankscale-import-{uuid.uuid4()}"
    with connect() as conn:
        _check_client(conn, client_id)
        conn.execute("set local statement_timeout = 0")  # large exports exceed the pooler's default timeout
        conn.execute(
            """insert into rankscale_imports (id, client_id, file_name, imported_by, status, rows_processed, rows_total, file_size)
               values (%s, %s, %s, %s, 'loaded', %s, %s, %s)""",
            (import_id, client_id, file_name, imported_by, len(rows), len(rows), file_size))
        conn.execute(
            """create temporary table rankscale_import_stage
               (like public.rankscale_records including defaults) on commit drop"""
        )
        columns = (
            "client_id", "id", "answer_id", "ts", "day", "engine", "prompt", "answer", "brand_reference",
            "topic", "brand_found", "brand_name_mentioned", "brand_rank", "sentiment", "source", "source_fields",
            "import_id",
        )
        copy_sql = "copy pg_temp.rankscale_import_stage ({}) from stdin".format(
            ", ".join(f'"{column}"' for column in columns)
        )
        # Ask which answers are already saved first, so a re-upload or overlapping export sends only new rows.
        duplicate_started = time.perf_counter()
        incoming_answers = sorted({row["answerId"] for row in rows})
        known_answers = {
            row["answer_id"]
            for row in conn.execute(
                "select distinct answer_id from public.rankscale_records where client_id = %s and answer_id = any(%s)",
                (client_id, incoming_answers),
            ).fetchall()
        }
        duplicate_seconds = time.perf_counter() - duplicate_started
        stage_started = time.perf_counter()
        with conn.cursor().copy(copy_sql) as copy:
            for row in rows:
                if row["answerId"] in known_answers:
                    continue
                copy.write_row((
                    client_id, row["id"], row["answerId"], row["timestamp"], row["date"], row["engine"],
                    row["prompt"], row["answer"], row["brandReference"], row["topic"], row["brandFound"],
                    row["brandNameMentioned"], row["brandRank"], row["sentiment"], Jsonb(row["source"]),
                    Jsonb(row["sourceFields"]), import_id,
                ))
        copy_seconds = time.perf_counter() - stage_started
        insert_started = time.perf_counter()
        inserted = conn.execute(
            """insert into public.rankscale_records
                   (client_id, id, answer_id, ts, day, engine, prompt, answer, brand_reference, topic, brand_found,
                    brand_name_mentioned, brand_rank, sentiment, source, source_fields, import_id)
               select client_id, id, answer_id, ts, day, engine, prompt, answer, brand_reference, topic, brand_found,
                      brand_name_mentioned, brand_rank, sentiment, source, source_fields, import_id
               from pg_temp.rankscale_import_stage stage
               where not exists (select 1 from public.rankscale_records saved
                                 where saved.client_id = stage.client_id and saved.answer_id = stage.answer_id)
               on conflict (client_id, id) do nothing
               returning answer_id"""
        ).fetchall()
        insert_seconds = time.perf_counter() - insert_started
        added = len(inserted)
        new_answers = {row["answer_id"] for row in inserted} - known_answers
        conn.execute("update rankscale_imports set rows_added = %s, duplicates = %s, answers_added = %s where id = %s",
                     (added, len(rows) - added, len(new_answers), import_id))
        conn.commit()
    logger.info(
        "rankscale_import_store rows=%d bytes=%d added=%d duplicates=%d copy_ms=%.1f "
        "duplicate_lookup_ms=%.1f insert_ms=%.1f total_ms=%.1f",
        len(rows), file_size or 0, added, len(rows) - added,
        copy_seconds * 1000, duplicate_seconds * 1000, insert_seconds * 1000,
        (time.perf_counter() - started) * 1000,
    )
    return {"importId": import_id, "added": added, "duplicates": len(rows) - added}


def _months_of(rows: list[dict]) -> set[str]:
    """Months (Australia/Sydney) present in the file."""
    from zoneinfo import ZoneInfo
    months: set[str] = set()
    for row in rows:
        stamp = row.get("timestamp")
        if isinstance(stamp, str):
            stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if stamp is not None:
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            months.add(stamp.astimezone(ZoneInfo("Australia/Sydney")).strftime("%Y-%m"))
    return months


def _refresh_months(client_id: str, rows: list[dict]) -> dict[str, Any]:
    """Months (Australia/Sydney) present in the file: recalculate their metrics, findings and recommendations."""
    from . import monthly
    months = _months_of(rows)
    try:
        return monthly.refresh_intelligence(client_id, sorted(months))
    except Exception as error:  # noqa: BLE001 — refresh is a follow-up and never fails the upload
        return {"refresh_error": str(error), "months": sorted(months)}


def _save_follow_up(import_id: str, result: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute("update rankscale_imports set follow_up = %s where id = %s",
                     (Jsonb(json.loads(json.dumps(result, default=str))), import_id))
        conn.commit()


def _prewarm_reports(client_id: str, rows: list[dict]) -> None:
    """Build the reports for the months in the file (newest first) so opening the report is instant."""
    from . import monthly
    from .opportunities import assess
    try:
        monthly.clear_cache(client_id)
        available = {m["month"] for m in monthly.list_months(client_id)}
        months = sorted({m for m in _months_of(rows) if m in available}, reverse=True)[:3]
        for month in months:
            monthly.cached_month_report(client_id, month)
            start, end = monthly.parse_month(month)
            assess(client_id, start, end, save=True)
    except Exception as error:  # noqa: BLE001 — warming is best effort
        logger.warning("report prewarm failed for %s: %s", client_id, error)


def import_status(client_id: str, import_id: str) -> dict[str, Any]:
    """Progress of the background measurement load for one upload."""
    try:
        uuid.UUID(str(client_id))
    except ValueError as error:
        raise LookupError("Client not found") from error
    with connect() as conn:
        row = conn.execute("select follow_up from rankscale_imports where id = %s and client_id = %s",
                           (import_id, client_id)).fetchone()
    if not row:
        raise LookupError("Import not found")
    follow_up = row["follow_up"] or {}
    status = follow_up.get("status") or ("loaded" if follow_up.get("measurements_loaded") else
                                         "failed" if follow_up.get("reason") else "pending")
    return {"id": import_id, "status": status, "followUp": follow_up}


def _already_loaded(client_id: str) -> bool:
    with connect() as conn:
        return bool(conn.execute(
            "select 1 from rankscale_imports where client_id = %s and follow_up->>'status' = 'loaded' limit 1",
            (client_id,)).fetchone())


def load_measurements(client_id: str, raw: bytes, file_name: str, imported_by: str | None, import_id: str,
                      rows_added: int | None = None) -> dict[str, Any]:
    """Feed a full Rankscale export into the Workflow 2 tables for this client's property."""
    if rows_added == 0 and _already_loaded(client_id):
        # Every row was already saved and measured by an earlier upload: nothing new to load.
        result = {"measurements_loaded": True, "status": "loaded", "intelligence": "done", "skipped": "no new rows"}
        _save_follow_up(import_id, result)
        return result
    from . import loader
    from .followups import after_load
    from .ingest import parse_rankscale
    started = time.perf_counter()
    parse_seconds = loader_seconds = followup_seconds = refresh_seconds = 0.0
    try:
        stage_started = time.perf_counter()
        rows, report = parse_rankscale(raw, file_name)
        parse_seconds = time.perf_counter() - stage_started
        if not report.ok or not rows:
            result = {"measurements_loaded": False,
                      "reason": (report.errors[0]["message"] if report.errors else "No rows to load")}
        else:
            # Every row belongs to the client the file was uploaded for, whatever its brand_reference says.
            mapped = [{"property_id": str(client_id), "prompt_id": None, "engine_id": None, "competitor_ids": {}}
                      for _ in rows]
            stage_started = time.perf_counter()
            with connect() as conn:
                with conn.transaction():
                    conn.execute("set local statement_timeout = 0")
                    conn.execute("select pg_advisory_xact_lock(%s)", (loader.LOCK_KEY,))
                    loaded = loader.load_rows_in_transaction(conn, rows, report, imported_by, mapped_rows=mapped)
                    added = loaded.get("added") or {}
                    conn.execute(
                        """insert into import_batches (id, filename, uploaded_by, status, rows_in_file, rows_valid,
                                                       rows_rejected, measurements_added, mentions_added, evidence_added, report)
                           values (%s, %s, %s, 'loaded', %s, %s, %s, %s, %s, %s, %s) on conflict (id) do nothing""",
                        (loaded["batch_id"], report.filename, imported_by, report.rows_in_file, report.rows_valid,
                         report.rows_rejected, added.get("measurements", 0), added.get("mentions", 0),
                         added.get("evidence", 0), json.dumps(report.as_dict(), default=str)))
            loader_seconds = time.perf_counter() - stage_started
            stage_started = time.perf_counter()
            result = {"measurements_loaded": True, **{k: v for k, v in loaded.items() if k != "report"},
                      **after_load(str(client_id))}
            result["evidence_added"] = (loaded.get("added") or {}).get("evidence")
            followup_seconds = time.perf_counter() - stage_started
            # The measurements are in: the report can open now. Insights, alerts and diagnoses follow.
            from . import monthly
            monthly.clear_cache(str(client_id))
            _save_follow_up(import_id, {**result, "status": "loaded", "intelligence": "running"})
            stage_started = time.perf_counter()
            result["monthly"] = _refresh_months(str(client_id), rows)
            result["intelligence"] = "done"
            refresh_seconds = time.perf_counter() - stage_started
    except Exception as error:  # noqa: BLE001 — measurements are a follow-up; never fail the upload
        result = {"measurements_loaded": False, "reason": str(error)}
    result["status"] = "loaded" if result.get("measurements_loaded") else "failed"
    _save_follow_up(import_id, result)
    if result.get("measurements_loaded"):
        _prewarm_reports(str(client_id), rows)
    logger.info(
        "rankscale_import_followup rows=%d parse_ms=%.1f measurement_load_ms=%.1f "
        "after_load_ms=%.1f monthly_refresh_ms=%.1f total_ms=%.1f",
        len(rows) if "rows" in locals() else 0,
        parse_seconds * 1000, loader_seconds * 1000, followup_seconds * 1000,
        refresh_seconds * 1000, (time.perf_counter() - started) * 1000,
    )
    return result


def import_file(client_id: str, raw: bytes, file_name: str, imported_by: str | None) -> dict[str, Any]:
    started = time.perf_counter()
    imported_at = datetime.now(timezone.utc).isoformat()
    parsed = parse_rankscale_file(raw, client_id, file_name, imported_at)
    parse_seconds = time.perf_counter() - started
    stored = store_records(client_id, parsed, file_name, imported_by, len(raw))
    logger.info(
        "rankscale_import_request rows=%d bytes=%d parse_ms=%.1f total_ms=%.1f",
        len(parsed["rows"]), len(raw), parse_seconds * 1000,
        (time.perf_counter() - started) * 1000,
    )
    latest = {
        "id": stored["importId"],
        "importedAt": imported_at,
        "fileName": file_name,
        "importedBy": imported_by,
        "status": "loaded",
        "rowsProcessed": len(parsed["rows"]),
        "rowsTotal": len(parsed["rows"]),
        "rowsAdded": stored["added"],
        "duplicates": stored["duplicates"],
        "answersAdded": None,
        "evidenceAdded": None,
        "fileSize": len(raw),
        "followUp": {"measurements_loaded": False, "status": "pending"},
        "storageMode": STORAGE_MODE,
    }
    return {
        "clientId": str(client_id),
        "rows": [],
        "sources": [file_name],
        "imports": [latest],
        "latestImport": latest,
        "summary": parsed["summary"],
        "storageMode": STORAGE_MODE,
        "added": stored["added"],
        "duplicates": stored["duplicates"],
        "followUp": latest["followUp"],
    }
