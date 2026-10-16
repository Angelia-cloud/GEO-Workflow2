"""Rule-based fallbacks for the Phase 1 agents, used when no LLM key is configured.

They are deterministic and transparent: intents come from keyword themes found in the brief and
transcript, prompts from templates, and confidence from the same automatic checks the QA agent sees.
"""
from __future__ import annotations

import re
from typing import Any

# theme id, keywords, intent label, default audience, prompt template
THEMES: list[tuple[str, tuple[str, ...], str, str, str]] = [
    ("family", ("family", "families", "kids", "children", "school holiday", "connecting room"),
     "Family stays", "Families planning a holiday", "Which hotels in {place} suit a family holiday with space for the kids and easy outings?"),
    ("romance", ("couple", "couples", "romantic", "romance", "anniversary", "honeymoon", "proposal"),
     "Romantic getaway", "Couples planning a weekend away", "Where should a couple stay in {place} for a romantic weekend with great dining and views?"),
    ("wellness", ("spa", "wellness", "relax", "relaxing", "massage", "sauna", "restorative"),
     "Wellness & spa", "Travellers seeking a restorative stay", "Which hotel in {place} is best for a relaxing stay with a good spa and wellness facilities?"),
    ("business", ("business", "work trip", "meeting", "meetings", "conference", "corporate", "bleisure", "team retreat", "offsite"),
     "Business / bleisure", "Business travellers and event organisers", "Which hotels in {place} have meeting rooms and accommodation for a two-day team event?"),
    ("dining", ("dining", "restaurant", "restaurants", "food", "chef", "seafood", "bar"),
     "Dining-led discovery", "Food-focused travellers", "Which hotels in {place} have on-site restaurants worth staying for?"),
    ("celebrations", ("celebration", "celebrations", "birthday", "shower", "party", "function", "occasion"),
     "Celebrations & events", "Planners organising a private celebration", "Where can I host a birthday or private celebration in {place} with catering and rooms for guests?"),
    ("weddings", ("wedding", "weddings", "bridal", "bride"),
     "Weddings", "Couples planning a wedding", "Which hotels in {place} host weddings with ceremony space, a reception venue and rooms for guests?"),
    ("luxury", ("luxury", "premium", "upscale", "five-star", "5-star", "high-end"),
     "Luxury stay", "Travellers seeking a premium stay", "What are the best luxury hotels in {place} for a special occasion stay?"),
    ("coastal", ("beach", "coastal", "ocean", "seaside", "waterfront", "harbour"),
     "Coastal stay", "Travellers wanting a beach or waterfront stay", "Which hotels in {place} are right on the water with ocean views?"),
    ("accessibility", ("accessible", "accessibility", "wheelchair", "step-free", "mobility"),
     "Accessible stays", "Travellers needing accessible rooms", "Which hotels in {place} have accessible rooms and step-free access to the main facilities?"),
    ("value", ("package", "packages", "deal", "deals", "offer", "offers", "value", "budget"),
     "Packages & value", "Value-conscious travellers", "Are there hotels in {place} with stay packages that include breakfast, parking or dining credit?"),
    ("local", ("local", "attraction", "attractions", "coastal walk", "stadium", "racecourse", "sightseeing", "events nearby"),
     "Local experiences", "Visitors exploring the area", "Where should I stay in {place} to be close to local attractions and walks?"),
    ("pets", ("pet", "pets", "dog", "dogs", "pet-friendly"),
     "Pet-friendly stays", "Travellers bringing a dog", "Which hotels in {place} are genuinely pet-friendly for a weekend away with a dog?"),
]
BRAND = ("brand", (), "Brand-name check", "All personas", "Tell me about {property}. What is it best known for, and who is it right for?")
STOP = {"the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "our", "we", "who", "are", "is"}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9'-]+", text.lower()) if w not in STOP}


def _segments(audience: str) -> list[str]:
    parts = re.split(r"[;\n]|,(?![^()]*\))|\band\b", audience or "")
    return [" ".join(p.split()).strip(" .") for p in parts if len(p.strip()) > 3]


def _contains(text: str, keyword: str) -> bool:
    return re.search(rf"\b{re.escape(keyword)}", text) is not None


