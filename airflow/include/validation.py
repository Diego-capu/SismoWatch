"""
SismoWatch - Data Quality and Validation Module
Implements in-memory data quality checks using Pandera.

ARCHITECTURAL DECISION & BUSINESS RESTRICTION:
- NO physical quarantine table in the database.
- Quality filtering is executed strictly in-memory. Invalid records are filtered out,
  and aggregated quality metrics (total evaluated, valid, discarded, and score)
  are recorded into `curated.quality_metrics`.
- The raw, untruncated payload always remains backed up in `raw.earthquakes`.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import pandas as pd
import pandera as pa
from pandera import Check, Column, DataFrameSchema


# Pandera Schema for Curated Earthquakes
CuratedEarthquakeSchema = DataFrameSchema(
    columns={
        "id": Column(
            pa.String,
            checks=[
                Check(lambda s: s.str.strip().str.len() > 0, error="id_empty"),
            ],
            nullable=False,
            coerce=True,
        ),
        "magnitude": Column(
            pa.Float,
            checks=[
                Check.in_range(-2.0, 10.0, error="magnitude_out_of_range"),
            ],
            nullable=True,
            coerce=True,
        ),
        "mag_type": Column(pa.String, nullable=True, coerce=True),
        "place": Column(pa.String, nullable=True, coerce=True),
        "event_time": Column(
            pa.DateTime,
            checks=[
                Check(lambda dt: dt <= pd.Timestamp.now(tz=timezone.utc) + pd.Timedelta(hours=1),
                      error="event_time_in_future")
            ],
            nullable=False,
            coerce=True,
        ),
        "updated_time": Column(pa.DateTime, nullable=True, coerce=True),
        "longitude": Column(
            pa.Float,
            checks=[
                Check.in_range(-180.0, 180.0, error="longitude_out_of_range"),
            ],
            nullable=False,
            coerce=True,
        ),
        "latitude": Column(
            pa.Float,
            checks=[
                Check.in_range(-90.0, 90.0, error="latitude_out_of_range"),
            ],
            nullable=False,
            coerce=True,
        ),
        "depth_km": Column(
            pa.Float,
            checks=[
                Check.in_range(-10.0, 1000.0, error="depth_out_of_range"),
            ],
            nullable=False,
            coerce=True,
        ),
        "tsunami": Column(
            pa.Int,
            checks=[
                Check.isin([0, 1], error="tsunami_invalid_binary"),
            ],
            nullable=True,
            coerce=True,
        ),
        "sig": Column(pa.Int, nullable=True, coerce=True),
        "status": Column(pa.String, nullable=True, coerce=True),
        "event_type": Column(pa.String, nullable=True, coerce=True),
        "url": Column(pa.String, nullable=True, coerce=True),
        "region": Column(pa.String, nullable=True, coerce=True),
    },
    strict=False,
    coerce=True,
)


def validate_row_in_memory(row: pd.Series) -> Tuple[bool, List[str]]:
    """
    Evaluates individual row against seismic quality constraints in memory.
    Returns (is_valid, list_of_failure_reasons).
    """
    reasons: List[str] = []
    
    # 1. Mandatory ID
    row_id = str(row.get("id") or "").strip()
    if not row_id:
        reasons.append("missing_or_empty_id")

    # 2. Coordinates constraints
    lat = row.get("latitude")
    if pd.isna(lat) or not isinstance(lat, (int, float)):
        reasons.append("missing_latitude")
    elif not (-90.0 <= float(lat) <= 90.0):
        reasons.append(f"latitude_out_of_range({lat})")

    lon = row.get("longitude")
    if pd.isna(lon) or not isinstance(lon, (int, float)):
        reasons.append("missing_longitude")
    elif not (-180.0 <= float(lon) <= 180.0):
        reasons.append(f"longitude_out_of_range({lon})")

    # 3. Depth constraint
    depth = row.get("depth_km")
    if pd.isna(depth) or not isinstance(depth, (int, float)):
        reasons.append("missing_depth")
    elif not (-10.0 <= float(depth) <= 1000.0):
        reasons.append(f"depth_out_of_range({depth})")

    # 4. Magnitude constraint (if present)
    mag = row.get("magnitude")
    if not pd.isna(mag) and isinstance(mag, (int, float)):
        if not (-2.0 <= float(mag) <= 10.0):
            reasons.append(f"magnitude_out_of_range({mag})")

    # 5. Timestamp constraint
    event_time = row.get("event_time")
    if pd.isna(event_time):
        reasons.append("missing_event_time")

    # 6. Tsunami indicator
    tsunami = row.get("tsunami")
    if not pd.isna(tsunami) and tsunami not in (0, 1, 0.0, 1.0):
        reasons.append("invalid_tsunami_flag")

    is_valid = len(reasons) == 0
    return is_valid, reasons


def evaluate_quality_in_memory(
    df: pd.DataFrame, dag_run_id: str = "manual_execution"
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Evaluates data quality strictly in-memory.
    Invalid records are dropped, and aggregated metrics are produced
    for persistence in `curated.quality_metrics`.
    """
    total_evaluated = len(df)
    if total_evaluated == 0:
        return df, {
            "dag_run_id": dag_run_id,
            "total_evaluated": 0,
            "total_valid": 0,
            "total_discarded": 0,
            "quality_score": 100.0,
            "discard_reasons": {},
        }

    valid_indices = []
    discard_reasons: Dict[str, int] = {}
    seen_ids = set()

    for idx, row in df.iterrows():
        row_id = str(row.get("id") or "").strip()
        
        # Deduplication in batch
        if row_id in seen_ids:
            discard_reasons["duplicate_id_in_batch"] = discard_reasons.get("duplicate_id_in_batch", 0) + 1
            continue
        
        is_valid, reasons = validate_row_in_memory(row)
        if is_valid:
            seen_ids.add(row_id)
            valid_indices.append(idx)
        else:
            for r in reasons:
                # Group parametric errors to high level category
                category = r.split("(")[0]
                discard_reasons[category] = discard_reasons.get(category, 0) + 1

    valid_df = df.loc[valid_indices].copy()
    total_valid = len(valid_df)
    total_discarded = total_evaluated - total_valid
    quality_score = round((total_valid / total_evaluated) * 100.0, 2) if total_evaluated > 0 else 100.0

    metrics = {
        "dag_run_id": dag_run_id,
        "total_evaluated": total_evaluated,
        "total_valid": total_valid,
        "total_discarded": total_discarded,
        "quality_score": quality_score,
        "discard_reasons": discard_reasons,
    }

    return valid_df, metrics


