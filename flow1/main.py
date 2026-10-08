"""
GEO Flow 1 (Property setup) backend.

Persists everything the Flow 1 HTML wizard used to keep only in browser
memory: client/property setup, the transcript, the 15 shared intent
reviews, per-engine prompt reviews, engine selection, and the review
event log (what used to be the local-only "Export review data" JSON).

Run locally:
    pip install fastapi uvicorn sqlalchemy
    uvicorn main:app --reload --port 8000

By default this uses a local SQLite file (geo_flow1.db) so it runs with
zero setup. To point it at Supabase/Postgres instead, set:
    export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME"
before starting uvicorn. No code changes needed.
"""
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine, Column, String, Boolean, Integer, Float, DateTime, JSON,
    ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./geo_flow1.db")
# Supabase/Heroku style URLs start with postgres://, SQLAlchemy wants postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
# Name the driver explicitly (psycopg 3) so it works on any SQLAlchemy version.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def now():
    return datetime.now(timezone.utc)


def new_id():
    return str(uuid.uuid4())


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

class Client(Base):
    __tablename__ = "flow1_clients"
    id = Column(String, primary_key=True, default=new_id)
    slug = Column(String, unique=True, nullable=True)  # matches frontend's clientDirectory ids, e.g. "existing"
    name = Column(String, nullable=False)
    detail = Column(String, default="")
    property = Column(String, default="")
    team = Column(String, default="")
    created_at = Column(DateTime, default=now)


class Setup(Base):
    __tablename__ = "flow1_setups"
    id = Column(String, primary_key=True, default=new_id)
    # Plain label from the page (a client id, or "existing" / "new"). Not a
    # foreign key, because the page does not always send a real client id.
    client_id = Column(String, nullable=True)
    client_name = Column(String, default="")
    property = Column(String, default="")
    market = Column(String, default="")
    goals = Column(String, default="")
    sample_client = Column(Boolean, default=False)

    transcript_mode = Column(String, default="upload")  # 'upload' | 'paste'
    transcript_text = Column(String, default="")
    file_name = Column(String, default="")

    stage = Column(Integer, default=1)
    selected_engine_ids = Column(JSON, default=list)
    engine_selection_confirmed = Column(Boolean, default=False)
    prompt_engine = Column(String, nullable=True)

    reviewer = Column(String, nullable=True)  # who is working on this setup
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    intents = relationship("IntentReview", cascade="all, delete-orphan", backref="setup")
    prompts = relationship("PromptReview", cascade="all, delete-orphan", backref="setup")
    events = relationship("ReviewEvent", cascade="all, delete-orphan", backref="setup")


class IntentReview(Base):
    __tablename__ = "flow1_intent_reviews"
    __table_args__ = (UniqueConstraint("setup_id", "item_id", name="uq_intent_row"),)
    id = Column(String, primary_key=True, default=new_id)
    setup_id = Column(String, ForeignKey("flow1_setups.id"), nullable=False)
    item_id = Column(String, nullable=False)  # e.g. "I01"
    intent = Column(String, default="")
    audience = Column(String, default="")
    status = Column(String, default="Needs review")  # 'Needs review' | 'Approved' | 'Deleted'
    revision = Column(Integer, default=0)
    updated_at = Column(DateTime, default=now, onupdate=now)


class PromptReview(Base):
    __tablename__ = "flow1_prompt_reviews"
    __table_args__ = (UniqueConstraint("setup_id", "engine_id", "item_id", name="uq_prompt_row"),)
    id = Column(String, primary_key=True, default=new_id)
    setup_id = Column(String, ForeignKey("flow1_setups.id"), nullable=False)
    engine_id = Column(String, nullable=False)
    item_id = Column(String, nullable=False)
    prompt_id = Column(String, nullable=True)
    text = Column(String, default="")
    feedback = Column(String, default="")
    status = Column(String, default="Needs review")
    confidence = Column(Integer, nullable=True)
    revision = Column(Integer, default=0)
    updated_at = Column(DateTime, default=now, onupdate=now)