def guess_place(brief: dict[str, Any]) -> str:
    location = (brief.get("location") or "").strip()
    if location:
        return location.split(",")[0].strip() or location
    text = f"{brief.get('targetAudience', '')} {brief.get('goals', '')} {brief.get('transcript', '')}"
    for candidate in ("Sydney", "Melbourne", "Brisbane", "Gold Coast", "Canberra", "Perth", "Adelaide", "Hobart", "Cairns"):
        if candidate.lower() in text.lower():
            return candidate
    match = re.search(r"\b(?:in|near|town of|city of)\s+(?:the\s+)?(?:imaginary town of\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)", text)
    return match.group(1) if match else "the area"


def extract_intents(brief: dict[str, Any], limit: int = 15) -> list[dict[str, Any]]:
    """Themes mentioned in the goals, audience and transcript, strongest first."""
    goals = ""
    audience = brief.get("targetAudience", "")
    corpus = brief.get("transcript", "").lower()
    segments = _segments(audience)
    found = []
    for order, (theme, keywords, label, default_audience, template) in enumerate(THEMES):
        hits = [k for k in keywords if _contains(corpus, k)]
        if not hits:
            continue
        weight = sum(corpus.count(k) for k in hits) + (5 if any(_contains(goals, k) for k in keywords) else 0)
        segment = next((s for s in segments if any(_contains(s.lower(), k) for k in keywords)), None)
        quotes = []
        for sentence in re.split(r"(?<=[.!?\n])\s+", brief.get("transcript", "")):
            if any(_contains(sentence.lower(), k) for k in hits) and 10 < len(sentence) < 220:
                quotes.append(sentence.strip())
            if len(quotes) == 2:
                break
        found.append({"theme": theme, "intent": label, "audience": (segment[:1].upper() + segment[1:]) if segment else default_audience,
                      "description": f"Guests whose need matches '{label.lower()}'.", "source_quotes": quotes,
                      "weight": weight, "order": order, "template": template})
    found.sort(key=lambda item: (-item["weight"], item["order"]))
    found = found[: max(1, limit - 1)]
    return found


def template_for(intent: str) -> str:
    low = intent.lower()
    for theme, keywords, label, _audience, template in THEMES + [BRAND]:
        if label.lower() == low or any(_contains(low, k) for k in keywords) or theme in low:
            return template
    return "Which hotels in {place} are best for " + low + "?"


def write_prompt(intent: dict[str, Any], brief: dict[str, Any]) -> str:
    template = intent.get("template") or template_for(intent.get("intent", ""))
    text = template.format(place=guess_place(brief), property=brief.get("property") or "this hotel")
    return " ".join(text.split())


def score_prompt(text: str, brief: dict[str, Any], branded: bool = False, duplicate: bool = False) -> int:
    """Heuristic 0–100 confidence from the same checks the QA agent receives."""
    words = len(text.split())
    score = 64
    score += 12 if 10 <= words <= 35 else -10
    score += 6 if text.strip().endswith("?") else -6
    place = guess_place(brief)
    score += 6 if place != "the area" and place.lower() in text.lower() else 0
    names = [brief.get("property") or "", *(brief.get("aliases") or [])]
    leak = any(n and n.lower() in text.lower() for n in names)
    if leak and not branded:
        score -= 30
    if duplicate:
        score -= 18
    score += min(6, len(_words(text)) // 4)
    return max(30, min(95, score))


def rewrite(text: str, feedback: str) -> str:
    """Apply simple, visible edits from reviewer feedback (rule-based mode)."""
    base = " ".join(text.split()).rstrip(" ?")
    fb = " ".join(feedback.split()).strip().rstrip(".")
    low = fb.lower()
    if any(word in low for word in ("shorter", "concise", "simplify", "simpler")):
        base = re.split(r",| with | that | including ", base, maxsplit=1)[0]
        return base + "?"
    match = re.search(r"(?:include|mention|add|focus on|ask about)\s+(.+)", fb, re.I)
    if match:
        addition = match.group(1).strip().rstrip(".")
        return f"{base} with {addition}?" if " with " not in base else f"{base} and {addition}?"
    return f"{base}, {fb[:1].lower() + fb[1:]}?" if fb else base + "?"
