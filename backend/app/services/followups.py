"""Workflow 2 follow-ups that run after new measurements are saved."""
from __future__ import annotations


def after_load(property_id: str | None) -> dict:
    """Auto alerts + outcome refresh. Never fails the upload that triggered it."""
    if not property_id:
        return {}
    from .workflow2 import detect_alerts, refresh_outcomes
    try:
        alerts = detect_alerts(property_id)
        refresh_outcomes(property_id)
        return {"alerts": len(alerts.get("alerts", [])), "alerts_checked": alerts.get("checked", False),
                "alerts_note": alerts.get("reason")}
    except Exception as e:  # noqa: BLE001 — report, don't raise
        return {"alerts_error": str(e)}
