"""Phase 1 · Prompt agents.

    Intent Agent    brief + kickoff transcript      → shared intents (intent + audience)
    Prompt Writer   one question per intent          → the prompt tracked on every selected engine
    Prompt QA       automatic checks + LLM review     → confidence score shown in the review table
    Rewriter        reviewer feedback on one prompt   → a new draft (scored again)

With an LLM configured (GEO_LLM_PROVIDER + key) the agents call it; otherwise the rule-based
fallbacks in rules.py run, and every result says which mode produced it.
"""
from __future__ import annotations

import json
import os
from typing import Any

from agents.llm import LLM
from agents.prompt_generation.pipeline import auto_checks
from agents.prompt_generation.schema import DraftPrompt, PromptReviews

from . import prompts as P
from . import rules
from .schema import Rewrite, SetupIntents, SetupPrompts


def llm_ready() -> bool:
    provider = (os.environ.get("GEO_LLM_PROVIDER") or "groq").lower()
    key = {"groq": "GROQ_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}.get(provider)
    return provider == "stub" or bool(key and os.environ.get(key))


def _llm(llm: LLM | None) -> LLM | None:
    if llm is not None:
        return llm
    return LLM() if llm_ready() else None


def _brief_for_llm(brief: dict[str, Any]) -> dict[str, Any]:
    keep = ("client", "property", "location", "website", "targetAudience", "goals", "facts")
    return {key: brief[key] for key in keep if brief.get(key)}


# ---- intents -------------------------------------------------------------------------------
def extract_intents(brief: dict[str, Any], llm: LLM | None = None) -> dict[str, Any]:
    model = _llm(llm)
    if model is None:
        found = rules.extract_intents(brief)
        items = [{"intent": f["intent"], "audience": f["audience"], "description": f["description"],
                  "sourceQuotes": f["source_quotes"], "template": f["template"]} for f in found]
        return {"items": items, "source": "rules",
                "notes": "Rule-based intents from keyword themes in the brief and transcript (no LLM key configured)."}
    user = json.dumps({"BRIEF": _brief_for_llm(brief), "TRANSCRIPT": brief.get("transcript", "")[:40000]}, ensure_ascii=False)
    out = model.json(P.INTENT_EXTRACTOR, user, SetupIntents)
    seen, items = set(), []
    for intent in out.intents:
        key = " ".join(intent.intent.lower().split())
        if not key or key in seen:
            continue
        seen.add(key)
        items.append({"intent": " ".join(intent.intent.split()), "audience": " ".join(intent.audience.split()),
                      "description": intent.description, "sourceQuotes": intent.source_quotes})
    return {"items": items, "source": "ai", "model": model.label, "notes": out.notes}


# ---- prompts -------------------------------------------------------------------------------
def write_prompts(brief: dict[str, Any], intents: list[dict[str, Any]], existing: list[str] | None = None,
                  llm: LLM | None = None) -> dict[str, Any]:
    """One prompt per intent, each with a 0–100 confidence score."""
    model = _llm(llm)
    if model is None:
        texts = {item["id"]: rules.write_prompt(item, brief) for item in intents}
        source = "rules"
    else:
        user = json.dumps({"BRIEF": _brief_for_llm(brief), "EXISTING_PROMPTS": (existing or [])[:60],
                           "INTENTS": [{"item_id": item["id"], "intent": item["intent"], "audience": item["audience"],
                                        "description": item.get("description", "")} for item in intents]},
                          ensure_ascii=False)
        out = model.json(P.PROMPT_WRITER, user, SetupPrompts)
        texts = {p.item_id: " ".join(p.prompt_text.split()) for p in out.prompts if p.prompt_text.strip()}
        for item in intents:  # anything the model skipped falls back to a template
            texts.setdefault(item["id"], rules.write_prompt(item, brief))
        source = "ai"
    scores = score_prompts(brief, [{**item, "text": texts[item["id"]]} for item in intents], existing, model)
    return {"prompts": {item_id: {"text": text, "confidence": scores.get(item_id)} for item_id, text in texts.items()},
            "source": source}


def score_prompts(brief: dict[str, Any], items: list[dict[str, Any]], existing: list[str] | None = None,
                  llm: LLM | None = None) -> dict[str, int]:
    names = [brief.get("property") or "", *(brief.get("aliases") or [])]
    checks, earlier = [], []
    for item in items:
        branded = "brand" in item.get("intent", "").lower()
        draft = DraftPrompt(prompt_text=item["text"], intent=item.get("intent", ""), persona=item.get("audience", ""),
                            prompt_type="branded" if branded else "unbranded_discovery", rationale="")
        checks.append(auto_checks(draft, existing or [], earlier, names))
        earlier.append(item["text"])
    heuristic = {item["id"]: rules.score_prompt(item["text"], brief, "brand" in item.get("intent", "").lower(), c["duplicate"])
                 for item, c in zip(items, checks)}
    if llm is None:
        return heuristic
    user = json.dumps({"PROMPTS": [{"index": n, "prompt_text": item["text"], "intent": item.get("intent", ""),
                                    "CHECKS": {"word_count": c["word_count"], "length_ok": c["length_ok"],
                                               "brand_leak": c["brand_leak"], "duplicate": c["duplicate"]}}
                                   for n, (item, c) in enumerate(zip(items, checks))]}, ensure_ascii=False)
    try:
        reviews = llm.json(P.PROMPT_QA, user, PromptReviews).reviews
    except Exception:  # noqa: BLE001 — QA scores are advisory; keep the heuristic if the call fails
        return heuristic
    scores = dict(heuristic)
    for review in reviews:
        if 0 <= review.index < len(items):
            base = (review.realism + review.intent_fit + review.measurability) / 3 * 100
            penalty = 25 if review.decision == "reject" else 8 if review.decision == "rewrite" else 0
            scores[items[review.index]["id"]] = max(0, min(99, round(base - penalty)))
    return scores


def rewrite_prompt(brief: dict[str, Any], intent: dict[str, Any], text: str, feedback: str,
                   llm: LLM | None = None) -> dict[str, Any]:
    model = _llm(llm)
    if model is None:
        new_text = rules.rewrite(text, feedback)
        message = "Rule-based draft: your feedback was applied to the wording. Review it, then Save."
    else:
        user = json.dumps({"PROMPT": text, "FEEDBACK": feedback, "INTENT": intent.get("intent", ""),
                           "AUDIENCE": intent.get("audience", ""), "BRIEF": _brief_for_llm(brief)}, ensure_ascii=False)
        out = model.json(P.REWRITER, user, Rewrite)
        new_text = " ".join(out.prompt_text.split())
        message = f"New draft from the Prompt Writer agent{': ' + out.note if out.note else ''}. Review it, then Save."
    score = score_prompts(brief, [{**intent, "id": "draft", "text": new_text}], None, model).get("draft")
    return {"text": new_text, "confidence": score, "message": message, "source": "ai" if model else "rules"}
