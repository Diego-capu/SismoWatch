"""
Integration and Unit Tests for FastAPI Endpoints & RBAC Security
Validates authentication, token issuance, route protection, and role access matrix.
"""
from datetime import datetime, timezone
import os
import sys
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

# Set testing environment variables
os.environ["SECRET_KEY"] = "test_super_secret_key_for_unit_tests_32_bytes_min!"
os.environ["ALGORITHM"] = "HS256"

API_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../api"))
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from main import app
from auth import create_access_token, get_password_hash


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_token():
    return create_access_token({"sub": "admin", "role": "admin"})


@pytest.fixture
def viewer_token():
    return create_access_token({"sub": "viewer", "role": "viewer"})


def test_public_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "UP"


def test_unauthenticated_request_returns_401(client):
    response = client.get("/api/kpis")
    assert response.status_code == 401


def test_login_invalid_credentials(client):
    with patch("main.get_user_by_username", return_value=None):
        response = client.post("/auth/login", json={"username": "fake", "password": "wrong"})
        assert response.status_code == 401


def test_login_success(client):
    fake_user = {
        "id": 1,
        "username": "admin",
        "hashed_password": get_password_hash("admin123"),
        "role": "admin",
    }
    with patch("main.get_user_by_username", return_value=fake_user):
        response = client.post("/auth/login", json={"username": "admin", "password": "admin123"})
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["role"] == "admin"


def test_viewer_access_to_admin_endpoints_is_forbidden_403(client, viewer_token):
    headers = {"Authorization": f"Bearer {viewer_token}"}
    fake_viewer = {"id": 2, "username": "viewer", "role": "viewer"}

    with patch("auth.get_user_by_username", return_value=fake_viewer):
        # 1. Backfill endpoint
        res1 = client.post("/api/admin/backfill", headers=headers, json={"days": 7})
        assert res1.status_code == 403
        assert "requiere permisos de Administrador" in res1.json()["detail"]

        # 2. Report regenerate endpoints
        res2 = client.post("/api/admin/reports/regenerate", headers=headers, json={"force": True})
        assert res2.status_code == 403

        res2_pipe = client.post("/api/pipeline/regenerate-report", headers=headers, json={"force": True})
        assert res2_pipe.status_code == 403

        # 3. Quality quarantine audit endpoint
        res3 = client.get("/api/quality/quarantine", headers=headers)
        assert res3.status_code == 403


def test_admin_access_to_quarantine_audit(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    fake_admin = {"id": 1, "username": "admin", "role": "admin"}

    mock_db_rows = [
        {
            "id": 1,
            "dag_run_id": "test_run",
            "execution_time": datetime.now(timezone.utc),
            "total_evaluated": 50,
            "total_valid": 48,
            "total_discarded": 2,
            "quality_score": 96.0,
            "discard_reasons": {"latitude_out_of_range": 2},
        }
    ]

    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = mock_db_rows
    mock_cursor.__enter__.return_value = mock_cursor

    from contextlib import contextmanager
    @contextmanager
    def mock_cursor_cm(commit=False):
        yield mock_cursor

    with patch("auth.get_user_by_username", return_value=fake_admin), \
         patch("routes.quality.get_db_cursor", side_effect=mock_cursor_cm):
        response = client.get("/api/quality/quarantine", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "architecture_notice" in data
        assert "DECISIÓN ARQUITECTURAL DE NEGOCIO" in data["architecture_notice"]
        assert data["total_records_evaluated"] == 50
        assert data["total_records_discarded"] == 2
        assert data["global_quality_score"] == 96.0


def test_chat_endpoint_grounded_response(client, viewer_token):
    fake_viewer = {"id": 2, "username": "viewer", "role": "viewer"}
    headers = {"Authorization": f"Bearer {viewer_token}"}

    with patch("auth.get_user_by_username", return_value=fake_viewer), \
         patch("routes.chat.get_live_seismic_context", return_value={
             "total_events": 150,
             "max_magnitude": 6.8,
             "avg_magnitude": 3.2,
             "tsunami_alerts": 0,
             "top_events": [{"place": "Off coast of Chile", "magnitude": 6.8, "region": "Chile", "depth_km": 20, "time": "2026-10-27", "tsunami": False}],
             "high_activity_regions": [{"region": "Chile", "count": 25, "max_magnitude": 6.8}],
             "latest_ai_summary": "Actividad moderada en el Pacífico.",
             "anomalies": []
         }):
        response = client.post("/api/chat", json={"message": "¿Cuál fue el sismo más fuerte?"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "reply" in data
        assert "6.8" in data["reply"]
        assert "source" in data


def test_admin_regenerate_report_endpoint(client, admin_token):
    fake_admin = {"id": 1, "username": "admin", "role": "admin"}
    headers = {"Authorization": f"Bearer {admin_token}"}

    mock_report = {
        "id": 10,
        "report_date": "2026-10-27",
        "total_events": 50,
        "max_magnitude": 5.4,
        "avg_magnitude": 2.39,
        "tsunami_alerts": 0,
        "source": "gemini (gemini-3.5-flash-lite)",
        "latency_ms": 1200,
        "executive_summary": "Resumen factual generado.",
        "anomalies_count": 2,
    }

    with patch("auth.get_user_by_username", return_value=fake_admin), \
         patch("routes.reports.generate_and_persist_ai_report_direct_async", return_value=mock_report):
        # Test pipeline alias
        resp = client.post("/api/pipeline/regenerate-report", json={"force": True}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "SUCCESS"
        assert data["report"]["total_events"] == 50
        assert data["report"]["max_magnitude"] == 5.4

        # Test admin alias
        resp_admin = client.post("/api/admin/reports/regenerate", json={"force": True}, headers=headers)
        assert resp_admin.status_code == 200
        data_admin = resp_admin.json()
        assert data_admin["status"] == "SUCCESS"


