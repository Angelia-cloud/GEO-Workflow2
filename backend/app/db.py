"""Database access. Uses a direct Postgres connection to Supabase.

Set DATABASE_URL to the connection string from Supabase:
  Project → Connect → "Session pooler" (or "Direct connection") → URI
e.g. postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
"""
from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

try:  # pooled connections: each new Supabase connection costs several network round trips
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover — falls back to one connection per call
    ConnectionPool = None

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "db"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set — copy .env.example to .env and fill it in.")
    return url


_pool = None
_pool_url = None
_pool_lock = threading.Lock()


def _connect_kwargs(url: str) -> dict:
    kwargs = {"row_factory": dict_row, "autocommit": False}
    # Supabase's transaction pooler (port 6543) can't keep prepared statements between transactions.
    if urlparse(url).port == 6543:
        kwargs["prepare_threshold"] = None
    return kwargs


def _get_pool():
    """One small pool per process (GEO_DB_POOL=0 turns pooling off)."""
    global _pool, _pool_url
    if ConnectionPool is None or os.environ.get("GEO_DB_POOL", "1") == "0":
        return None
    url = database_url()
    if _pool is not None and _pool_url == url:
        return _pool
    with _pool_lock:
        if _pool is None or _pool_url != url:
            if _pool is not None:
                _pool.close()
            _pool = ConnectionPool(
                url, kwargs=_connect_kwargs(url), open=True,
                min_size=int(os.environ.get("GEO_DB_POOL_MIN", "1")),
                max_size=int(os.environ.get("GEO_DB_POOL_MAX", "10")),
                max_idle=float(os.environ.get("GEO_DB_POOL_IDLE_SECONDS", "240")),  # under Supabase's idle cut-off
                timeout=float(os.environ.get("GEO_DB_POOL_TIMEOUT", "60")),
                check=ConnectionPool.check_connection,  # drop connections the pooler has closed
                name="geo",
            )
            _pool_url = url
    return _pool


def close_pool() -> None:
    global _pool, _pool_url
    with _pool_lock:
        if _pool is not None:
            _pool.close()
        _pool, _pool_url = None, None


@contextmanager
def connect():
    """A connection for one unit of work: committed on success, rolled back on error.
    Connections come from a pool so requests don't pay the connection set-up each time."""
    pool = _get_pool()
    if pool is None:
        url = database_url()
        with psycopg.connect(url, **_connect_kwargs(url)) as conn:
            yield conn
        return
    with pool.connection() as conn:
        yield conn


def fetch_all(sql: str, params: dict | tuple | None = None) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql: str, params: dict | tuple | None = None) -> dict | None:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def sql_file(name: str) -> str:
    return (DB_DIR / name).read_text(encoding="utf-8")


def run_many(conn, statements: list[tuple[str, tuple | dict | None]]) -> list[list[dict]]:
    """Run independent read queries in one network round trip (psycopg pipeline mode) and return the
    rows of each, in order. Against a remote database this replaces one round trip per query with one
    for the whole batch. GEO_DB_PIPELINE=0 runs them one by one instead."""
    if not statements:
        return []
    # Only on a real connection owned by this unit of work: a wrapped connection (as in the tests, where
    # one connection is shared by several threads) runs the queries one by one.
    if os.environ.get("GEO_DB_PIPELINE", "1") != "0" and isinstance(conn, psycopg.Connection):
        try:
            with conn.pipeline():
                cursors = [conn.execute(sql, params) for sql, params in statements]
            return [cursor.fetchall() for cursor in cursors]
        except psycopg.NotSupportedError:
            pass
    return [conn.execute(sql, params).fetchall() for sql, params in statements]


import atexit  # noqa: E402

atexit.register(close_pool)
