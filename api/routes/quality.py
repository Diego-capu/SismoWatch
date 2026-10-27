"""
SismoWatch Backend - Data Quality & Pipeline Status Routes
Exposes pipeline observability, freshness metrics, and in-memory quarantine audits.
"""
from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_viewer, require_admin
from database import get_db_cursor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["quality"])


class PipelineStatusResponse(BaseModel):
    pipeline_state: str
    last_ingestion_time: Optional[str]
    freshness_delay_minutes: Optional[float]
    latest_quality_score: float
    total_curated_events: int
    active_dags: List[Dict[str, str]]


class QualityMetricItem(BaseModel):
    id: int
    dag_run_id: Optional[str]
    execution_time: str
    total_evaluated: int
    total_valid: int
    total_discarded: int
    quality_score: float
    discard_reasons: Dict[str, Any]


class QuarantineAuditResponse(BaseModel):
    architecture_notice: str
    in_memory_validation_engine: str
    raw_backup_layer: str
    total_runs_evaluated: int
    total_records_evaluated: int
    total_records_discarded: int
    global_quality_score: float
    discard_reasons_summary: Dict[str, int]
    recent_runs: List[QualityMetricItem]


@router.get("/pipeline/status", response_model=PipelineStatusResponse)
async def get_pipeline_status(user: Dict[str, Any] = Depends(require_viewer)):
    """
    Returns pipeline health, data freshness, and DAG status summary.
    """
    with get_db_cursor() as cur:
        # Latest curated ingestion/update time (Platform strictly queries curated schema)
        cur.execute("SELECT MAX(updated_at) AS last_curated FROM curated.earthquakes;")
        curated_row = cur.fetchone()
        last_ingest = curated_row["last_curated"] if curated_row and curated_row.get("last_curated") else None

        # Latest quality score from quality_metrics
        cur.execute(
            """
            SELECT quality_score, execution_time 
            FROM curated.quality_metrics 
            ORDER BY execution_time DESC 
            LIMIT 1;
            """
        )
        qm_row = cur.fetchone()
        quality_score = float(qm_row["quality_score"]) if qm_row else 100.0

        # Total curated count
        cur.execute("SELECT COUNT(*) AS total FROM curated.earthquakes;")
        total_count = cur.fetchone()["total"]

    delay_min = None
    if last_ingest:
        now_utc = datetime.now(timezone.utc)
        if last_ingest.tzinfo is None:
            last_ingest = last_ingest.replace(tzinfo=timezone.utc)
        delay_min = round((now_utc - last_ingest).total_seconds() / 60.0, 1)

    return PipelineStatusResponse(
        pipeline_state="HEALTHY" if (delay_min is None or delay_min <= 30.0) else "DEGRADED",
        last_ingestion_time=last_ingest.isoformat() if last_ingest else None,
        freshness_delay_minutes=delay_min,
        latest_quality_score=quality_score,
        total_curated_events=total_count,
        active_dags=[
            {"dag_id": "usgs_pipeline_dag", "schedule": "*/5 * * * *", "description": "Ingesta continua & calidad en memoria"},
            {"dag_id": "daily_ai_report_dag", "schedule": "0 1 * * *", "description": "Síntesis ejecutiva IA & Z-Score"},
        ],
    )


@router.get("/quality/quarantine", response_model=QuarantineAuditResponse)
async def get_quarantine_audit(user: Dict[str, Any] = Depends(require_admin)):
    """
    ADMIN ONLY: Returns audit metrics of records filtered and discarded in-memory.

    ARCHITECTURAL DECISION & BUSINESS RESTRICTION:
    - In accordance with Architecture/TL decisions, NO physical quarantine table
      is implemented in the database.
    - Quality filtering occurs strictly in-memory via Pandera.
    - Invalid records are safely dropped, aggregated rejection metrics are stored
      in `curated.quality_metrics`, and original data remains intact in `raw.earthquakes`.
    """
    with get_db_cursor() as cur:
        cur.execute(
            """
            SELECT id, dag_run_id, execution_time, total_evaluated, total_valid,
                   total_discarded, quality_score, discard_reasons
            FROM curated.quality_metrics
            ORDER BY execution_time DESC
            LIMIT 50;
            """
        )
        rows = cur.fetchall()

    recent_runs = []
    total_evaluated_sum = 0
    total_discarded_sum = 0
    discard_reasons_summary: Dict[str, int] = {}

    for r in rows:
        recent_runs.append(
            QualityMetricItem(
                id=r["id"],
                dag_run_id=r.get("dag_run_id"),
                execution_time=r["execution_time"].isoformat() if r.get("execution_time") else "",
                total_evaluated=int(r["total_evaluated"]),
                total_valid=int(r["total_valid"]),
                total_discarded=int(r["total_discarded"]),
                quality_score=float(r["quality_score"]),
                discard_reasons=r.get("discard_reasons") or {},
            )
        )
        total_evaluated_sum += int(r["total_evaluated"])
        total_discarded_sum += int(r["total_discarded"])

        reasons = r.get("discard_reasons") or {}
        for reason_k, reason_cnt in reasons.items():
            discard_reasons_summary[reason_k] = discard_reasons_summary.get(reason_k, 0) + int(reason_cnt)

    global_score = (
        round(((total_evaluated_sum - total_discarded_sum) / total_evaluated_sum) * 100.0, 2)
        if total_evaluated_sum > 0
        else 100.0
    )

    return QuarantineAuditResponse(
        architecture_notice=(
            "DECISIÓN ARQUITECTURAL DE NEGOCIO: No se implementa tabla de cuarentena física en la base de datos. "
            "El filtrado de calidad se ejecuta estrictamente en memoria con Pandera. "
            "Los registros inválidos son descartados antes de curated, registrando las métricas agregadas "
            "en curated.quality_metrics. El dato original e intacto queda permanentemente respaldado en raw.earthquakes."
        ),
        in_memory_validation_engine="Pandera Schema Validator (v0.20.4+)",
        raw_backup_layer="raw.earthquakes (JSONB un-truncated USGS feed)",
        total_runs_evaluated=len(rows),
        total_records_evaluated=total_evaluated_sum,
        total_records_discarded=total_discarded_sum,
        global_quality_score=global_score,
        discard_reasons_summary=discard_reasons_summary,
        recent_runs=recent_runs,
    )
