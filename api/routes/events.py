"""
SismoWatch Backend - Seismic Events & Dashboard Routes
Provides endpoints for KPIs, paginated event queries, time series statistics,
and real-time Server-Sent Events (SSE) streaming.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import require_viewer
from database import get_db_cursor
from psycopg2 import sql as pg_sql

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])


class KpiResponse(BaseModel):
    total_events_24h: int
    max_magnitude_24h: float
    avg_magnitude_24h: float
    tsunami_alerts_24h: int
    quality_score: float
    last_updated: Optional[str]
    status: str


class EventItem(BaseModel):
    id: str
    magnitude: Optional[float]
    mag_type: Optional[str]
    place: Optional[str]
    region: Optional[str]
    event_time: str
    updated_time: Optional[str]
    longitude: float
    latitude: float
    depth_km: float
    tsunami: int
    sig: Optional[int]
    status: Optional[str]
    event_type: Optional[str]
    url: Optional[str]


class EventsListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[EventItem]


class TimeSeriesPoint(BaseModel):
    bucket: str
    event_count: int
    avg_magnitude: float
    max_magnitude: float


@router.get("/kpis", response_model=KpiResponse)
async def get_dashboard_kpis(user: Dict[str, Any] = Depends(require_viewer)):
    """
    Returns high-level seismic KPIs for the last 24 hours plus latest quality score.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    with get_db_cursor() as cur:
        # 1. 24h Seismic Metrics
        cur.execute(
            """
            SELECT 
                COUNT(*) AS total_events,
                COALESCE(MAX(magnitude), 0.0) AS max_mag,
                COALESCE(ROUND(AVG(magnitude)::numeric, 2), 0.0) AS avg_mag,
                COALESCE(SUM(CASE WHEN tsunami > 0 THEN 1 ELSE 0 END), 0) AS tsunami_count,
                MAX(event_time) AS latest_event
            FROM curated.earthquakes
            WHERE event_time >= %s;
            """,
            (cutoff,)
        )
        seismic_row = cur.fetchone()

        # 2. Latest Quality Score from in-memory evaluations
        cur.execute(
            """
            SELECT quality_score, execution_time
            FROM curated.quality_metrics
            ORDER BY execution_time DESC
            LIMIT 1;
            """
        )
        quality_row = cur.fetchone()

    total_events = int(seismic_row["total_events"]) if seismic_row else 0
    max_mag = float(seismic_row["max_mag"]) if seismic_row else 0.0
    avg_mag = float(seismic_row["avg_mag"]) if seismic_row else 0.0
    tsunamis = int(seismic_row["tsunami_count"]) if seismic_row else 0
    latest_event = seismic_row["latest_event"].isoformat() if seismic_row and seismic_row.get("latest_event") else None
    
    quality_score = float(quality_row["quality_score"]) if quality_row else 100.0

    return KpiResponse(
        total_events_24h=total_events,
        max_magnitude_24h=round(max_mag, 2),
        avg_magnitude_24h=round(avg_mag, 2),
        tsunami_alerts_24h=tsunamis,
        quality_score=round(quality_score, 2),
        last_updated=latest_event or datetime.now(timezone.utc).isoformat(),
        status="OPERATIONAL" if quality_score >= 80.0 else "DEGRADED",
    )


