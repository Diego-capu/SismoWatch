"""
SismoWatch - Data Transformations Module
Handles GeoJSON parsing, coordinate validation, text sanitization,
and feature engineering for seismic events.
"""
from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional
import pandas as pd


def sanitize_text(text: Optional[str]) -> str:
    """
    Sanitize text fields (such as 'place') to prevent prompt injection and XSS
    before sending data to LLM models or web clients.
    Removes prompt delimiters, HTML tags, and non-printable control characters.
    """
    if not text:
        return "Unknown Region"
    
    # Strip potential prompt injection patterns
    cleaned = re.sub(
        r"(?i)(system:|assistant:|human:|instruction:|ignore\s+previous\s+instructions)",
        "",
        str(text)
    )
    # Strip dangerous XML/HTML tags
    cleaned = re.sub(r"<[^>]*>", "", cleaned)
    # Strip backticks, curly braces, and unusual control characters
    cleaned = re.sub(r"[`{}\x00-\x1f\x7f-\x9f]", "", cleaned)
    # Normalize multiple spaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned if cleaned else "Unknown Region"


def extract_region_from_place(place: Optional[str]) -> str:
    """
    Extracts the general geographic region or country from USGS place description.
    Example: "14 km SSW of Guánica, Puerto Rico" -> "Puerto Rico"
             "Off the coast of Oregon" -> "Oregon"
    """
    cleaned = sanitize_text(place)
    if not cleaned or cleaned == "Unknown Region":
        return "Unknown"
    
    # If place contains comma, the region/country is usually after the last comma
    if "," in cleaned:
        return cleaned.split(",")[-1].strip()
    
    # If place has "of ", take the part after "of "
    if " of " in cleaned.lower():
        parts = re.split(r"\bof\b", cleaned, flags=re.IGNORECASE)
        return parts[-1].strip()
        
    return cleaned


def epoch_to_iso_datetime(epoch_ms: Optional[int]) -> Optional[datetime]:
    """
    Converts millisecond epoch timestamp to timezone-aware UTC datetime.
    """
    if epoch_ms is None:
        return None
    try:
        return datetime.fromtimestamp(epoch_ms / 1000.0, tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None


def parse_geojson_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flattens and normalizes a single GeoJSON Feature dictionary from USGS.
    """
    feature_id = str(feature.get("id", "")).strip()
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    
    # USGS GeoJSON coordinate standard: [longitude, latitude, depth_km]
    longitude = float(coordinates[0]) if len(coordinates) > 0 and coordinates[0] is not None else None
    latitude = float(coordinates[1]) if len(coordinates) > 1 and coordinates[1] is not None else None
    depth_km = float(coordinates[2]) if len(coordinates) > 2 and coordinates[2] is not None else None
    
    time_ms = properties.get("time")
    updated_ms = properties.get("updated")
    
    raw_place = properties.get("place")
    sanitized_place = sanitize_text(raw_place)
    region = extract_region_from_place(raw_place)
    
    # Magnitude extraction and casting
    raw_mag = properties.get("mag")
    magnitude = float(raw_mag) if raw_mag is not None else None
    
    return {
        "id": feature_id,
        "magnitude": magnitude,
        "mag_type": str(properties.get("magType") or "unknown").strip().lower(),
        "place": sanitized_place,
        "event_time": epoch_to_iso_datetime(time_ms),
        "updated_time": epoch_to_iso_datetime(updated_ms),
        "longitude": longitude,
        "latitude": latitude,
        "depth_km": depth_km,
        "tsunami": int(properties.get("tsunami") or 0),
        "sig": int(properties.get("sig") or 0),
        "status": str(properties.get("status") or "automatic").strip().lower(),
        "event_type": str(properties.get("type") or "earthquake").strip().lower(),
        "url": str(properties.get("url") or "").strip(),
        "region": region,
    }


def transform_usgs_features(features: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Transforms a list of raw GeoJSON feature dicts into a structured Pandas DataFrame.
    """
    parsed_rows = [parse_geojson_feature(f) for f in features if isinstance(f, dict)]
    if not parsed_rows:
        return pd.DataFrame(columns=[
            "id", "magnitude", "mag_type", "place", "event_time", "updated_time",
            "longitude", "latitude", "depth_km", "tsunami", "sig", "status",
            "event_type", "url", "region"
        ])
    return pd.DataFrame(parsed_rows)
