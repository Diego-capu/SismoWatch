"""
SismoWatch - USGS Pipeline DAG
Orchestrates automated ingestion, in-memory quality validation, and curated publishing.

Execution Rules & Best Practices:
- TaskFlow API with TaskGroup separation.
- Ingestion runs every 5 minutes (or on-demand historical backfill).
- Idempotent upserts into `raw.earthquakes` and `curated.earthquakes`.
- IN-MEMORY Pandera validation: invalid records discarded, metrics recorded to `curated.quality_metrics`.
- Blocking validation gate: prevents substandard data from reaching curated layer.
- Retries with exponential backoff and timeout protections.
"""
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from typing import Any, Dict, List
import psycopg2
from psycopg2.extras import execute_batch, Json

from airflow.decorators import dag, task, task_group
from airflow.models.param import Param
from airflow.exceptions import AirflowException

from include.transformations import transform_usgs_features
from include.validation import (
    evaluate_quality_in_memory,
    check_data_freshness,
    check_data_volume,
    validate_curation_gate,
)

logger = logging.getLogger(__name__)

DOC_MD = """
### SismoWatch USGS Seismic Pipeline
Automated end-to-end ingestion and quality pipeline for global earthquake activity.

#### Features:
1. **Source:** USGS Realtime Feed (`all_hour.geojson`) or Historical Query API.
2. **Raw Layer:** Original intact JSON payload stored in `raw.earthquakes`.
3. **In-Memory Quality Engine:** Validates data against Pandera schema without physical quarantine table.
4. **Curated Layer:** Idempotent upsert (`ON CONFLICT (id) DO UPDATE`).
5. **Observability:** Metric logging in `curated.quality_metrics` and failure alerting.
"""

def get_db_connection():
    """Returns a direct psycopg2 connection to PostgreSQL."""
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        dbname=os.getenv("POSTGRES_DB", "sismowatch"),
        user=os.getenv("POSTGRES_USER", "airflow"),
        password=os.getenv("POSTGRES_PASSWORD", "airflow_secure_password_2026"),
        connect_timeout=10,
    )

def pipeline_failure_alert(context):
    """Callback function triggered when a task fails."""
    task_instance = context.get("task_instance")
    dag_id = context.get("dag").dag_id
    execution_date = context.get("execution_date")
    error = context.get("exception")
    logger.error(
        "ALERTA SISMO-WATCH: Fallo en DAG '%s' | Tarea: '%s' | Fecha: %s | Error: %s",
        dag_id,
        task_instance.task_id if task_instance else "unknown",
        execution_date,
        error,
    )

default_args = {
    "owner": "sismowatch-data-team",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 3,
    "retry_delay": timedelta(seconds=20),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=2),
    "execution_timeout": timedelta(minutes=5),
    "on_failure_callback": pipeline_failure_alert,
}

