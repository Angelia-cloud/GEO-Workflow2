"""Output contracts for the Phase 1 prompt-setup agents."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SetupIntent(BaseModel):
    intent: str = Field(..., description="Short label for the guest need, 2–6 words")
    audience: str = Field(..., description="Concrete persona or audience, e.g. 'Couples planning an anniversary'")
    category: str = Field("", description="One-word topic such as pricing, location, amenities, dining, events")
    description: str = Field("", description="One sentence on what the guest is trying to do")
    source_quotes: list[str] = Field(default_factory=list, max_length=3,
                                     description="Short EXACT excerpts copied from the transcript that support it")


class SetupIntents(BaseModel):
    intents: list[SetupIntent] = Field(..., min_length=1, max_length=20)
    notes: str = ""


class SetupPrompt(BaseModel):
    intent_id: str = Field(..., description="The intent_id exactly as given")
    prompt_text: str


class ClientAnalysis(BaseModel):
    brand_positioning: str = ""
    personas: list[str] = Field(default_factory=list)
    key_attributes: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)


class SetupPrompts(BaseModel):
    prompts: list[SetupPrompt] = Field(..., min_length=1)


class Rewrite(BaseModel):
    prompt_text: str
    note: str = ""


class MergedIntent(BaseModel):
    intent: str = Field(..., description="Short label for the guest need, 2–6 words")
    audience: str = Field(..., description="Concrete persona or audience")
    category: str = ""
    description: str = ""
    member_ids: list[str] = Field(..., min_length=1, description="The candidate ids this intent combines")


class MergedIntents(BaseModel):
    intents: list[MergedIntent] = Field(..., min_length=1, max_length=20)
    notes: str = ""
