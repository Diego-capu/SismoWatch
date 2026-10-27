"""
SismoWatch - Daily AI Report DAG
Generates daily executive reports powered by Z-score anomaly detection and grounded LLM synthesis.

Guarantees:
- Pure deterministic metrics calculated by Python/SQL (Zero LLM hallucinations).
- Statistical anomaly detection (Z-score algorithm).
- Anti-hallucination verification.
- Safe structured fallback when LLM is unavailable or exceeds timeout.
- Full execution audit logging in `curated.ai_execution_logs`.
"""
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from typing import Any, Dict
import pandas as pd
import psycopg2
from psycopg2.extras import Json

from airflow.decorators import dag, task
from airflow.models.param import Param

from include.ai_reporter import generate_ai_report

logger = logging.getLogger(__name__)

DOC_MD = r"""
### SismoWatch Daily AI Executive Report
Automated daily analysis and executive reporting platform for seismic events.

#### Workflow:
1. **Curated Extract:** Reads past 24-hour seismic events from `curated.earthquakes`.
2. **Deterministic Calculations:** Computes total events, max magnitude, averages, tsunami alerts.
3. **ML Anomaly Detection:** Applies regional Z-score to detect seismic swarms ($Z \ge 2.0$).
4. **LLM Synthesis & Fallback:** Generates executive narrative with strict grounding guardrails.
5. **Audit Logging:** Saves reports to `curated.ai_reports` and execution telemetry to `curated.ai_execution_logs`.
"""

def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        dbname=os.getenv("POSTGRES_DB", "sismowatch"),
        user=os.getenv("POSTGRES_USER", "airflow"),
        password=os.getenv("POSTGRES_PASSWORD", "airflow_secure_password_2026"),
        connect_timeout=10,
    )

def ai_failure_alert(context):
    task_instance = context.get("task_instance")
    logger.error("ALERTA AI-REPORTER: Fallo en DAG diario de reporte | Tarea: %s", task_instance.task_id if task_instance else "")

default_args = {
    "owner": "sismowatch-ai-team",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(seconds=30),
    "execution_timeout": timedelta(minutes=5),
    "on_failure_callback": ai_failure_alert,
}

@dag(
    dag_id="daily_ai_report_dag",
    default_args=default_args,
    description="Genera informe diario ejecutivo con IA y detección de anomalías Z-Score",
    schedule="0 1 * * *",  # Daily at 01:00 UTC
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["ai", "reporting", "z-score", "executive"],
    doc_md=DOC_MD,
    params={
        "target_date": Param("", type="string", description="Fecha objetivo YYYY-MM-DD (dejar en blanco para ayer)"),
        "force_regenerate": Param(False, type="boolean", description="Forzar regeneración si ya existe"),
    },
)
def daily_ai_report():

    @task
    def fetch_curated_events_24h(**context) -> Dict[str, Any]:
        """
        Extracts all curated seismic events for the specified 24h window.
        """
        params = context.get("params", {})
        target_date_str = params.get("target_date")

        if not target_date_str:
            target_date = (datetime.now(timezone.utc) - timedelta(days=1)).date()
            target_date_str = target_date.strftime("%Y-%m-%d")

        start_dt = f"{target_date_str} 00:00:00+00"
        end_dt = f"{target_date_str} 23:59:59.999999+00"

        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, magnitude, mag_type, place, event_time,
                           longitude, latitude, depth_km, tsunami, sig,
                           status, event_type, url, region
                    FROM curated.earthquakes
                    WHERE event_time >= %s AND event_time <= %s
                    ORDER BY event_time ASC;
                    """,
                    (start_dt, end_dt)
                )
                rows = cur.fetchall()
                col_names = [desc[0] for desc in cur.description]
        finally:
            conn.close()

        records = [dict(zip(col_names, row)) for row in rows]
        # Serialize timestamps
        for r in records:
            if r.get("event_time"):
                r["event_time"] = r["event_time"].isoformat()

        logger.info("Retrieved %d curated events for date %s", len(records), target_date_str)
        return {"report_date": target_date_str, "events": records}

    @task
    def run_ai_synthesis_and_anomalies(data_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes statistical Z-score calculations and AI narrative synthesis.
        """
        report_date = data_payload.get("report_date")
        events = data_payload.get("events", [])
        events_df = pd.DataFrame(events)

        report, log_entry = generate_ai_report(events_df, report_date=report_date)
        return {"report": report, "log_entry": log_entry}

    @task
    def persist_ai_report_and_logs(result_payload: Dict[str, Any]) -> None:
        """
        Saves the structured executive report and execution observability log to the database.
        """
        report = result_payload.get("report", {})
        log_entry = result_payload.get("log_entry", {})

        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # 1. Upsert into curated.ai_reports
                report_sql = """
                INSERT INTO curated.ai_reports (
                    report_date, executive_summary, high_activity_zones, notable_events,
                    total_events, max_magnitude, avg_magnitude, tsunami_alerts,
                    anomalies_detected, source, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (report_date) DO UPDATE SET
                    executive_summary = EXCLUDED.executive_summary,
                    high_activity_zones = EXCLUDED.high_activity_zones,
                    notable_events = EXCLUDED.notable_events,
                    total_events = EXCLUDED.total_events,
                    max_magnitude = EXCLUDED.max_magnitude,
                    avg_magnitude = EXCLUDED.avg_magnitude,
                    tsunami_alerts = EXCLUDED.tsunami_alerts,
                    anomalies_detected = EXCLUDED.anomalies_detected,
                    source = EXCLUDED.source,
                    created_at = NOW()
                RETURNING id;
                """
                cur.execute(
                    report_sql,
                    (
                        report.get("report_date"),
                        report.get("executive_summary"),
                        Json(report.get("high_activity_zones", [])),
                        Json(report.get("notable_events", [])),
                        report.get("total_events", 0),
                        report.get("max_magnitude", 0.0),
                        report.get("avg_magnitude", 0.0),
                        report.get("tsunami_alerts", 0),
                        Json(report.get("anomalies_detected", [])),
                        report.get("source", "deterministic_fallback"),
                    )
                )
                row = cur.fetchone()
                report_id = row[0] if row else None

                # 2. Insert into curated.ai_execution_logs
                log_sql = """
                INSERT INTO curated.ai_execution_logs (
                    report_id, provider, model, prompt_tokens, completion_tokens,
                    total_tokens, latency_ms, estimated_cost_usd, status, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW());
                """
                cur.execute(
                    log_sql,
                    (
                        report_id,
                        log_entry.get("provider", "unknown"),
                        log_entry.get("model", "unknown"),
                        log_entry.get("prompt_tokens", 0),
                        log_entry.get("completion_tokens", 0),
                        log_entry.get("total_tokens", 0),
                        log_entry.get("latency_ms", 0),
                        log_entry.get("estimated_cost_usd", 0.0),
                        log_entry.get("status", "SUCCESS"),
                    )
                )
                conn.commit()
                logger.info("Successfully persisted AI Report id=%s and execution logs.", report_id)
        finally:
            conn.close()

    events_data = fetch_curated_events_24h()
    ai_results = run_ai_synthesis_and_anomalies(events_data)
    persist_ai_report_and_logs(ai_results)

daily_ai_report_instance = daily_ai_report()