@dag(
    dag_id="usgs_pipeline_dag",
    default_args=default_args,
    description="Pipeline de ingesta, calidad en memoria y publicación de sismos USGS",
    schedule="*/5 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["ingestion", "usgs", "sismowatch", "quality"],
    doc_md=DOC_MD,
    params={
        "backfill": Param(False, type="boolean", description="Activar backfill histórico"),
        "days": Param(30, type="integer", description="Días hacia atrás para backfill"),
        "starttime": Param("", type="string", description="Fecha inicio YYYY-MM-DD (opcional)"),
        "endtime": Param("", type="string", description="Fecha fin YYYY-MM-DD (opcional)"),
        "minmagnitude": Param(2.5, type="number", description="Magnitud mínima para backfill"),
    },
)
def usgs_pipeline():

    @task(retries=3, retry_delay=timedelta(seconds=15))
    def extract_usgs_data(**context) -> Dict[str, Any]:
        """
        Extracts earthquake GeoJSON from USGS API.
        Supports both 5-minute real-time hourly feed and 30-day historical query.
        """
        import requests
        params = context.get("params", {})
        is_backfill = params.get("backfill", False)

        if is_backfill:
            days = params.get("days", 30)
            now = datetime.now(timezone.utc)
            endtime = params.get("endtime") or now.strftime("%Y-%m-%d")
            starttime = params.get("starttime") or (now - timedelta(days=days)).strftime("%Y-%m-%d")
            min_mag = params.get("minmagnitude", 2.5)

            url = (
                f"https://earthquake.usgs.gov/fdsnws/event/1/query?"
                f"format=geojson&starttime={starttime}&endtime={endtime}&minmagnitude={min_mag}"
            )
            logger.info("Executing USGS Historical Backfill: %s", url)
        else:
            url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
            logger.info("Executing USGS Realtime Ingestion: %s", url)

        response = requests.get(url, timeout=30)
        response.raise_for_status()
        geojson_data = response.json()
        features = geojson_data.get("features", [])
        logger.info("Retrieved %d features from USGS.", len(features))
        return {"features": features, "extracted_at": datetime.now(timezone.utc).isoformat()}

    @task
    def load_raw_earthquakes(extraction_payload: Dict[str, Any]) -> int:
        """
        Idempotently persists the intact raw GeoJSON payloads into `raw.earthquakes`.
        """
        features = extraction_payload.get("features", [])
        if not features:
            logger.info("No features to store in raw layer.")
            return 0

        conn = get_db_connection()
        upsert_count = 0
        try:
            with conn.cursor() as cur:
                records = []
                for f in features:
                    f_id = f.get("id")
                    if not f_id:
                        continue
                    time_ms = (f.get("properties") or {}).get("time") or 0
                    event_dt = datetime.fromtimestamp(time_ms / 1000.0, tz=timezone.utc)
                    records.append((f_id, event_dt, Json(f)))

                sql = """
                INSERT INTO raw.earthquakes (id, event_time, payload, ingested_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE 
                SET payload = EXCLUDED.payload,
                    event_time = EXCLUDED.event_time,
                    ingested_at = NOW();
                """
                execute_batch(cur, sql, records, page_size=200)
                conn.commit()
                upsert_count = len(records)
                logger.info("Successfully upserted %d records into raw.earthquakes.", upsert_count)
        finally:
            conn.close()

        return upsert_count

    @task_group(group_id="quality_and_transformation")
    def process_quality(extraction_payload: Dict[str, Any]):

        @task
        def validate_and_transform_memory(payload: Dict[str, Any], **context) -> Dict[str, Any]:
            """
            Transforms features into normalized format, then evaluates quality in memory using Pandera.
            Discards invalid rows in-memory and gathers quality metrics.
            """
            features = payload.get("features", [])
            dag_run_id = str(context.get("run_id", "manual"))
            
            df = transform_usgs_features(features)
            valid_df, metrics = evaluate_quality_in_memory(df, dag_run_id=dag_run_id)

            # Freshness & volume checks
            latest_time = valid_df["event_time"].max() if not valid_df.empty else None
            freshness = check_data_freshness(latest_time)
            volume = check_data_volume(len(df))

            logger.info("Quality Evaluation complete. Score: %s%% | Valid: %d | Discarded: %d",
                        metrics["quality_score"], metrics["total_valid"], metrics["total_discarded"])

            # Convert valid_df to records (serializing timestamps to ISO strings)
            valid_records = []
            for _, r in valid_df.iterrows():
                rec = r.to_dict()
                rec["event_time"] = rec["event_time"].isoformat() if rec.get("event_time") is not None else None
                rec["updated_time"] = rec["updated_time"].isoformat() if rec.get("updated_time") is not None else None
                valid_records.append(rec)

            return {
                "valid_records": valid_records,
                "metrics": metrics,
                "freshness": freshness,
                "volume": volume,
            }

        @task
        def persist_quality_metrics(processed_data: Dict[str, Any]) -> None:
            """
            Persists aggregated data quality metrics into `curated.quality_metrics`.
            """
            metrics = processed_data.get("metrics", {})
            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    sql = """
                    INSERT INTO curated.quality_metrics 
                    (dag_run_id, execution_time, total_evaluated, total_valid, total_discarded, quality_score, discard_reasons)
                    VALUES (%s, NOW(), %s, %s, %s, %s, %s);
                    """
                    cur.execute(
                        sql,
                        (
                            metrics.get("dag_run_id"),
                            metrics.get("total_evaluated", 0),
                            metrics.get("total_valid", 0),
                            metrics.get("total_discarded", 0),
                            metrics.get("quality_score", 100.0),
                            Json(metrics.get("discard_reasons", {})),
                        )
                    )
                    conn.commit()
                    logger.info("Saved quality metrics to curated.quality_metrics.")
            finally:
                conn.close()

        @task
        def enforce_curation_gate(processed_data: Dict[str, Any]) -> None:
            """
            Blocking Task: Fails the pipeline if quality SLA is breached.
            """
            metrics = processed_data.get("metrics", {})
            validate_curation_gate(metrics, min_score_threshold=50.0)

        @task
        def load_curated_earthquakes(processed_data: Dict[str, Any]) -> int:
            """
            Idempotent upsert of validated records into `curated.earthquakes`.
            """
            valid_records = processed_data.get("valid_records", [])
            if not valid_records:
                logger.info("No valid records to load into curated layer.")
                return 0

            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    records = []
                    for r in valid_records:
                        records.append((
                            r["id"],
                            r["magnitude"],
                            r["mag_type"],
                            r["place"],
                            r["event_time"],
                            r["updated_time"],
                            r["longitude"],
                            r["latitude"],
                            r["depth_km"],
                            r["tsunami"],
                            r["sig"],
                            r["status"],
                            r["event_type"],
                            r["url"],
                            r["region"],
                        ))

                    sql = """
                    INSERT INTO curated.earthquakes (
                        id, magnitude, mag_type, place, event_time, updated_time,
                        longitude, latitude, depth_km, tsunami, sig, status,
                        event_type, url, region, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        magnitude = EXCLUDED.magnitude,
                        mag_type = EXCLUDED.mag_type,
                        place = EXCLUDED.place,
                        event_time = EXCLUDED.event_time,
                        updated_time = EXCLUDED.updated_time,
                        longitude = EXCLUDED.longitude,
                        latitude = EXCLUDED.latitude,
                        depth_km = EXCLUDED.depth_km,
                        tsunami = EXCLUDED.tsunami,
                        sig = EXCLUDED.sig,
                        status = EXCLUDED.status,
                        event_type = EXCLUDED.event_type,
                        url = EXCLUDED.url,
                        region = EXCLUDED.region,
                        updated_at = NOW();
                    """
                    execute_batch(cur, sql, records, page_size=200)
                    conn.commit()
                    logger.info("Upserted %d records into curated.earthquakes.", len(records))
                    return len(records)
            finally:
                conn.close()

        processed = validate_and_transform_memory(extraction_payload)
        metrics_save = persist_quality_metrics(processed)
        gate = enforce_curation_gate(processed)
        load_curated = load_curated_earthquakes(processed)

        # Gate and metrics persist must run before final load to curated
        metrics_save >> gate >> load_curated
        return load_curated

    # DAG Dependency graph
    raw_data = extract_usgs_data()
    raw_load = load_raw_earthquakes(raw_data)
    curated_process = process_quality(raw_data)

    raw_load >> curated_process

usgs_pipeline_instance = usgs_pipeline()
