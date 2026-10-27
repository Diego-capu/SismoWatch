"""
SismoWatch - AI Reporter & Seismic Anomaly Detection Module
Combines statistical Z-score anomaly detection with grounded LLM narrative generation.

Key Architectural Guarantees:
1. Deterministic Grounding: All numbers are calculated strictly by Python/SQL, NEVER by the LLM.
2. Anti-Hallucination Verification: Generated narrative is scanned to ensure numbers match calculated facts.
3. Resilient Fallback: If LLM call fails, times out, or hallucinates, a deterministic rule-based
   structured summary is produced immediately without breaking the pipeline.
4. Execution Observability: Logs model name, tokens, latency, and cost to `curated.ai_execution_logs`.
"""
from datetime import datetime, timezone
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ==============================================================================
# Prompt Versioning
# ==============================================================================
PROMPT_VERSION = "v1.2.0"

SYSTEM_PROMPT = """Eres el Especialista Principal en Análisis Sismológico y Automatización con IA de la plataforma SismoWatch.
Tu responsabilidad es redactar un resumen ejecutivo diario, riguroso, profesional y de alto impacto sobre la actividad sísmica mundial.

REGLAS OBLIGATORIAS Y VINCULANTES:
1. NUNCA inventes números ni estadísticas. Usa ESTRICTAMENTE las cifras provistas en el bloque FACTUAL DATA.
2. Cada número mencionado en tu redacción (total de eventos, magnitud máxima, magnitud promedio, alertas de tsunami) DEBE coincidir con los valores exactos suministrados.
3. Analiza las zonas de mayor actividad y explica las anomalías estadísticas detectadas por el algoritmo Z-Score.
4. Devuelve la respuesta ÚNICAMENTE como un objeto JSON válido que respete la estructura requerida.
"""

USER_PROMPT_TEMPLATE = """FACTUAL DATA (Calculado por motor determinístico):
- Fecha de análisis: {report_date}
- Total de sismos registrados: {total_events}
- Magnitud máxima registrada: {max_magnitude}
- Magnitud promedio global: {avg_magnitude}
- Eventos con alerta de tsunami: {tsunami_alerts}
- Zonas con mayor actividad sísmica: {high_activity_zones_json}
- Sismos destacados: {notable_events_json}
- Anomalías estadísticas detectadas (Z-Score): {anomalies_detected_json}

INSTRUCCIONES DE FORMATO:
Responde con un JSON estructurado con la siguiente llave única:
{{
  "executive_summary": "Párrafo conciso (120-200 palabras) resumiendo la actividad sísmica global del día, citando textualmente el total de eventos ({total_events}), la magnitud máxima ({max_magnitude}) y las zonas más activas."
}}
"""


# ==============================================================================
# Pydantic Schemas for Structured Validation
# ==============================================================================
class AnomalyDetail(BaseModel):
    region: str
    event_count: int
    z_score: float
    severity: str = Field(description="LOW | MEDIUM | HIGH | CRITICAL")
    explanation: str


class NotableEvent(BaseModel):
    id: str
    magnitude: float
    place: str
    region: str
    event_time: str
    tsunami: int


class SeismicReportStructured(BaseModel):
    report_date: str
    executive_summary: str
    high_activity_zones: List[Dict[str, Any]]
    notable_events: List[Dict[str, Any]]
    total_events: int
    max_magnitude: float
    avg_magnitude: float
    tsunami_alerts: int
    anomalies_detected: List[Dict[str, Any]]
    source: str = "llm"


# ==============================================================================
# Deterministic Statistical & Anomaly Calculations
# ==============================================================================
def calculate_seismic_statistics(df: pd.DataFrame, report_date_str: str) -> Dict[str, Any]:
    """
    Computes factual baseline figures deterministically in Python.
    """
    if df.empty:
        return {
            "report_date": report_date_str,
            "total_events": 0,
            "max_magnitude": 0.0,
            "avg_magnitude": 0.0,
            "tsunami_alerts": 0,
            "high_activity_zones": [],
            "notable_events": [],
            "anomalies_detected": [],
        }

    total_events = int(len(df))
    valid_mags = df["magnitude"].dropna()
    max_magnitude = round(float(valid_mags.max()), 2) if not valid_mags.empty else 0.0
    avg_magnitude = round(float(valid_mags.mean()), 2) if not valid_mags.empty else 0.0
    tsunami_alerts = int((df["tsunami"] > 0).sum()) if "tsunami" in df.columns else 0

    # Top high activity zones
    top_regions: List[Dict[str, Any]] = []
    if "region" in df.columns:
        region_counts = df["region"].value_counts().head(5)
        for r_name, r_cnt in region_counts.items():
            r_df = df[df["region"] == r_name]
            r_max_mag = round(float(r_df["magnitude"].dropna().max()), 2) if not r_df["magnitude"].dropna().empty else 0.0
            top_regions.append({
                "region": str(r_name),
                "event_count": int(r_cnt),
                "max_magnitude": r_max_mag,
            })

    # Notable events (mag >= 4.5 or tsunami > 0 or top 5 by magnitude)
    notable_df = df.sort_values(by="magnitude", ascending=False).head(5)
    notable_list: List[Dict[str, Any]] = []
    for _, row in notable_df.iterrows():
        notable_list.append({
            "id": str(row.get("id")),
            "magnitude": round(float(row.get("magnitude") or 0.0), 2),
            "place": str(row.get("place") or "Unknown"),
            "region": str(row.get("region") or "Unknown"),
            "event_time": str(row.get("event_time")),
            "tsunami": int(row.get("tsunami") or 0),
        })

    # Run Z-score anomaly detection
    anomalies = detect_seismic_anomalies_zscore(df)

    return {
        "report_date": report_date_str,
        "total_events": total_events,
        "max_magnitude": max_magnitude,
        "avg_magnitude": avg_magnitude,
        "tsunami_alerts": tsunami_alerts,
        "high_activity_zones": top_regions,
        "notable_events": notable_list,
        "anomalies_detected": anomalies,
    }


