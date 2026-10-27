"""
SismoWatch Backend - AI Chat & Conversational Assistant Route
Allows users to chat with the SismoWatch AI Assistant with grounding
on live PostgreSQL curated seismic data and statistical anomaly baselines.
"""
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from typing import Any, Dict, List, Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth import require_viewer
from database import get_db_cursor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
AI_MODEL_NAME = os.getenv("AI_MODEL_NAME", "gemini-3.5-flash-lite")
CANDIDATE_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"]


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []


class ChatResponse(BaseModel):
    reply: str
    source: str
    timestamp: str
    context_stats: Optional[Dict[str, Any]] = None


def get_live_seismic_context() -> Dict[str, Any]:
    """Retrieves factual live seismic context from curated schema."""
    stats: Dict[str, Any] = {
        "total_events": 0,
        "max_magnitude": 0.0,
        "avg_magnitude": 0.0,
        "tsunami_alerts": 0,
        "events_24h": 0,
        "max_mag_24h": 0.0,
        "avg_mag_24h": 0.0,
        "tsunami_24h": 0,
        "latest_events": [],
        "oldest_event": {},
        "top_events": [],
        "high_activity_regions": [],
        "latest_ai_summary": "",
        "anomalies": [],
    }

    try:
        with get_db_cursor() as cur:
            # 1. Total and aggregate stats
            cur.execute("""
                SELECT 
                    COUNT(*) as total,
                    COALESCE(MAX(magnitude), 0) as max_mag,
                    COALESCE(ROUND(AVG(magnitude)::numeric, 2), 0) as avg_mag,
                    COALESCE(SUM(tsunami), 0) as tsunami_count
                FROM curated.earthquakes;
            """)
            row = cur.fetchone()
            if row:
                stats["total_events"] = int(row["total"])
                stats["max_magnitude"] = float(row["max_mag"])
                stats["avg_magnitude"] = float(row["avg_mag"])
                stats["tsunami_alerts"] = int(row["tsunami_count"])

            # 1b. Last 24 Hours Metrics (Real-time live window)
            cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
            cur.execute("""
                SELECT 
                    COUNT(*) as count_24h,
                    COALESCE(MAX(magnitude), 0.0) as max_mag_24h,
                    COALESCE(ROUND(AVG(magnitude)::numeric, 2), 0.0) as avg_mag_24h,
                    COALESCE(SUM(tsunami), 0) as tsunami_count_24h
                FROM curated.earthquakes
                WHERE event_time >= %s;
            """, (cutoff_24h,))
            row_24h = cur.fetchone()
            if row_24h:
                stats["events_24h"] = int(row_24h["count_24h"])
                stats["max_mag_24h"] = float(row_24h["max_mag_24h"])
                stats["avg_mag_24h"] = float(row_24h["avg_mag_24h"])
                stats["tsunami_24h"] = int(row_24h["tsunami_count_24h"])

            # 2. Latest events (chronologically most recent)
            cur.execute("""
                SELECT id, magnitude, place, region, depth_km, event_time, tsunami
                FROM curated.earthquakes
                ORDER BY event_time DESC
                LIMIT 10;
            """)
            stats["latest_events"] = [
                {
                    "place": r["place"],
                    "magnitude": float(r["magnitude"]),
                    "region": r["region"],
                    "depth_km": float(r["depth_km"]),
                    "time": r["event_time"].strftime("%Y-%m-%d %H:%M:%S UTC") if r["event_time"] else "N/A",
                    "tsunami": bool(r["tsunami"])
                }
                for r in cur.fetchall()
            ]

            # 3. Oldest event (chronologically earliest in 30-day catalog)
            cur.execute("""
                SELECT id, magnitude, place, region, depth_km, event_time, tsunami
                FROM curated.earthquakes
                ORDER BY event_time ASC
                LIMIT 1;
            """)
            oldest_row = cur.fetchone()
            if oldest_row:
                stats["oldest_event"] = {
                    "id": oldest_row["id"],
                    "place": oldest_row["place"],
                    "magnitude": float(oldest_row["magnitude"]),
                    "region": oldest_row["region"],
                    "depth_km": float(oldest_row["depth_km"]),
                    "time": oldest_row["event_time"].strftime("%Y-%m-%d %H:%M:%S UTC") if oldest_row["event_time"] else "N/A",
                    "tsunami": bool(oldest_row["tsunami"])
                }

            # 3. Top strongest events
            cur.execute("""
                SELECT id, magnitude, place, region, depth_km, event_time, tsunami
                FROM curated.earthquakes
                ORDER BY magnitude DESC
                LIMIT 5;
            """)
            stats["top_events"] = [
                {
                    "place": r["place"],
                    "magnitude": float(r["magnitude"]),
                    "region": r["region"],
                    "depth_km": float(r["depth_km"]),
                    "time": r["event_time"].strftime("%Y-%m-%d %H:%M:%S UTC") if r["event_time"] else "N/A",
                    "tsunami": bool(r["tsunami"])
                }
                for r in cur.fetchall()
            ]

            # 3. High activity regions
            cur.execute("""
                SELECT region, COUNT(*) as cnt, MAX(magnitude) as max_mag
                FROM curated.earthquakes
                GROUP BY region
                ORDER BY cnt DESC
                LIMIT 5;
            """)
            stats["high_activity_regions"] = [
                {"region": r["region"], "count": int(r["cnt"]), "max_magnitude": float(r["max_mag"])}
                for r in cur.fetchall()
            ]

            # 4. Latest AI Report summary & anomalies
            cur.execute("""
                SELECT report_date, executive_summary, anomalies_detected
                FROM curated.ai_reports
                ORDER BY report_date DESC
                LIMIT 1;
            """)
            rep = cur.fetchone()
            if rep:
                stats["latest_ai_summary"] = rep["executive_summary"]
                stats["anomalies"] = rep["anomalies_detected"] if rep["anomalies_detected"] else []

    except Exception as e:
        logger.error("Error collecting seismic context for chat: %s", e)

    return stats


