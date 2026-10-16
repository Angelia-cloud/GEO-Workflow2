"""Environment-driven settings shared by the routers and services."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv()  # a .env in the working directory also works

FRONTEND_DIST = Path(os.environ.get("GEO_FRONTEND_DIST", BACKEND_DIR.parent / "frontend" / "dist"))


def max_upload_mb() -> int:
    return int(os.environ.get("GEO_MAX_UPLOAD_MB", "64"))


def llm_status() -> dict:
    """Which LLM the agents use, and whether a key is configured (no key → rule-based fallbacks)."""
    provider = (os.environ.get("GEO_LLM_PROVIDER") or "groq").lower()
    keys = {"groq": "GROQ_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}
    ready = provider == "groq" and bool(os.environ.get(keys[provider]))
    from agents.llm import DEFAULT_MODELS
    return {"provider": provider, "model": os.environ.get("GEO_LLM_MODEL") or DEFAULT_MODELS.get(provider),
            "ready": ready, "mode": "ai" if ready else "rules"}
