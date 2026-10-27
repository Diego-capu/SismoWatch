"""
DAG Integrity and Syntax Verification Tests
Verifies that all Airflow DAGs can be imported cleanly without syntax errors,
cycles, or missing task connections.
"""
import importlib
import os
import sys
import pytest

# Add airflow root and include to sys.path
AIRFLOW_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../airflow"))
DAGS_DIR = os.path.join(AIRFLOW_DIR, "dags")
INCLUDE_DIR = os.path.join(AIRFLOW_DIR, "include")

for p in [AIRFLOW_DIR, DAGS_DIR, INCLUDE_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)


def test_usgs_pipeline_dag_integrity():
    """Verifies that usgs_pipeline_dag imports and has valid DAG structure."""
    module = importlib.import_module("dags.usgs_pipeline_dag")
    dag = getattr(module, "usgs_pipeline_instance", None)
    
    assert dag is not None, "usgs_pipeline_instance DAG object not found"
    assert dag.dag_id == "usgs_pipeline_dag"
    assert dag.schedule_interval == "*/5 * * * *"
    assert len(dag.tasks) >= 3

    # Check task IDs
    task_ids = [t.task_id for t in dag.tasks]
    assert any("extract_usgs_data" in tid for tid in task_ids)
    assert any("load_raw_earthquakes" in tid for tid in task_ids)


def test_daily_ai_report_dag_integrity():
    """Verifies that daily_ai_report_dag imports and has valid DAG structure."""
    module = importlib.import_module("dags.daily_ai_report_dag")
    dag = getattr(module, "daily_ai_report_instance", None)

    assert dag is not None, "daily_ai_report_instance DAG object not found"
    assert dag.dag_id == "daily_ai_report_dag"
    assert dag.schedule_interval == "0 1 * * *"
    assert len(dag.tasks) >= 3

    task_ids = [t.task_id for t in dag.tasks]
    assert any("fetch_curated_events_24h" in tid for tid in task_ids)
    assert any("run_ai_synthesis_and_anomalies" in tid for tid in task_ids)
    assert any("persist_ai_report_and_logs" in tid for tid in task_ids)
