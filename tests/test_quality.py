"""
Unit tests for data quality and in-memory validation rules.
"""
from datetime import datetime, timezone
import os
import sys
import pandas as pd
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../airflow")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../airflow/include")))

from include.validation import (
    validate_row_in_memory,
    evaluate_quality_in_memory,
    validate_curation_gate,
    check_data_freshness,
    check_data_volume,
)


def test_validate_row_valid():
    valid_row = pd.Series({
        "id": "valid_001",
        "magnitude": 4.5,
        "event_time": datetime.now(timezone.utc),
        "latitude": 34.05,
        "longitude": -118.25,
        "depth_km": 12.5,
        "tsunami": 0,
    })
    is_valid, reasons = validate_row_in_memory(valid_row)
    assert is_valid is True
    assert len(reasons) == 0


def test_validate_row_invalid_coordinates():
    invalid_row = pd.Series({
        "id": "invalid_coords",
        "magnitude": 3.0,
        "event_time": datetime.now(timezone.utc),
        "latitude": 95.0,  # Invalid: > 90
        "longitude": -200.0,  # Invalid: < -180
        "depth_km": 10.0,
        "tsunami": 0,
    })
    is_valid, reasons = validate_row_in_memory(invalid_row)
    assert is_valid is False
    assert any("latitude_out_of_range" in r for r in reasons)
    assert any("longitude_out_of_range" in r for r in reasons)


def test_validate_row_missing_id():
    invalid_row = pd.Series({
        "id": "",  # Empty ID
        "magnitude": 2.0,
        "event_time": datetime.now(timezone.utc),
        "latitude": 10.0,
        "longitude": 20.0,
        "depth_km": 5.0,
        "tsunami": 0,
    })
    is_valid, reasons = validate_row_in_memory(invalid_row)
    assert is_valid is False
    assert "missing_or_empty_id" in reasons


def test_evaluate_quality_in_memory_metrics_calculation():
    """
    Evaluates batch with 2 valid and 2 invalid records.
    Verifies that invalid records are discarded strictly in-memory
    and quality metrics aggregate correctly.
    """
    batch = pd.DataFrame([
        {
            "id": "eq_valid_1",
            "magnitude": 3.2,
            "event_time": datetime.now(timezone.utc),
            "latitude": 19.4,
            "longitude": -155.2,
            "depth_km": 8.0,
            "tsunami": 0,
        },
        {
            "id": "eq_valid_2",
            "magnitude": 5.8,
            "event_time": datetime.now(timezone.utc),
            "latitude": -33.4,
            "longitude": -70.6,
            "depth_km": 45.0,
            "tsunami": 1,
        },
        {
            "id": "eq_invalid_lat",
            "magnitude": 4.0,
            "event_time": datetime.now(timezone.utc),
            "latitude": -120.0,  # Out of range
            "longitude": 0.0,
            "depth_km": 10.0,
            "tsunami": 0,
        },
        {
            "id": "eq_invalid_depth",
            "magnitude": 4.0,
            "event_time": datetime.now(timezone.utc),
            "latitude": 0.0,
            "longitude": 0.0,
            "depth_km": 1500.0,  # Out of range (>1000)
            "tsunami": 0,
        },
    ])

    valid_df, metrics = evaluate_quality_in_memory(batch, dag_run_id="test_run_123")

    assert len(valid_df) == 2
    assert metrics["total_evaluated"] == 4
    assert metrics["total_valid"] == 2
    assert metrics["total_discarded"] == 2
    assert metrics["quality_score"] == 50.0
    assert "latitude_out_of_range" in metrics["discard_reasons"]
    assert "depth_out_of_range" in metrics["discard_reasons"]


def test_validate_curation_gate():
    # Pass scenario
    validate_curation_gate({"total_evaluated": 10, "total_valid": 9, "quality_score": 90.0}, min_score_threshold=70.0)

    # Fail scenario: score below threshold
    with pytest.raises(ValueError, match="Quality Gate Failed"):
        validate_curation_gate({"total_evaluated": 10, "total_valid": 4, "quality_score": 40.0}, min_score_threshold=70.0)

    # Fail scenario: 0 valid
    with pytest.raises(ValueError, match="0 valid records"):
        validate_curation_gate({"total_evaluated": 5, "total_valid": 0, "quality_score": 0.0})
