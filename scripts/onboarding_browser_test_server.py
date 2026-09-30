"""Temporary deterministic server for the Workflow 1 browser acceptance run."""
from __future__ import annotations

import json
import os

from agents.llm import LLM
from agents.prompt_generation import onboarding, pipeline
from agents.prompt_generation.schema import DraftPrompts, IntentMap, PromptReviews
from app.main import app


def browser_stub(system: str, user: str, schema):
    payload = json.loads(user)
    if schema is IntentMap:
        if payload.get("CLIENT_INPUT") == "none":
            plans = []
            for index, item in enumerate(payload["CURRENT_INTENTS"]):
                plans.append({"name": item["name"], "is_new": False, "description": item["description"] or item["name"],
                              "category": "other", "personas": ["traveller"], "occasions_or_needs": [item["name"]],
                              "priority": "medium", "reason": "Human-approved onboarding intent.", "source_quotes": [],
                              "prompts_to_generate": 2})
            return {"intents": plans or [{"name": "Fallback", "is_new": True, "description": "fallback",
                                           "personas": ["traveller"], "occasions_or_needs": ["stay"],
                                           "priority": "low", "reason": "fallback", "prompts_to_generate": 1}]}
        client_input = payload["CLIENT_INPUT"]
        category = "Dining Experiences" if "dining" in client_input.lower() else "Guest Experiences"
        return {"intents": [
            {"name": category, "is_new": True, "description": "Food-led hotel discovery and dining needs",
             "category": "dining", "personas": ["food-led traveller"], "occasions_or_needs": ["dinner"],
             "priority": "high", "reason": "Client input identifies dining as a guest need.",
             "source_quotes": ["Guests ask about dining"], "prompts_to_generate": 2},
            {"name": "Accessible Stays", "is_new": True, "description": "Step-free accessible accommodation",
             "category": "accessibility", "personas": ["traveller needing access"],
             "occasions_or_needs": ["step-free room"], "priority": "medium",
             "reason": "Client input identifies accessibility as a guest need.",
             "source_quotes": ["Step-free access matters"], "prompts_to_generate": 2},
        ], "notes": "Generated deterministically for the browser acceptance run."}
    if schema is DraftPrompts:
        intent = payload["INTENT"]
        return {"prompts": [
            {"prompt_text": f"Which Sydney hotels offer {intent['name']} options for a weekend guest?",
             "intent": intent["name"], "prompt_type": "unbranded_discovery", "persona": "weekend guest",
             "rationale": "Tests discovery for the approved intent."},
            {"prompt_text": f"Where should I find {intent['name']} near Sydney with helpful guest amenities?",
             "intent": intent["name"], "prompt_type": "comparison", "persona": "traveller",
             "rationale": "Tests comparison for the approved intent."},
        ]}
    if schema is PromptReviews:
        return {"reviews": [{"index": item["index"], "decision": "keep", "realism": 0.9,
                             "intent_fit": 0.9, "measurability": 0.9, "reason": "Clear measurable question."}
                            for item in payload["PROMPTS"]]}
    raise AssertionError(schema)


stub_llm = LLM(provider="stub", stub=browser_stub)
onboarding.LLM = lambda: stub_llm
pipeline.LLM = lambda: stub_llm

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ONBOARDING_TEST_PORT", "8002")))