"""Documented read-time mappings for duplicate intent and engine names (see docs/name_mappings.md).

Raw measurements, intents and engines are never modified. Reports group rows by the canonical name below,
so a spelling variant (e.g. "Romance and events") is counted with its canonical intent instead of appearing as
a separate row. Matching is case-insensitive and ignores surrounding whitespace; anything not listed is left as is.
"""
from __future__ import annotations

INTENT_ALIASES: dict[str, str] = {
    "romance and events": "Romance & Events",
    "romance & events": "Romance & Events",
    "business / bleisure": "Business / Bleisure",
    "business/bleisure": "Business / Bleisure",
    "business and bleisure": "Business / Bleisure",
    "wellness and spa": "Wellness & Spa",
    "wellness & spa": "Wellness & Spa",
    "dining led discovery": "Dining-Led Discovery",
    "dining-led discovery": "Dining-Led Discovery",
    "luxury coastal stay": "Luxury Coastal Stay",
    "family stays": "Family Stays",
}

ENGINE_ALIASES: dict[str, str] = {
    "google ai overview": "Google AI Overview",
    "google ai overviews": "Google AI Overview",
    "ai overview": "Google AI Overview",
    "ai overviews": "Google AI Overview",
    "bing copilot": "Bing Copilot",
    "copilot": "Bing Copilot",
    "microsoft copilot": "Bing Copilot",
    "chatgpt": "ChatGPT",
    "chat gpt": "ChatGPT",
    "openai chatgpt": "ChatGPT",
    "claude": "Claude",
    "anthropic claude": "Claude",
    "gemini": "Gemini",
    "google gemini": "Gemini",
    "perplexity": "Perplexity",
    "perplexity ai": "Perplexity",
}


def _key(name: str | None) -> str:
    return " ".join((name or "").lower().split())


def canonical_intent(name: str | None) -> str | None:
    return INTENT_ALIASES.get(_key(name), name)


def canonical_engine(name: str | None) -> str | None:
    return ENGINE_ALIASES.get(_key(name), name)


def sql_map(kind: str) -> tuple[str, list[str]]:
    """A VALUES list of (alias, canonical) pairs and its parameters, for joining in SQL."""
    table = INTENT_ALIASES if kind == "intent" else ENGINE_ALIASES
    pairs = list(table.items())
    return ", ".join(["(%s, %s)"] * len(pairs)), [x for pair in pairs for x in pair]