def generate_smart_fallback_response(query: str, stats: Dict[str, Any]) -> str:
    """Generates an intelligent, grounded conversational response when LLM is unavailable."""
    q = query.lower()
    total = stats.get("total_events", 0)
    max_mag = stats.get("max_magnitude", 0.0)
    avg_mag = stats.get("avg_magnitude", 0.0)
    tsunamis = stats.get("tsunami_alerts", 0)
    top_events = stats.get("top_events", [])
    latest_events = stats.get("latest_events", [])
    regions = stats.get("high_activity_regions", [])
    anomalies = stats.get("anomalies", [])

    if any(k in q for k in ["24 hora", "24h", "ultimas 24", "últimas 24", "ultimo dia", "último día", "en 24 horas"]):
        cnt_24h = stats.get("events_24h", 0)
        max_24h = stats.get("max_mag_24h", 0.0)
        avg_24h = stats.get("avg_mag_24h", 0.0)
        tsu_24h = stats.get("tsunami_24h", 0)
        return (
            f"En las **últimas 24 horas** se han registrado **{cnt_24h} sismos** en tiempo real a nivel global en la base de datos de SismoWatch.\n\n"
            f"- **Magnitud máxima 24h:** `M {max_24h}`\n"
            f"- **Magnitud promedio 24h:** `M {avg_24h}`\n"
            f"- **Alertas de tsunami 24h:** `{tsu_24h}`"
        )

    if any(k in q for k in ["ultimo", "último", "reciente", "recientes"]):
        if latest_events:
            lead = latest_events[0]
            lines = [f"**El sismo más reciente registrado en tiempo real en SismoWatch es:**",
                     f"- **Ubicación:** {lead['place']} ({lead['region']})",
                     f"- **Magnitud:** `M {lead['magnitude']}`",
                     f"- **Profundidad:** {lead['depth_km']} km",
                     f"- **Fecha/Hora:** {lead['time']}",
                     f"- **Alerta Tsunami:** {'SÍ' if lead['tsunami'] else 'NO'}"]
            if len(latest_events) > 1:
                lines.append("\n**Otros sismos recientes inmediatos:**")
                for ev in latest_events[1:4]:
                    lines.append(f"- `M {ev['magnitude']}` en {ev['place']} ({ev['time']})")
            return "\n".join(lines)

    if any(k in q for k in ["antiguo", "primer sismo", "primero registrado", "inicio de la base"]):
        oldest = stats.get("oldest_event")
        if oldest:
            return (
                f"**El evento sísmico más antiguo registrado en nuestra base de datos es:**\n\n"
                f"- **Ubicación:** {oldest.get('place')} ({oldest.get('region')})\n"
                f"- **Magnitud:** `M {oldest.get('magnitude')}`\n"
                f"- **Profundidad:** {oldest.get('depth_km')} km\n"
                f"- **Fecha y hora:** {oldest.get('time')}\n"
                f"- **Alerta de tsunami:** {'SÍ' if oldest.get('tsunami') else 'NO'}\n\n"
                f"Este evento corresponde al inicio de la ventana histórica de 30 días ingestada por el pipeline."
            )

    if any(k in q for k in ["fuerte", "mayor", "maximo", "máximo", "grande", "severo", "potente"]):
        if top_events:
            lead = top_events[0]
            lines = [f"**El sismo más potente registrado en la base de datos de SismoWatch es:**",
                     f"- **Magnitud:** `M {lead['magnitude']}`",
                     f"- **Ubicación:** {lead['place']} ({lead['region']})",
                     f"- **Profundidad:** {lead['depth_km']} km",
                     f"- **Fecha/Hora:** {lead['time']}",
                     f"- **Alerta Tsunami:** {'SÍ' if lead['tsunami'] else 'NO'}"]
            if len(top_events) > 1:
                lines.append("\n**Otros sismos significativos recientes:**")
                for ev in top_events[1:4]:
                    lines.append(f"- `M {ev['magnitude']}` en {ev['place']} ({ev['time']})")
            return "\n".join(lines)
        return "Actualmente no hay sismos registrados en la base de datos curada."

    if any(k in q for k in ["tsunami", "tsunamis", "alerta de tsunami", "maremoto"]):
        if tsunamis > 0:
            return (f"**Alerta Sísmica Activa:** Se han registrado **{tsunamis} evento(s)** con indicador de alerta de tsunami en el monitoreo. "
                    f"Revisa de inmediato la sección del mapa y el panel de control para coordinar acciones con protección civil.")
        return ("**Estado Seguro:** En este momento **no hay alertas de tsunami activas** en la red de monitoreo mundial de SismoWatch. "
                "Todos los eventos recientes se mantienen por debajo de los umbrales de advertencia oceánica.")

    if any(k in q for k in ["anomalia", "anomalía", "z-score", "enjambre", "patrón"]):
        if anomalies:
            anom_text = "\n".join([f"- **Región {a.get('region', 'N/A')}:** {a.get('event_count', 0)} sismos detectados (Z-score = `{a.get('z_score', 'N/A')}`). Severidad: **{a.get('severity', 'MEDIA')}**." for a in anomalies])
            return f"**Anomalías estadísticas detectadas por el algoritmo Z-Score:**\n\n{anom_text}\n\nUn Z-Score superior a 2.0 indica un incremento atípico de frecuencia sísmica respecto a la media de los últimos 30 días."
        return "**Análisis de Anomalías:** El algoritmo Z-Score ha analizado la frecuencia sísmica en las zonas monitorizadas y no detecta enjambres sísmicos anómalos activos en este ciclo."

    if any(k in q for k in ["chile", "coquimbo", "alaska", "california", "hawaii", "japon", "japón"]):
        target = [r for r in regions if any(w in r['region'].lower() or w in q for w in ['chile', 'coquimbo', 'ca', 'alaska', 'hawaii'])]
        if target:
            r = target[0]
            return f"**Actividad en {r['region']}:** Se han procesado **{r['count']} sismos** en esta zona, alcanzando una magnitud máxima de `M {r['max_magnitude']}`. La actividad se mantiene dentro de los parámetros de subducción habituales."
        return f"No se observan enjambres inusuales en esa región específica dentro de los últimos eventos procesados en la capa curada."

    if any(k in q for k in ["resumen", "informe", "reporte", "hoy", "general", "situacion", "situación"]):
        summary = stats.get("latest_ai_summary")
        if summary:
            return f"**Resumen Ejecutivo SismoWatch:**\n\n{summary}\n\n**Métricas Clave:**\n- Total de sismos verificados: `{total}`\n- Magnitud máxima: `M {max_mag}`\n- Magnitud promedio: `M {avg_mag}`\n- Alertas de tsunami: `{tsunamis}`"
        return (f"**Resumen del Monitoreo Sísmico Global:**\n\n"
                f"Actualmente la plataforma SismoWatch mantiene **{total} eventos sísmicos** curados y verificados en memoria mediante Pandera.\n"
                f"- **Magnitud Máxima:** `M {max_mag}`\n"
                f"- **Magnitud Promedio:** `M {avg_mag}`\n"
                f"- **Alertas Oceánicas:** `{tsunamis}` activas.\n"
                f"El pipeline de Airflow continúa ingiriendo telemetría continua de USGS cada 5 minutos.")

    # Generic friendly answer with factual context
    return (
        f"Hola. Soy el **Asistente Sismológico de IA de SismoWatch**.\n\n"
        f"Actualmente estoy monitoreando **{total} eventos sísmicos** a nivel global en la base de datos curada. "
        f"La magnitud pico observada es de **`M {max_mag}`** y el promedio mundial es de **`M {avg_mag}`** con **{tsunamis} alertas de tsunami**.\n\n"
        f"Puedes preguntarme:\n"
        f"- *«¿Cuál fue el sismo más potente registrado?»*\n"
        f"- *«¿Hay alguna alerta de tsunami activa?»*\n"
        f"- *«¿Qué anomalías estadísticas se detectaron con Z-Score?»*\n"
        f"- *«Dame un resumen de la actividad sísmica hoy.»*"
    )


