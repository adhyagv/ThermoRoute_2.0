import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import civic_store
from backend.services.integration_status import reset_status_for_tests
from backend.version import APP_VERSION


@pytest.fixture(autouse=True)
def isolate_local_database(tmp_path, monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "api_test.sqlite3")


def test_health_does_not_claim_fortyguard_is_always_healthy():
    reset_status_for_tests()
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["version"] == APP_VERSION
    fortyguard = payload["integrations"]["fortyguard"]
    assert fortyguard["configured"] in (True, False)
    assert fortyguard["reachable"] is None
    assert fortyguard["reachability_status"] in {"not_checked", "not_configured"}
    assert "note" in payload


def test_home_uses_canonical_version():
    response = TestClient(app).get("/")
    assert response.status_code == 200
    assert response.json()["version"] == APP_VERSION


def test_health_does_not_expose_external_provider_error_details():
    from backend.services.integration_status import record_request_result

    record_request_result(False, "provider response contained a private token")
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json()["integrations"]["fortyguard"]["last_error"] == "External provider request failed."
    reset_status_for_tests()


def test_optimize_rejects_invalid_input_before_route_lookup():
    response = TestClient(app).post("/api/optimize", json={
        "from_location": "",
        "destination": "Lalbagh",
        "departure_time": "12:00",
        "max_extra_time_percent": -1,
        "thermal_exposure_budget": 50,
    })
    assert response.status_code == 422


def test_production_requires_persistent_postgres_for_health_and_civic_routes(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = TestClient(app)
    assert client.get("/api/health").status_code == 503
    assert client.get("/api/civic/reports").status_code == 503


def test_cors_preflight_allows_local_frontend_and_moderator_header():
    response = TestClient(app).options(
        "/api/civic/reports/1",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_optimize_no_routes_returns_an_error_not_an_empty_success(monkeypatch):
    monkeypatch.setattr("backend.main.build_route_scenarios", lambda **_kwargs: [])
    response = TestClient(app).post("/api/optimize", json={
        "from_location": "Origin",
        "destination": "Destination",
        "departure_time": "12:00",
    })
    assert response.status_code == 502
    assert response.json()["detail"] == "No routes are currently available."


def test_civic_database_errors_are_not_returned_to_clients(monkeypatch):
    monkeypatch.setattr(
        "backend.main.list_reports",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database password was exposed")),
    )
    response = TestClient(app).get("/api/civic/reports")
    assert response.status_code == 500
    assert "database password" not in response.text
    assert response.json()["detail"] == "Could not read civic reports."
