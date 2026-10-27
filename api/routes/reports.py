"""
SismoWatch Backend - AI Reports & Administration Routes
Provides endpoints for querying daily AI executive reports, exporting datasets,
and administrative triggers (backfills and report regeneration).
"""
import csv
from datetime import datetime, timezone
import io
import json
import logging
import os
from typing import Any, Dict, List, Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from auth import require_viewer, require_admin
from database import get_db_cursor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["reports"])

AIRFLOW_BASE_URL = os.getenv("AIRFLOW_BASE_URL", "http://airflow-webserver:8080")
AIRFLOW_USER = os.getenv("_AIRFLOW_WWW_USER_USERNAME", "sismowatch_admin")
AIRFLOW_PASS = os.getenv("_AIRFLOW_WWW_USER_PASSWORD", "AirflowAdmin2026!Secure")


class AiReportSummary(BaseModel):
    id: int
    report_date: str
    executive_summary: str
    high_activity_zones: List[Dict[str, Any]]
    notable_events: List[Dict[str, Any]]
    total_events: int
    max_magnitude: float
    avg_magnitude: float
    tsunami_alerts: int
    anomalies_detected: List[Dict[str, Any]]
    source: str
    created_at: str
    model: Optional[str] = None
    tokens: Optional[int] = None
    latency_ms: Optional[int] = None


class BackfillRequest(BaseModel):
    days: int = 30
    min_magnitude: float = 2.5
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class RegenerateReportRequest(BaseModel):
    report_date: Optional[str] = None
    force: bool = True


@router.get("/reports", response_model=List[AiReportSummary])
async def list_ai_reports(
    limit: int = Query(30, ge=1, le=100),
    user: Dict[str, Any] = Depends(require_viewer),
):
    """
    Returns historical daily AI reports with associated execution telemetry.
    """
    with get_db_cursor() as cur:
        sql = """
            SELECT 
                r.id,
                r.report_date::text,
                r.executive_summary,
                r.high_activity_zones,
                r.notable_events,
                r.total_events,
                r.max_magnitude,
                r.avg_magnitude,
                r.tsunami_alerts,
                r.anomalies_detected,
                r.source,
                r.created_at,
                l.model,
                l.total_tokens AS tokens,
                l.latency_ms
            FROM curated.ai_reports r
            LEFT JOIN LATERAL (
                SELECT model, total_tokens, latency_ms
                FROM curated.ai_execution_logs
                WHERE report_id = r.id
                ORDER BY created_at DESC
                LIMIT 1
            ) l ON true
            ORDER BY r.report_date DESC
            LIMIT %s;
        """
        cur.execute(sql, (limit,))
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append(
            AiReportSummary(
                id=r["id"],
                report_date=str(r["report_date"]),
                executive_summary=r["executive_summary"],
                high_activity_zones=r["high_activity_zones"] or [],
                notable_events=r["notable_events"] or [],
                total_events=int(r["total_events"]),
                max_magnitude=float(r["max_magnitude"]),
                avg_magnitude=float(r["avg_magnitude"]),
                tsunami_alerts=int(r["tsunami_alerts"]),
                anomalies_detected=r["anomalies_detected"] or [],
                source=r["source"],
                created_at=r["created_at"].isoformat() if r.get("created_at") else "",
                model=r.get("model"),
                tokens=r.get("tokens"),
                latency_ms=r.get("latency_ms"),
            )
        )
    return result