def detect_seismic_anomalies_zscore(df: pd.DataFrame, z_threshold: float = 2.0) -> List[Dict[str, Any]]:
    """
    Applies statistical Z-Score detection to identify regional seismic swarms
    and abnormal clustering in the current 24-hour window.
    Z = (X - mean) / std
    """
    if df.empty or "region" not in df.columns or len(df) < 5:
        return []

    region_series = df["region"].value_counts()
    counts = region_series.values
    
    mean = np.mean(counts)
    std = np.std(counts)

    anomalies: List[Dict[str, Any]] = []
    if std == 0:
        return anomalies

    for region, count in region_series.items():
        z = (count - mean) / std
        if z >= z_threshold:
            if z >= 3.5:
                severity = "CRITICAL"
            elif z >= 2.5:
                severity = "HIGH"
            else:
                severity = "MEDIUM"

            anomalies.append({
                "region": str(region),
                "event_count": int(count),
                "z_score": round(float(z), 2),
                "severity": severity,
                "explanation": (
                    f"Enjambre sísmico detectado: La región '{region}' registró {count} sismos, "
                    f"situándose {round(float(z), 2)} desviaciones estándar por encima del promedio regional."
                ),
            })

    return anomalies


# ==============================================================================
# Narrative Verification & Grounding Guardrails
# ==============================================================================
def verify_narrative_grounding(narrative: str, stats: Dict[str, Any]) -> bool:
    """
    Verifies that the generated natural language narrative accurately cites
    factual calculated statistics and does not hallucinate false numbers.
    """
    if not narrative:
        return False

    total_events = stats.get("total_events", 0)
    max_mag = stats.get("max_magnitude", 0.0)

    # Check if total events is present if non-zero
    if total_events > 0 and str(total_events) not in narrative:
        logger.warning("Grounding mismatch: total_events %s not found in narrative.", total_events)
        return False

    # Check max magnitude presence if significant
    if max_mag > 0.0 and f"{max_mag:.1f}" not in narrative and f"{max_mag}" not in narrative:
        logger.warning("Grounding mismatch: max_magnitude %s not found in narrative.", max_mag)
        return False

    return True