def check_data_freshness(latest_event_time: Optional[datetime], max_delay_minutes: int = 180) -> Dict[str, Any]:
    """
    Verifies that incoming seismic data is not stale.
    """
    if latest_event_time is None:
        return {"fresh": False, "delay_minutes": None, "message": "No event timestamp provided."}

    now_utc = datetime.now(timezone.utc)
    if latest_event_time.tzinfo is None:
        latest_event_time = latest_event_time.replace(tzinfo=timezone.utc)

    diff = (now_utc - latest_event_time).total_seconds() / 60.0
    return {
        "fresh": diff <= max_delay_minutes,
        "delay_minutes": round(diff, 1),
        "message": "Fresh data" if diff <= max_delay_minutes else f"Data delayed by {round(diff, 1)} minutes.",
    }


def check_data_volume(count: int, min_expected: int = 0, max_expected: int = 10000) -> Dict[str, Any]:
    """
    Verifies that the ingested event count is within normal expected volume bounds.
    """
    is_normal = min_expected <= count <= max_expected
    return {
        "normal_volume": is_normal,
        "count": count,
        "min_expected": min_expected,
        "max_expected": max_expected,
        "message": "Normal volume" if is_normal else f"Abnormal volume count: {count}",
    }


def validate_curation_gate(quality_metrics: Dict[str, Any], min_score_threshold: float = 60.0) -> None:
    """
    Blocking gate: If data quality score is below the SLA threshold or zero valid records exist
    when records were evaluated, raises an exception to block downstream publishing.
    """
    total_eval = quality_metrics.get("total_evaluated", 0)
    total_val = quality_metrics.get("total_valid", 0)
    score = quality_metrics.get("quality_score", 0.0)

    if total_eval > 0 and total_val == 0:
        raise ValueError("Quality Gate Failed: 0 valid records found in batch. Ingestion to curated blocked.")

    if total_eval > 0 and score < min_score_threshold:
        raise ValueError(
            f"Quality Gate Failed: Quality score {score}% is below minimum SLA threshold ({min_score_threshold}%)."
        )