class ReviewEvent(Base):
    __tablename__ = "flow1_review_events"
    id = Column(String, primary_key=True, default=new_id)
    setup_id = Column(String, ForeignKey("flow1_setups.id"), nullable=False)
    event_id = Column(String, nullable=False)  # the frontend's local 'local-<ts>-<n>' id, kept for traceability
    event_type = Column(String, nullable=False)
    suggestion_type = Column(String, nullable=False)  # 'intent' | 'prompt'
    item_id = Column(String, nullable=False)
    engine_id = Column(String, nullable=True)
    prompt_id = Column(String, nullable=True)
    property = Column(String, default="")
    revision = Column(Integer, default=0)
    confidence = Column(Integer, nullable=True)
    confidence_provenance = Column(String, nullable=True)
    audience = Column(String, default="")
    timestamp = Column(DateTime, default=now)
    extra = Column(JSON, default=dict)


Base.metadata.create_all(engine)


def lock_down_postgres_tables():
    """On Supabase/Postgres, turn on row level security for our tables.
    Our backend connects as the database owner, which is not affected. This
    stops anyone using the project's public API key from reading them."""
    if not DATABASE_URL.startswith("postgresql"):
        return
    from sqlalchemy import text
    try:
        with engine.begin() as conn:
            # Older start-ups created a foreign key on client_id. Remove it.
            conn.execute(text(
                'ALTER TABLE flow1_setups DROP CONSTRAINT IF EXISTS flow1_setups_client_id_fkey'
            ))
            for table in Base.metadata.tables:
                conn.execute(text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
    except Exception as exc:  # never stop the app from starting over this
        print("Could not enable row level security:", exc)


lock_down_postgres_tables()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------------------------------
# Seed the 8-client directory the prototype ships with, if empty
# --------------------------------------------------------------------------

SEED_CLIENTS = [
    {"slug": "existing", "name": "InterContinental Sydney Coogee Beach",
     "detail": "InterContinental Sydney Coogee Beach", "property": "InterContinental Sydney Coogee Beach",
     "team": "InterContinental Sydney Coogee Beach marketing team"},
    {"slug": "crowne-canberra", "name": "Crowne Plaza Canberra",
     "detail": "Crowne Plaza Canberra - GA4", "property": "Crowne Plaza Canberra", "team": ""},
    {"slug": "vlrc", "name": "VLRC", "detail": "VLCR", "property": "VLCR", "team": ""},
    {"slug": "your-council", "name": "Your Council", "detail": "www.yourcouncil.nsw.gov.au",
     "property": "www.yourcouncil.nsw.gov.au", "team": ""},
    {"slug": "yourcouncil", "name": "YourCouncil", "detail": "YourCouncil", "property": "YourCouncil", "team": ""},
    {"slug": "intercontinental-hayman", "name": "InterContinental Hayman",
     "detail": "haymanisland.intercontinental.com", "property": "haymanisland.intercontinental.com", "team": ""},
    {"slug": "intercontinental-sanctuary-cove", "name": "InterContinental Sanctuary Cove",
     "detail": "InterContinental Sanctuary Cove - GA4", "property": "InterContinental Sanctuary Cove", "team": ""},
    {"slug": "ihg-sydney", "name": "IHG - Sydney", "detail": "www.sydney.intercontinental.com",
     "property": "www.sydney.intercontinental.com", "team": ""},
]


def seed_clients():
    db = SessionLocal()
    try:
        if db.query(Client).count() == 0:
            for c in SEED_CLIENTS:
                db.add(Client(**c))
            db.commit()
    finally:
        db.close()


seed_clients()

# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class ClientIn(BaseModel):
    name: str
    detail: str = ""
    property: str = ""
    team: str = ""


class ClientOut(ClientIn):
    id: str
    slug: Optional[str] = None


class IntentRow(BaseModel):
    item_id: str
    intent: str = ""
    audience: str = ""
    status: str = "Needs review"
    revision: int = 0


class PromptRow(BaseModel):
    engine_id: str
    item_id: str
    prompt_id: Optional[str] = None
    text: str = ""
    feedback: str = ""
    status: str = "Needs review"
    confidence: Optional[int] = None
    revision: int = 0


class EventRow(BaseModel):
    event_id: str
    event_type: str
    suggestion_type: str
    item_id: str
    engine_id: Optional[str] = None
    prompt_id: Optional[str] = None
    property: str = ""
    revision: int = 0
    confidence: Optional[int] = None
    confidence_provenance: Optional[str] = None
    audience: str = ""
    timestamp: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class SetupCreate(BaseModel):
    client_id: Optional[str] = None
    client_name: str = ""
    property: str = ""
    market: str = ""
    goals: str = ""
    sample_client: bool = False
    reviewer: Optional[str] = None


class SetupState(BaseModel):
    """Full snapshot the frontend pushes on every meaningful change."""
    client_id: Optional[str] = None
    client_name: str = ""
    property: str = ""
    market: str = ""
    goals: str = ""
    sample_client: bool = False
    transcript_mode: str = "upload"
    transcript_text: str = ""
    file_name: str = ""
    stage: int = 1
    selected_engine_ids: List[str] = Field(default_factory=list)
    engine_selection_confirmed: bool = False
    prompt_engine: Optional[str] = None
    reviewer: Optional[str] = None
    intents: List[IntentRow] = Field(default_factory=list)
    prompts: List[PromptRow] = Field(default_factory=list)
    events: List[EventRow] = Field(default_factory=list)


def setup_to_dict(s: Setup) -> Dict[str, Any]:
    return {
        "id": s.id,
        "client_id": s.client_id,
        "client_name": s.client_name,
        "property": s.property,
        "market": s.market,
        "goals": s.goals,
        "sample_client": s.sample_client,
        "transcript_mode": s.transcript_mode,
        "transcript_text": s.transcript_text,
        "file_name": s.file_name,
        "stage": s.stage,
        "selected_engine_ids": s.selected_engine_ids or [],
        "engine_selection_confirmed": s.engine_selection_confirmed,
        "prompt_engine": s.prompt_engine,
        "reviewer": s.reviewer,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "intents": [
            {"item_id": i.item_id, "intent": i.intent, "audience": i.audience,
             "status": i.status, "revision": i.revision}
            for i in s.intents
        ],
        "prompts": [
            {"engine_id": p.engine_id, "item_id": p.item_id, "prompt_id": p.prompt_id,
             "text": p.text, "feedback": p.feedback, "status": p.status,
             "confidence": p.confidence, "revision": p.revision}
            for p in s.prompts
        ],
        "event_count": len(s.events),
    }


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = FastAPI(title="GEO Flow 1 backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your actual frontend origin before going live
    allow_methods=["*"],
    allow_headers=["*"],
)


from fastapi import Depends  # noqa: E402


@app.get("/api/clients", response_model=List[ClientOut])
def get_clients(db: Session = Depends(get_db)):
    rows = db.query(Client).order_by(Client.created_at).all()
    return [
        ClientOut(id=c.id, slug=c.slug, name=c.name, detail=c.detail, property=c.property, team=c.team)
        for c in rows
    ]


@app.post("/api/clients", response_model=ClientOut)
def create_client(payload: ClientIn, db: Session = Depends(get_db)):
    c = Client(name=payload.name, detail=payload.detail, property=payload.property, team=payload.team)
    db.add(c)
    db.commit()
    db.refresh(c)
    return ClientOut(id=c.id, slug=c.slug, name=c.name, detail=c.detail, property=c.property, team=c.team)


@app.post("/api/setups")
def create_setup(payload: SetupCreate, db: Session = Depends(get_db)):
    s = Setup(
        client_id=payload.client_id,
        client_name=payload.client_name,
        property=payload.property,
        market=payload.market,
        goals=payload.goals,
        sample_client=payload.sample_client,
        reviewer=payload.reviewer,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id}


@app.get("/api/setups/{setup_id}")
def get_setup(setup_id: str, db: Session = Depends(get_db)):
    s = db.get(Setup, setup_id)
    if not s:
        raise HTTPException(404, "Setup not found")
    return setup_to_dict(s)


@app.post("/api/setups/{setup_id}")  # used by the browser when the tab closes
@app.put("/api/setups/{setup_id}")
def save_setup_state(setup_id: str, payload: SetupState, db: Session = Depends(get_db)):
    """Full-snapshot save. The frontend calls this (debounced) after every
    reviewEvent and every wizard stage change, sending its current state."""
    s = db.get(Setup, setup_id)
    if not s:
        raise HTTPException(404, "Setup not found")

    s.client_id = payload.client_id
    s.client_name = payload.client_name
    s.property = payload.property
    s.market = payload.market
    s.goals = payload.goals
    s.sample_client = payload.sample_client
    s.transcript_mode = payload.transcript_mode
    s.transcript_text = payload.transcript_text
    s.file_name = payload.file_name
    s.stage = payload.stage
    s.selected_engine_ids = payload.selected_engine_ids
    s.engine_selection_confirmed = payload.engine_selection_confirmed
    s.prompt_engine = payload.prompt_engine
    if payload.reviewer:
        s.reviewer = payload.reviewer

    # Upsert intents
    existing_intents = {i.item_id: i for i in s.intents}
    for row in payload.intents:
        rec = existing_intents.get(row.item_id)
        if rec is None:
            rec = IntentReview(setup_id=s.id, item_id=row.item_id)
            db.add(rec)
        rec.intent = row.intent
        rec.audience = row.audience
        rec.status = row.status
        rec.revision = row.revision

    # Upsert prompts
    existing_prompts = {(p.engine_id, p.item_id): p for p in s.prompts}
    for row in payload.prompts:
        key = (row.engine_id, row.item_id)
        rec = existing_prompts.get(key)
        if rec is None:
            rec = PromptReview(setup_id=s.id, engine_id=row.engine_id, item_id=row.item_id)
            db.add(rec)
        rec.prompt_id = row.prompt_id
        rec.text = row.text
        rec.feedback = row.feedback
        rec.status = row.status
        rec.confidence = row.confidence
        rec.revision = row.revision

    # Append any events not already stored (by event_id)
    existing_event_ids = {e.event_id for e in s.events}
    for ev in payload.events:
        if ev.event_id in existing_event_ids:
            continue
        ts = None
        if ev.timestamp:
            try:
                ts = datetime.fromisoformat(ev.timestamp.replace("Z", "+00:00"))
            except ValueError:
                ts = now()
        db.add(ReviewEvent(
            setup_id=s.id, event_id=ev.event_id, event_type=ev.event_type,
            suggestion_type=ev.suggestion_type, item_id=ev.item_id, engine_id=ev.engine_id,
            prompt_id=ev.prompt_id, property=ev.property, revision=ev.revision,
            confidence=ev.confidence, confidence_provenance=ev.confidence_provenance,
            audience=ev.audience, timestamp=ts or now(), extra=ev.extra,
        ))

    db.commit()
    db.refresh(s)
    return {"ok": True, "updated_at": s.updated_at.isoformat()}


@app.get("/api/setups/{setup_id}/export.json")
def export_setup(setup_id: str, db: Session = Depends(get_db)):
    """Same shape as the prototype's local 'Export review data' download,
    but sourced from the database instead of the browser session."""
    s = db.get(Setup, setup_id)
    if not s:
        raise HTTPException(404, "Setup not found")
    events = db.query(ReviewEvent).filter(ReviewEvent.setup_id == setup_id).order_by(ReviewEvent.timestamp).all()
    return {
        "schemaVersion": 1,
        "exportedAt": now().isoformat(),
        "mode": "server",
        "confidenceNotice": "Scores marked sample are illustrative, not AI-assessed.",
        "events": [
            {
                "schemaVersion": 1,
                "eventId": e.event_id,
                "eventType": e.event_type,
                "suggestionType": e.suggestion_type,
                "itemId": e.item_id,
                "engineId": e.engine_id,
                "promptId": e.prompt_id,
                "property": e.property,
                "revision": e.revision,
                "confidence": e.confidence,
                "confidenceProvenance": e.confidence_provenance,
                "audience": e.audience,
                "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                **(e.extra or {}),
            }
            for e in events
        ],
    }


@app.delete("/api/setups/{setup_id}")
def reset_setup(setup_id: str, db: Session = Depends(get_db)):
    s = db.get(Setup, setup_id)
    if not s:
        raise HTTPException(404, "Setup not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True, "database": DATABASE_URL.split("://")[0]}


ENGINES = {
    'ai-overview': ('Google AI Overview GUI', 'GUI'),
    'ai-mode': ('Google AI Mode GUI', 'GUI'),
    'gemini': ('Google Gemini GUI', 'GUI'),
    'chatgpt': ('ChatGPT GUI', 'GUI'),
    'perplexity': ('Perplexity GUI', 'GUI'),
    'grok': ('xAI Grok GUI', 'GUI'),
    'copilot': ('Bing Copilot GUI', 'GUI'),
    'sonar': ('Perplexity Sonar API', 'API'),
    'sonar-pro': ('Perplexity Sonar-Pro API', 'API'),
    'sonar-reasoning-pro': ('Perplexity Sonar-Reasoning-Pro API', 'API'),
    'gpt-5-api': ('OpenAI GPT-5 API', 'API'),
    'gemini-3-flash': ('Google Gemini 3 Flash API', 'API'),
    'gemini-3-1-pro': ('Google Gemini 3.1 Pro API', 'API'),
    'claude-4-5-haiku': ('Anthropic Claude 4.5 Haiku API', 'API'),
    'deepseek-v3': ('DeepSeek V3 API', 'API'),
    'mistral-large': ('Mistral Large API', 'API'),
}


@app.get("/api/setups/{setup_id}/export.csv")
def export_approved_prompts_csv(setup_id: str, db: Session = Depends(get_db)):
    """Download of every saved prompt (generated, edited or approved), one row per engine and prompt."""
    import csv
    import io
    import re as _re
    from fastapi.responses import Response

    s = db.get(Setup, setup_id)
    if not s:
        raise HTTPException(404, "Setup not found")
    intents = {i.item_id: i for i in s.intents}
    engine_order = list(ENGINES.keys())
    deleted = {i.item_id for i in s.intents if i.status == "Deleted"}
    rows = [p for p in s.prompts if p.status in ("Approved", "Generated", "Edited") and p.item_id not in deleted]
    rows.sort(key=lambda p: (engine_order.index(p.engine_id) if p.engine_id in engine_order else 99, p.item_id))

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Property", "Engine", "Engine type", "Prompt ID", "Intent", "Audience", "Prompt"])
    for p in rows:
        name, etype = ENGINES.get(p.engine_id, (p.engine_id, ""))
        intent = intents.get(p.item_id)
        w.writerow([s.property, name, etype, p.prompt_id or "", intent.intent if intent else "",
                    intent.audience if intent else "", p.text])
    safe = _re.sub(r"[^A-Za-z0-9]+", "_", s.property or "property").strip("_") or "property"
    return Response(
        content="\ufeff" + buf.getvalue(),  # BOM so Excel shows curly quotes correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="Prompts_{safe}.csv"'},
    )


# Serve the Flow 1 page from the same app, so one link gives people both the
# page and the backend. Keep this at the very end so it never hides /api routes.
import pathlib  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

_frontend = pathlib.Path(__file__).parent / "frontend"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")
