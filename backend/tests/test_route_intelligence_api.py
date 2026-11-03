from fastapi.testclient import TestClient

from backend.main import app


def test_route_intelligence_endpoint_passes_route_and_profile(monkeypatch):
    captured = {}

    def fake_analyze_route(**kwargs):
        captured.update(kwargs)
        return {"status": "success", "route_exposure_score": 41.2, "sample_count": 2}

    monkeypatch.setattr("backend.main.analyze_route", fake_analyze_route)
    response = TestClient(app).post("/api/route-intelligence/analyze", json={
        "route_geometry": [
            {"latitude": 12.9716, "longitude": 77.5946},
            {"latitude": 12.9726, "longitude": 77.5956},
        ],
        "duration_seconds": 600,
        "mode": "walking",
        "profile": "pedestrian",
        "departure_at": "2026-11-02T09:00:00+05:30",
    })
    assert response.status_code == 200
    assert response.json()["route_exposure_score"] == 41.2
    assert captured["mode"] == "walking"
    assert captured["profile"] == "pedestrian"
    assert len(captured["geometry"]) == 2


def test_route_intelligence_rejects_invalid_geometry():
    response = TestClient(app).post("/api/route-intelligence/analyze", json={
        "route_geometry": [{"latitude": 12.9716, "longitude": 77.5946}],
        "duration_seconds": 600,
    })
    assert response.status_code == 422
