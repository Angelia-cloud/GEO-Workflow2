"""Phase 1 · Prompt agents.

    Client Analyst  brief + transcript context        → positioning, personas, attributes, gaps
    Intent Agent    transcript (+ analysis as context) → intents, each with verbatim transcript evidence
    Prompt Writer   2–3 questions per approved intent → the prompts tracked on every selected engine
    Prompt QA       automatic checks + LLM review     → confidence score shown in the review table
    Rewriter        reviewer feedback on one prompt   → a new draft (scored again)

The agents call Groq (GEO_LLM_PROVIDER=groq + GROQ_API_KEY). Intents are kept only when the model
backs them with quotes that really appear in the transcript; rules.py supplies only the heuristic
confidence score used when the QA call fails.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from agents.llm import LLM, LLMError
from agents.prompt_generation.pipeline import auto_checks
from agents.prompt_generation.schema import DraftPrompt, PromptReviews

from . import prompts as P
from . import rules
from .quotes import Transcript
from .schema import ClientAnalysis, MergedIntents, Rewrite, SetupIntents, SetupPrompts


def llm_ready() -> bool:
    provider = (os.environ.get("GEO_LLM_PROVIDER") or "groq").lower()
    return provider == "stub" or (provider == "groq" and bool(os.environ.get("GROQ_API_KEY")))


def _llm(llm: LLM | None) -> LLM:
    """Groq is the only provider; there is no rule-based fallback."""
    if llm is not None:
        return llm
    if not llm_ready():
        raise LLMError("The Groq agent is not configured. Set GEO_LLM_PROVIDER=groq and GROQ_API_KEY in backend/.env.")
    return LLM()


def _brief_for_llm(brief: dict[str, Any]) -> dict[str, Any]:
    keep = ("client", "property", "location", "website", "targetAudience", "goals", "facts")
    return {key: brief[key] for key in keep if brief.get(key)}


# ---- intents -------------------------------------------------------------------------------
def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(text).lower()).split())


def transcript_chunk_chars() -> int:
    """How much transcript fits in one agent call. Groq's free tier allows 8,000 tokens per minute per
    request (input + reply), so a long kickoff transcript is read in parts instead of being rejected.
    Raise GEO_LLM_TPM on a paid plan to read it in fewer, larger parts."""
    if os.environ.get("GEO_TRANSCRIPT_CHUNK_CHARS"):
        return max(4000, int(os.environ["GEO_TRANSCRIPT_CHUNK_CHARS"]))
    tpm = int(os.environ.get("GEO_LLM_TPM", "8000"))
    reply = int(os.environ.get("GEO_LLM_MAX_OUTPUT", "2500"))
    tokens = max(1500, tpm - reply - 1800)  # instructions + schema + brief
    return int(min(40000, max(4000, tokens * 3.5)))


def split_transcript(text: str, size: int | None = None) -> list[str]:
    """Parts of at most `size` characters, cut at paragraph or sentence ends where possible."""
    text = str(text or "").strip()
    size = size or transcript_chunk_chars()
    parts: list[str] = []
    while len(text) > size:
        cut = max(text.rfind("\n\n", 0, size), text.rfind("\n", 0, size))
        if cut < size // 2:
            cut = max(text.rfind(". ", 0, size), text.rfind("? ", 0, size), text.rfind("! ", 0, size))
            cut = cut + 1 if cut >= size // 2 else size
        parts.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        parts.append(text)
    return parts


def analyse_client(brief: dict[str, Any], llm: LLM | None = None) -> dict[str, Any] | None:
    """Business context from the brief and transcript. Context only: it never produces intents itself,
    so when it fails the intents are still generated (without it)."""
    model = _llm(llm)
    head = split_transcript(brief.get("transcript", ""))[:1]
    user = json.dumps({"BRIEF": {k: v for k, v in _brief_for_llm(brief).items() if k != "facts"},
                       "TRANSCRIPT": head[0] if head else ""}, ensure_ascii=False)
    try:
        return model.json(P.CLIENT_ANALYST, user, ClientAnalysis, max_tokens=1500).model_dump()
    except Exception:  # noqa: BLE001 — optional context; the Intent Agent reads the transcript itself
        return None


def _stem_key(text: str) -> str:
    """Near-duplicate key: case, punctuation and plural 's' are ignored."""
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") else w for w in _norm(text).split())


def _intents_from_part(model: LLM, context: dict[str, Any], analysis: dict[str, Any] | None, part: str,
                       label: str, transcript: Transcript) -> tuple[list[dict[str, Any]], int, str]:
    payload: dict[str, Any] = {"BRIEF": context, "TRANSCRIPT_PART": label, "TRANSCRIPT": part}
    if analysis:
        payload["CLIENT_ANALYSIS_CONTEXT"] = analysis
    user = json.dumps(payload, ensure_ascii=False)
    items, dropped, notes = [], 0, ""
    for _attempt in range(2):
        out = model.json(P.INTENT_EXTRACTOR, user, SetupIntents)
        notes = out.notes or ""
        items, dropped = [], 0
        for intent in out.intents:
            quotes = []
            for quote in intent.source_quotes:
                found = transcript.find(quote)
                if found and found not in quotes:
                    quotes.append(found)
            if not quotes or not _stem_key(intent.intent):
                dropped += 1
                continue
            items.append({"intent": " ".join(intent.intent.split()), "audience": " ".join(intent.audience.split()),
                          "category": " ".join(intent.category.split()), "description": intent.description,
                          "sourceQuotes": quotes[:3]})
        if items:
            break
    return items, dropped, notes


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Same label (ignoring case, punctuation and plurals): keep one intent with the quotes of both."""
    seen: dict[str, dict[str, Any]] = {}
    for item in items:
        key = _stem_key(item["intent"])
        if key in seen:
            kept = seen[key]
            kept["sourceQuotes"] = list(dict.fromkeys(kept["sourceQuotes"] + item["sourceQuotes"]))[:3]
        else:
            seen[key] = {**item, "sourceQuotes": list(item["sourceQuotes"])}
    return list(seen.values())