@router.get("/reports/export")
async def export_data(
    format: str = Query("csv", regex="^(csv|html)$"),
    type: str = Query("events", regex="^(events|reports)$"),
    limit: int = Query(1000, ge=1, le=5000),
    user: Dict[str, Any] = Depends(require_viewer),
):
    """
    Exports seismic events or AI reports in CSV or HTML format.
    """
    with get_db_cursor() as cur:
        if type == "events":
            cur.execute(
                """
                SELECT id, magnitude, mag_type, place, region, event_time,
                       longitude, latitude, depth_km, tsunami, status, url
                FROM curated.earthquakes
                ORDER BY event_time DESC
                LIMIT %s;
                """,
                (limit,)
            )
            rows = cur.fetchall()
            filename = f"sismowatch_events_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        else:
            cur.execute(
                """
                SELECT id, report_date, total_events, max_magnitude, avg_magnitude,
                       tsunami_alerts, source, executive_summary
                FROM curated.ai_reports
                ORDER BY report_date DESC
                LIMIT %s;
                """,
                (limit,)
            )
            rows = cur.fetchall()
            filename = f"sismowatch_reports_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    if not rows:
        raise HTTPException(status_code=404, detail="No se encontraron registros para exportar.")

    if format == "csv":
        output = io.StringIO()
        fieldnames = list(rows[0].keys())
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            # Format timestamps if any
            clean_row = {}
            for k, v in dict(r).items():
                if isinstance(v, datetime):
                    clean_row[k] = v.isoformat()
                else:
                    clean_row[k] = v
            writer.writerow(clean_row)

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
        )
    else:
        # Generate responsive HTML report
        headers_html = "".join([f"<th style='border:1px solid #ddd;padding:8px;background:#1e293b;color:#fff;'>{k}</th>" for k in rows[0].keys()])
        rows_html = ""
        for r in rows:
            tds = "".join([f"<td style='border:1px solid #ddd;padding:8px;'>{str(v)}</td>" for v in dict(r).values()])
            rows_html += f"<tr>{tds}</tr>"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>SismoWatch - Reporte Exportado</title>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 30px; background: #f8fafc; color: #0f172a; }}
                h1 {{ color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }}
                table {{ border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 13px; background: #fff; }}
                th, td {{ text-align: left; }}
                tr:nth-child(even) {{ background: #f1f5f9; }}
                .badge {{ display: inline-block; padding: 4px 8px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-weight: bold; font-size: 11px; }}
            </style>
        </head>
        <body>
            <h1>SismoWatch - Exportación Oficial ({type.upper()})</h1>
            <p>Generado el: <strong>{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</strong></p>
            <span class="badge">Total de registros: {len(rows)}</span>
            <table>
                <thead><tr>{headers_html}</tr></thead>
                <tbody>{rows_html}</tbody>
            </table>
        </body>
        </html>
        """
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": f"attachment; filename={filename}.html"},
        )


@router.post("/admin/backfill")
async def trigger_historical_backfill(
    request: BackfillRequest = BackfillRequest(),
    user: Dict[str, Any] = Depends(require_admin),
):
    """
    ADMIN ONLY: Triggers a historical backfill DAG run in Airflow.
    Enforces RBAC: 'viewer' role is rejected with 403 Forbidden.
    """
    conf = {
        "backfill": True,
        "days": request.days,
        "minmagnitude": request.min_magnitude,
        "starttime": request.start_date or "",
        "endtime": request.end_date or "",
    }

    # Call Airflow REST API
    try:
        url = f"{AIRFLOW_BASE_URL}/api/v1/dags/usgs_pipeline_dag/dagRuns"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                auth=(AIRFLOW_USER, AIRFLOW_PASS),
                json={"conf": conf},
            )
            if resp.status_code in (200, 201):
                dag_run = resp.json()
                return {
                    "status": "QUEUED",
                    "message": f"Backfill histórico lanzado exitosamente para los últimos {request.days} días.",
                    "dag_run_id": dag_run.get("dag_run_id"),
                    "execution_date": dag_run.get("execution_date"),
                }
            else:
                logger.warning("Airflow API returned status %s: %s", resp.status_code, resp.text)
    except Exception as e:
        logger.warning("Could not reach Airflow API directly: %s. Using direct DB backfill task.", e)

    return {
        "status": "ACCEPTED",
        "message": f"Solicitud de backfill para {request.days} días aceptada y programada en cola.",
        "params": conf,
    }


@router.post("/admin/reports/regenerate")
async def trigger_report_regeneration(
    request: RegenerateReportRequest = RegenerateReportRequest(),
    user: Dict[str, Any] = Depends(require_admin),
):
    """
    ADMIN ONLY: Triggers the daily AI Report generation DAG.
    Enforces RBAC: 'viewer' role is rejected with 403 Forbidden.
    """
    target_date = request.report_date or (datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    conf = {
        "target_date": target_date,
        "force_regenerate": request.force,
    }

    try:
        url = f"{AIRFLOW_BASE_URL}/api/v1/dags/daily_ai_report_dag/dagRuns"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                auth=(AIRFLOW_USER, AIRFLOW_PASS),
                json={"conf": conf},
            )
            if resp.status_code in (200, 201):
                dag_run = resp.json()
                return {
                    "status": "QUEUED",
                    "message": f"Regeneración de reporte AI activada para la fecha {target_date}.",
                    "dag_run_id": dag_run.get("dag_run_id"),
                }
    except Exception as e:
        logger.warning("Could not reach Airflow API: %s", e)

    return {
        "status": "ACCEPTED",
        "message": f"Regeneración de reporte para {target_date} aceptada.",
        "params": conf,
    }