@router.get("/events", response_model=EventsListResponse)
async def list_curated_events(
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    min_mag: Optional[float] = Query(None, description="Minimum magnitude"),
    region: Optional[str] = Query(None, description="Region search pattern"),
    search: Optional[str] = Query(None, description="Place fulltext search"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(require_viewer),
):
    """
    Returns a paginated list of validated earthquakes from curated schema with filters.
    """
    conditions = []
    params: List[Any] = []

    if start_date:
        conditions.append(pg_sql.SQL("event_time >= %s"))
        params.append(f"{start_date} 00:00:00+00")
    if end_date:
        conditions.append(pg_sql.SQL("event_time <= %s"))
        params.append(f"{end_date} 23:59:59.999999+00")
    if min_mag is not None:
        conditions.append(pg_sql.SQL("magnitude >= %s"))
        params.append(min_mag)
    if region:
        conditions.append(pg_sql.SQL("region ILIKE %s"))
        params.append(f"%{region}%")
    if search:
        conditions.append(pg_sql.SQL("place ILIKE %s"))
        params.append(f"%{search}%")

    where_sql = pg_sql.SQL(" WHERE ") + pg_sql.SQL(" AND ").join(conditions) if conditions else pg_sql.SQL("")

    with get_db_cursor() as cur:
        # Count total matching
        count_query = pg_sql.SQL("SELECT COUNT(*) AS total FROM curated.earthquakes{}").format(where_sql)
        cur.execute(count_query, tuple(params))
        total_count = cur.fetchone()["total"]

        # Fetch page
        data_query = pg_sql.SQL(
            """
            SELECT id, magnitude, mag_type, place, region, event_time, updated_time,
                   longitude, latitude, depth_km, tsunami, sig, status, event_type, url
            FROM curated.earthquakes
            {}
            ORDER BY event_time DESC
            LIMIT %s OFFSET %s;
            """
        ).format(where_sql)
        cur.execute(data_query, tuple(params + [limit, offset]))
        rows = cur.fetchall()

    items = []
    for r in rows:
        items.append(
            EventItem(
                id=r["id"],
                magnitude=float(r["magnitude"]) if r.get("magnitude") is not None else None,
                mag_type=r.get("mag_type"),
                place=r.get("place"),
                region=r.get("region"),
                event_time=r["event_time"].isoformat() if r.get("event_time") else "",
                updated_time=r["updated_time"].isoformat() if r.get("updated_time") else None,
                longitude=float(r["longitude"]),
                latitude=float(r["latitude"]),
                depth_km=float(r["depth_km"]),
                tsunami=int(r.get("tsunami") or 0),
                sig=r.get("sig"),
                status=r.get("status"),
                event_type=r.get("event_type"),
                url=r.get("url"),
            )
        )

    return EventsListResponse(total=total_count, limit=limit, offset=offset, items=items)


@router.get("/stats/timeseries", response_model=List[TimeSeriesPoint])
async def get_timeseries_statistics(
    hours: int = Query(24, ge=1, le=168, description="Hours of history to bucket"),
    user: Dict[str, Any] = Depends(require_viewer),
):
    """
    Returns hourly seismic counts and average magnitude for chart visualizations.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    with get_db_cursor() as cur:
        sql = """
            SELECT 
                to_char(date_trunc('hour', event_time), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
                COUNT(*) AS event_count,
                COALESCE(ROUND(AVG(magnitude)::numeric, 2), 0.0) AS avg_magnitude,
                COALESCE(ROUND(MAX(magnitude)::numeric, 2), 0.0) AS max_magnitude
            FROM curated.earthquakes
            WHERE event_time >= %s
            GROUP BY date_trunc('hour', event_time)
            ORDER BY bucket ASC;
        """
        cur.execute(sql, (cutoff,))
        rows = cur.fetchall()

    return [
        TimeSeriesPoint(
            bucket=r["bucket"],
            event_count=int(r["event_count"]),
            avg_magnitude=float(r["avg_magnitude"]),
            max_magnitude=float(r["max_magnitude"]),
        )
        for r in rows
    ]


@router.get("/stream")
async def stream_live_events(user: Dict[str, Any] = Depends(require_viewer)):
    """
    Server-Sent Events (SSE) streaming endpoint for real-time seismic updates.
    Broadcasts newly ingested earthquakes or heartbeat every 5 seconds.
    """
    async def event_generator():
        last_check = datetime.now(timezone.utc) - timedelta(minutes=5)
        while True:
            try:
                with get_db_cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, magnitude, place, region, event_time, longitude, latitude, depth_km, tsunami
                        FROM curated.earthquakes
                        WHERE created_at >= %s
                        ORDER BY event_time DESC
                        LIMIT 10;
                        """,
                        (last_check,)
                    )
                    recent_events = cur.fetchall()

                last_check = datetime.now(timezone.utc)

                if recent_events:
                    payload = [
                        {
                            "id": r["id"],
                            "magnitude": float(r["magnitude"]) if r.get("magnitude") is not None else 0.0,
                            "place": r["place"],
                            "region": r["region"],
                            "event_time": r["event_time"].isoformat(),
                            "longitude": float(r["longitude"]),
                            "latitude": float(r["latitude"]),
                            "depth_km": float(r["depth_km"]),
                            "tsunami": int(r["tsunami"]),
                        }
                        for r in recent_events
                    ]
                    yield f"event: seismic_update\ndata: {json.dumps(payload)}\n\n"
                else:
                    # Heartbeat message
                    heartbeat = {
                        "type": "heartbeat",
                        "status": "LIVE",
                        "server_time": datetime.now(timezone.utc).isoformat(),
                    }
                    yield f"event: heartbeat\ndata: {json.dumps(heartbeat)}\n\n"

            except Exception as e:
                yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

            await asyncio.sleep(5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
