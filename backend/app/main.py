"""GEO Automation Platform — FastAPI backend.

Run:  uvicorn app.main:app --reload --port 8000     (from the backend/ folder)
Docs: http://localhost:8000/docs

The React app (frontend/) is served from frontend/dist once it is built; during development
run `npm run dev` in frontend/ and Vite proxies /api to this server.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import settings
from .routers import (assistant, clients, dashboard, library, measurements, prompt_setup, rankscale, report,
                      review, system)

app = FastAPI(title="Komosion GEO Automation Platform", version="2.0")

for module in (system, clients, library, prompt_setup, rankscale, assistant, measurements, dashboard, review, report):
    app.include_router(module.router)

DIST = settings.FRONTEND_DIST
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    """Serve the built React app; unknown API paths stay 404."""
    if path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    target = DIST / path
    if path and target.is_file():
        return FileResponse(target)
    index = DIST / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(404, "The frontend is not built yet. Run `npm install && npm run build` in frontend/.")