def _merge(model: LLM, context: dict[str, Any], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One more call (no transcript) to merge intents found in different parts of a long transcript."""
    by_id = {f"C{n}": item for n, item in enumerate(candidates, start=1)}
    user = json.dumps({"BRIEF": context, "CANDIDATES": [
        {"id": cid, "intent": c["intent"], "audience": c["audience"], "description": c.get("description", "")}
        for cid, c in by_id.items()]}, ensure_ascii=False)
    try:
        out = model.json(P.INTENT_MERGER, user, MergedIntents)
    except Exception:  # noqa: BLE001 — keep the de-duplicated candidates
        return candidates[:15]
    used: set[str] = set()
    merged = []
    for intent in out.intents:
        members = [by_id[m] for m in dict.fromkeys(intent.member_ids) if m in by_id and m not in used]
        if not members:
            continue  # nothing from the transcript supports it
        used.update(m for m in intent.member_ids if m in by_id)
        quotes = list(dict.fromkeys(q for m in members for q in m["sourceQuotes"]))[:3]
        merged.append({"intent": " ".join(intent.intent.split()), "audience": " ".join(intent.audience.split()),
                       "category": " ".join(intent.category.split()) or members[0].get("category", ""),
                       "description": intent.description or members[0].get("description", ""),
                       "sourceQuotes": quotes})
    return _dedupe(merged)[:15] if merged else candidates[:15]


def extract_intents(brief: dict[str, Any], llm: LLM | None = None) -> dict[str, Any]:
    """Intents from the whole transcript. Long transcripts are read part by part (nothing is cut off);
    every intent keeps only quotes that really occur in the transcript."""
    model = _llm(llm)
    full = str(brief.get("transcript", ""))
    transcript = Transcript(full)
    context = {k: v for k, v in _brief_for_llm(brief).items() if k != "facts"}
    parts = split_transcript(full)
    found, dropped, notes = [], 0, []
    for n, part in enumerate(parts, start=1):
        label = f"part {n} of {len(parts)}" if len(parts) > 1 else "complete transcript"
        items, part_dropped, part_notes = _intents_from_part(model, context, brief.get("analysis"), part, label, transcript)
        found.extend(items)
        dropped += part_dropped
        if part_notes:
            notes.append(part_notes)
    found = _dedupe(found)
    if not found:
        raise LLMError("No intents in the transcript could be backed by a quote. Add more detail to the transcript and try again.")
    if len(parts) > 1 and len(found) > 1:
        found = _merge(model, context, found)
    found = found[:15]
    note = " ".join(notes[:2]).strip()
    if len(parts) > 1:
        note = f"{note} The transcript was read in {len(parts)} parts.".strip()
    if dropped:
        note = f"{note} {dropped} suggested intent(s) were dropped because the transcript did not support them.".strip()
    return {"items": found, "source": "ai", "model": model.label, "notes": note, "parts": len(parts)}


# ---- prompts -------------------------------------------------------------------------------
PER_INTENT_MIN, PER_INTENT_MAX, CHUNK = 2, 3, 5
QA_BATCH = 12


def write_prompts(brief: dict[str, Any], intents: list[dict[str, Any]], existing: list[str] | None = None,
                  llm: LLM | None = None) -> dict[str, Any]:
    """2–3 prompts per intent, each with a 0–100 confidence score. Prompt ids are "<intent id>.<n>"."""
    model = _llm(llm)
    tracked = {_norm(text) for text in (existing or [])}
    seen = set(tracked)
    chosen: dict[str, list[str]] = {item["id"]: [] for item in intents}
    already_tracked: dict[str, list[str]] = {item["id"]: [] for item in intents}
    def ask(batch: list[dict[str, Any]]) -> None:
        allowed = {item["id"] for item in batch}
        by_name = {_norm(item["intent"]): item["id"] for item in batch}
        user = json.dumps({"BRIEF": _brief_for_llm(brief),
                           "INTENTS": [{"intent_id": item["id"], "intent": item["intent"], "audience": item["audience"],
                                        "description": item.get("description", ""),
                                        "transcript_evidence": item.get("sourceQuotes", []),
                                        "already_written": chosen[item["id"]]} for item in batch]},
                          ensure_ascii=False)
        out = model.json(P.PROMPT_WRITER, user, SetupPrompts)
        for prompt in out.prompts:
            intent_id = prompt.intent_id.strip()
            if intent_id not in allowed:  # the model sometimes echoes the intent name or a re-formatted id
                intent_id = by_name.get(_norm(intent_id), intent_id)
            text = " ".join(prompt.prompt_text.split())
            key = _norm(text)
            if intent_id in allowed and key in tracked and text not in already_tracked[intent_id]:
                already_tracked[intent_id].append(text)
            if intent_id not in allowed or not key or key in seen or len(chosen[intent_id]) >= PER_INTENT_MAX:
                continue  # unknown intent id, empty, duplicate or over the cap
            seen.add(key)
            chosen[intent_id].append(text)

    def attempt(batch: list[dict[str, Any]], tries: int) -> None:
        for _ in range(tries):
            todo = [item for item in batch if len(chosen[item["id"]]) < PER_INTENT_MIN]
            if not todo:
                return
            try:
                ask(todo)
            except LLMError:
                continue  # a malformed reply is retried; the final check reports what is still missing

    for start in range(0, len(intents), CHUNK):
        attempt(intents[start:start + CHUNK], 2)
    for item in intents:  # intents the batch skipped are asked for on their own
        attempt([item], 2)
    for item in intents:  # only questions the client already tracks: keep them (the QA score flags the duplicate)
        if not chosen[item["id"]] and already_tracked[item["id"]]:
            chosen[item["id"]] = already_tracked[item["id"]][:PER_INTENT_MIN]
    missing = [item["intent"] for item in intents if not chosen[item["id"]]]
    if missing:
        raise LLMError(f"The Prompt Writer returned no valid prompt for: {', '.join(missing)}. Try generating again.")
    flat = [{**item, "id": f"{item['id']}.{n}", "text": text}
            for item in intents for n, text in enumerate(chosen[item["id"]], start=1)]
    scores = score_prompts(brief, flat, existing, model)
    return {"prompts": {row["id"]: {"intentId": row["id"].split(".")[0], "text": row["text"], "confidence": scores.get(row["id"])}
                        for row in flat}, "source": "ai"}


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
    scores = dict(heuristic)
    for start in range(0, len(items), QA_BATCH):  # small batches keep each reply inside the token limit
        batch = list(zip(items, checks))[start:start + QA_BATCH]
        user = json.dumps({"PROMPTS": [{"index": n, "prompt_text": item["text"], "intent": item.get("intent", ""),
                                        "CHECKS": {"word_count": c["word_count"], "length_ok": c["length_ok"],
                                                   "brand_leak": c["brand_leak"], "duplicate": c["duplicate"]}}
                                       for n, (item, c) in enumerate(batch)]}, ensure_ascii=False)
        try:
            reviews = llm.json(P.PROMPT_QA, user, PromptReviews).reviews
        except Exception:  # noqa: BLE001 — QA scores are advisory; keep the heuristic if the call fails
            continue
        for review in reviews:
            if 0 <= review.index < len(batch):
                base = (review.realism + review.intent_fit + review.measurability) / 3 * 100
                penalty = 25 if review.decision == "reject" else 8 if review.decision == "rewrite" else 0
                scores[batch[review.index][0]["id"]] = max(0, min(99, round(base - penalty)))
    return scores


def rewrite_prompt(brief: dict[str, Any], intent: dict[str, Any], text: str, feedback: str,
                   llm: LLM | None = None) -> dict[str, Any]:
    model = _llm(llm)
    user = json.dumps({"PROMPT": text, "FEEDBACK": feedback, "INTENT": intent.get("intent", ""),
                       "AUDIENCE": intent.get("audience", ""), "BRIEF": _brief_for_llm(brief)}, ensure_ascii=False)
    out = model.json(P.REWRITER, user, Rewrite)
    new_text = " ".join(out.prompt_text.split())
    message = f"New draft from the Prompt Writer agent{': ' + out.note if out.note else ''}. Review it, then Save."
    score = score_prompts(brief, [{**intent, "id": "draft", "text": new_text}], None, model).get("draft")
    return {"text": new_text, "confidence": score, "message": message, "source": "ai"}