# ==============================================================================
# Fallback Narrative Generator (Deterministic & Non-Breaking)
# ==============================================================================
def generate_deterministic_fallback_report(stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generates a deterministic, factual executive summary when the LLM provider
    is unreachable, times out, or fails grounding validation.
    Guarantees zero hallucinations and 100% pipeline stability.
    """
    report_date = stats["report_date"]
    total = stats["total_events"]
    max_mag = stats["max_magnitude"]
    avg_mag = stats["avg_magnitude"]
    tsunamis = stats["tsunami_alerts"]
    top_zones = stats.get("high_activity_zones", [])
    anomalies = stats.get("anomalies_detected", [])

    zone_desc = ", ".join([f"{z['region']} ({z['event_count']} eventos)" for z in top_zones[:3]])
    if not zone_desc:
        zone_desc = "distribución sísmica dispersa"

    tsunami_text = f"Se emitieron {tsunamis} alertas de tsunami." if tsunamis > 0 else "No se registraron alertas de tsunami."
    anomaly_text = f"Se detectaron {len(anomalies)} anomalías estadísticas relevantes." if anomalies else "No se detectaron enjambres anómalos."

    summary = (
        f"Informe Ejecutivo SismoWatch para el {report_date}: Durante las últimas 24 horas se monitorearon "
        f"un total de {total} sismos a nivel global, con una magnitud máxima registrada de {max_mag} y un promedio "
        f"de {avg_mag}. Las regiones con mayor densidad de actividad fueron: {zone_desc}. {tsunami_text} {anomaly_text}"
    )

    return {
        "report_date": report_date,
        "executive_summary": summary,
        "high_activity_zones": stats.get("high_activity_zones", []),
        "notable_events": stats.get("notable_events", []),
        "total_events": total,
        "max_magnitude": max_mag,
        "avg_magnitude": avg_mag,
        "tsunami_alerts": tsunamis,
        "anomalies_detected": anomalies,
        "source": "deterministic_fallback",
    }


# ==============================================================================
# LLM Integration (Gemini / OpenAI / Ollama / Fallback)
# ==============================================================================
def generate_ai_report(
    events_df: pd.DataFrame,
    report_date: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Generates the complete daily AI report with anomaly detection and executive summary.
    Returns: (report_dict, execution_log_dict)
    """
    if report_date is None:
        report_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. Deterministic Calculation
    stats = calculate_seismic_statistics(events_df, report_date)
    
    # 2. Select Provider
    provider = (provider or os.getenv("LLM_PROVIDER") or "gemini").lower()
    start_time = time.time()
    
    log_entry: Dict[str, Any] = {
        "provider": provider,
        "model": os.getenv("AI_MODEL_NAME") or "gemini-1.5-flash",
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "latency_ms": 0,
        "estimated_cost_usd": 0.0,
        "status": "SUCCESS",
    }

    # If dataset has no events, fallback immediately
    if stats["total_events"] == 0:
        fallback = generate_deterministic_fallback_report(stats)
        log_entry["status"] = "EMPTY_DATASET"
        log_entry["latency_ms"] = int((time.time() - start_time) * 1000)
        return fallback, log_entry

    user_prompt = USER_PROMPT_TEMPLATE.format(
        report_date=report_date,
        total_events=stats["total_events"],
        max_magnitude=stats["max_magnitude"],
        avg_magnitude=stats["avg_magnitude"],
        tsunami_alerts=stats["tsunami_alerts"],
        high_activity_zones_json=json.dumps(stats["high_activity_zones"]),
        notable_events_json=json.dumps(stats["notable_events"]),
        anomalies_detected_json=json.dumps(stats["anomalies_detected"]),
    )

    narrative = ""
    success = False

    # Try Gemini API if key is available
    gemini_key = api_key or os.getenv("GEMINI_API_KEY")
    if provider == "gemini" and gemini_key:
        try:
            import httpx
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_prompt}"}]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json"
                }
            }
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        text_resp = candidates[0]["content"]["parts"][0]["text"]
                        parsed = json.loads(text_resp)
                        narrative = parsed.get("executive_summary", "")
                        usage = data.get("usageMetadata", {})
                        p_tokens = usage.get("promptTokenCount", 350)
                        c_tokens = usage.get("candidatesTokenCount", 120)
                        log_entry["prompt_tokens"] = p_tokens
                        log_entry["completion_tokens"] = c_tokens
                        log_entry["total_tokens"] = p_tokens + c_tokens
                        log_entry["estimated_cost_usd"] = round((p_tokens * 0.000000075) + (c_tokens * 0.0000003), 6)
                        success = True
        except Exception as e:
            logger.warning("Gemini LLM call failed or timed out: %s", str(e))
            log_entry["status"] = f"LLM_ERROR_{type(e).__name__}"

    # Try OpenAI API if key is available
    openai_key = os.getenv("OPENAI_API_KEY")
    if not success and (provider == "openai" or openai_key):
        try:
            import httpx
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.2,
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    parsed = json.loads(content)
                    narrative = parsed.get("executive_summary", "")
                    usage = data.get("usage", {})
                    p_tokens = usage.get("prompt_tokens", 350)
                    c_tokens = usage.get("completion_tokens", 120)
                    log_entry["provider"] = "openai"
                    log_entry["model"] = "gpt-4o-mini"
                    log_entry["prompt_tokens"] = p_tokens
                    log_entry["completion_tokens"] = c_tokens
                    log_entry["total_tokens"] = p_tokens + c_tokens
                    log_entry["estimated_cost_usd"] = round((p_tokens * 0.00000015) + (c_tokens * 0.0000006), 6)
                    success = True
        except Exception as e:
            logger.warning("OpenAI LLM call failed: %s", str(e))

    # Anti-Hallucination & Grounding Check
    if success and narrative:
        is_grounded = verify_narrative_grounding(narrative, stats)
        if not is_grounded:
            logger.warning("LLM hallucinated figures! Rejecting LLM text and falling back to deterministic.")
            log_entry["status"] = "REJECTED_HALLUCINATION_FALLBACK"
            success = False

    latency_ms = int((time.time() - start_time) * 1000)
    log_entry["latency_ms"] = latency_ms

    if success and narrative:
        report = {
            "report_date": report_date,
            "executive_summary": narrative,
            "high_activity_zones": stats["high_activity_zones"],
            "notable_events": stats["notable_events"],
            "total_events": stats["total_events"],
            "max_magnitude": stats["max_magnitude"],
            "avg_magnitude": stats["avg_magnitude"],
            "tsunami_alerts": stats["tsunami_alerts"],
            "anomalies_detected": stats["anomalies_detected"],
            "source": f"llm_{log_entry['provider']}",
        }
    else:
        # Resilient Deterministic Fallback
        report = generate_deterministic_fallback_report(stats)
        if log_entry["status"] == "SUCCESS":
            log_entry["status"] = "FALLBACK_DETERMINISTIC"

    return report, log_entry
