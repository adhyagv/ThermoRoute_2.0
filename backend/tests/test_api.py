from fastapi.testclient import TestClient

from backend.main import app
from backend.services.integration_status import reset_status_for_tests
from backend.version import APP_VERSION


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
