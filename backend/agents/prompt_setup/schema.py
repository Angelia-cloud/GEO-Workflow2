"""Output contracts for the Phase 1 prompt-setup agents."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SetupIntent(BaseModel):
    intent: str = Field(..., description="Short label for the guest need, 2–6 words")
    audience: str = Field(..., description="Concrete persona or audience, e.g. 'Couples planning an anniversary'")
    description: str = Field("", description="One sentence on what the guest is trying to do")
    source_quotes: list[str] = Field(default_factory=list, max_length=3,
                                     description="Short exact excerpts from the transcript or goals that support it")


class SetupIntents(BaseModel):
    intents: list[SetupIntent] = Field(..., min_length=3, max_length=20)
    notes: str = ""


class SetupPrompt(BaseModel):
    item_id: str
    prompt_text: str


class SetupPrompts(BaseModel):
    prompts: list[SetupPrompt] = Field(..., min_length=1)


class Rewrite(BaseModel):
    prompt_text: str
    note: str = ""