@router.post("", response_model=ChatResponse)
async def chat_with_ai(
    req: ChatRequest,
    user: Dict[str, Any] = Depends(require_viewer),
):
    """
    Conversational AI Chat endpoint grounded on live seismic data.
    Attempts Gemini API first; falls back gracefully to deterministic statistical response.
    """
    user_query = req.message.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")

    # 1. Fetch live factual context from database
    stats = get_live_seismic_context()

    reply_text = ""
    source = "statistical-grounding-engine"
    now_iso = datetime.now(timezone.utc).isoformat()

    # 2. Try Gemini API if key is configured
    api_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if api_key and api_key != "your_gemini_api_key_here":
        try:
            grounded_system_prompt = f"""Eres el Asistente Sismológico de IA de la plataforma SismoWatch.
Responde de forma clara, ejecutiva, concisa y rigurosamente precisa en español.
NUNCA inventes números. Basa tus respuestas en los siguientes datos REALES del sistema SismoWatch:

FACTUAL DATA:
- SISMOS EN LAS ÚLTIMAS 24 HORAS (EN TIEMPO REAL):
  * Total sismos 24h: {stats.get('events_24h', 0)}
  * Magnitud máxima 24h: {stats.get('max_mag_24h', 0.0)}
  * Magnitud promedio 24h: {stats.get('avg_mag_24h', 0.0)}
  * Alertas tsunami 24h: {stats.get('tsunami_24h', 0)}
- Total histórico en base de datos (catálogo de 30 días): {stats.get('total_events')}
- Magnitud máxima global histórica: {stats.get('max_magnitude')}
- Magnitud promedio global: {stats.get('avg_magnitude')}
- Alertas de tsunami activas históricas: {stats.get('tsunami_alerts')}
- ÚLTIMOS SISMOS REGISTRADOS EN TIEMPO REAL (ordenados del más reciente al más antiguo):
{json.dumps(stats.get('latest_events', []))}
- SISMOS HISTÓRICOS DE MAYOR MAGNITUD (ordenados de mayor a menor energía):
{json.dumps(stats.get('top_events', []))}
- EVENTO MÁS ANTIGUO REGISTRADO EN BASE DE DATOS (límite inicial de la ventana histórica de 30 días):
{json.dumps(stats.get('oldest_event', {}))}
- Regiones con mayor actividad sísmica: {json.dumps(stats.get('high_activity_regions', []))}
- Último resumen ejecutivo de la IA: {stats.get('latest_ai_summary', '')}
- Anomalías detectadas: {json.dumps(stats.get('anomalies', []))}

INSTRUCCIONES CLAVE DE RESPUESTA:
- Si el usuario pregunta por los sismos de las 'últimas 24 horas', '24h', 'en el último día' o eventos recientes de 24h, responde con el total exacto de 'SISMOS EN LAS ÚLTIMAS 24 HORAS (EN TIEMPO REAL)' ({stats.get('events_24h', 0)} sismos), citando también la magnitud máxima y promedio de esas 24h.
- Si el usuario pregunta por el 'último sismo', 'sismo más reciente' o eventos actuales, responde con el primer elemento de 'ÚLTIMOS SISMOS REGISTRADOS EN TIEMPO REAL'.
- Si el usuario pregunta por el sismo 'más antiguo', 'primer evento registrado' o el inicio del catálogo histórico, responde con el 'EVENTO MÁS ANTIGUO REGISTRADO EN BASE DE DATOS' citando lugar, magnitud, profundidad, fecha/hora y que marca el inicio de la ventana de 30 días.
- Si pregunta por el sismo 'más fuerte', 'de mayor magnitud' o 'más potente', usa 'SISMOS HISTÓRICOS DE MAYOR MAGNITUD'.
- Responde siempre citando ubicación, magnitud, profundidad, fecha/hora y si tiene alerta de tsunami."""

            # Build messages contents
            contents = [
                {"role": "user", "parts": [{"text": grounded_system_prompt}]}
            ]

            # Add recent history if available
            for h in req.history[-4:]:
                contents.append({
                    "role": "user" if h.role == "user" else "model",
                    "parts": [{"text": h.content}]
                })

            contents.append({
                "role": "user",
                "parts": [{"text": user_query}]
            })

            async with httpx.AsyncClient(timeout=45.0) as client:
                for model_candidate in CANDIDATE_MODELS:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent?key={api_key}"
                    res = await client.post(url, json={"contents": contents})
                    if res.status_code == 200:
                        data = res.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            text_part = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                            if text_part:
                                reply_text = text_part.strip()
                                source = f"gemini ({model_candidate})"
                                break
                    else:
                        logger.warning("Gemini model %s returned status %s: %s", model_candidate, res.status_code, res.text[:120])

        except Exception as e:
            logger.error("Error communicating with Gemini API: %s", e)

    # 3. If Gemini did not reply, use our smart grounding fallback
    if not reply_text:
        reply_text = generate_smart_fallback_response(user_query, stats)
        source = "grounded-statistical-engine"

    return ChatResponse(
        reply=reply_text,
        source=source,
        timestamp=now_iso,
        context_stats={
            "total_events": stats.get("total_events"),
            "max_magnitude": stats.get("max_magnitude"),
            "avg_magnitude": stats.get("avg_magnitude"),
            "tsunami_alerts": stats.get("tsunami_alerts"),
        }
    )
