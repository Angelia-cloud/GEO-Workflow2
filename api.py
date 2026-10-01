import uuid
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from main import run_pipeline

app = FastAPI()
RUNS = {}  # run_id -> {"status": "running" | "done" | "error", "result": ..., "error": ...}


def _execute(run_id, property_name, brief_text, raw_text, client_id, is_competitor):
    try:
        result = run_pipeline(property_name, brief_text, raw_text, client_id, is_competitor)
        RUNS[run_id] = {"status": "done", "result": result}
    except Exception as e:
        RUNS[run_id] = {"status": "error", "error": str(e)}


@app.post("/runs")
async def start_run(
    background_tasks: BackgroundTasks,
    property_name: str = Form(...),
    client_id: str = Form(...),
    is_competitor: bool = Form(False),
    brief_file: UploadFile = File(...),
    notes_file: UploadFile = File(...),
):
    brief_text = (await brief_file.read()).decode("utf-8")
    raw_text = (await notes_file.read()).decode("utf-8")

    run_id = str(uuid.uuid4())
    RUNS[run_id] = {"status": "running"}
    background_tasks.add_task(_execute, run_id, property_name, brief_text, raw_text, client_id, is_competitor)
    return {"run_id": run_id, "status": "running"}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@app.get("/runs/{run_id}/csv")
def get_csv(run_id: str):
    run = RUNS.get(run_id)
    if not run or run["status"] != "done" or not run["result"].get("csv_path"):
        raise HTTPException(status_code=404, detail="CSV not ready")
    return FileResponse(run["result"]["csv_path"], filename="rankscale_import.csv")