from fastapi.testclient import TestClient

from backend.main import app
from backend.services import civic_store


def test_civic_report_api_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "api_civic.sqlite3")
    client = TestClient(app)
    created = client.post("/api/civic/reports", json={
        "category": "no_shade",
        "note": "Test report",
        "latitude": 12.93,
        "longitude": 77.56,
    })
    assert created.status_code == 201
    assert created.json()["report"]["category"] == "no_shade"
    listed = client.get("/api/civic/reports")
    assert listed.status_code == 200
    assert listed.json()["count"] == 1


def test_civic_report_rejects_invalid_coordinates():
    response = TestClient(app).post("/api/civic/reports", json={
        "category": "too_hot", "note": "", "latitude": 120, "longitude": 77.5
    })
    assert response.status_code == 422


def test_civic_report_status_filter_and_crud_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "crud_civic.sqlite3")
    client = TestClient(app)
    created = client.post("/api/civic/reports", json={
        "category": "poor_air_quality",
        "note": "Smoke near the road",
        "latitude": 12.93,
        "longitude": 77.56,
        "anonymous": True,
    })
    report_id = created.json()["report"]["id"]
    assert created.json()["report"]["status"] == "unverified"
    updated = client.patch(f"/api/civic/reports/{report_id}", json={"status": "reviewed"})
    assert updated.status_code == 200
    filtered = client.get("/api/civic/reports?category=poor_air_quality&status=reviewed")
    assert filtered.json()["count"] == 1
    assert filtered.json()["reports"][0]["anonymous"] is True
    assert client.get("/api/civic/hotspots?days=30").status_code == 200
    assert client.delete(f"/api/civic/reports/{report_id}").status_code == 204
