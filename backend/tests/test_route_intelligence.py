from datetime import datetime, timedelta

from backend.services import route_intelligence as intelligence


def sample_geometry():
    return [(12.9716, 77.5946), (12.9730, 77.5970), (12.9760, 77.6000)]


def test_sample_duration_intervals_sum_to_exact_route_duration():
    samples, distance = intelligence.sample_geometry(sample_geometry())
    durations = intelligence.allocate_sample_durations(samples, 731.25, distance)
    assert len(durations) == len(samples) - 1
    assert abs(sum(durations) - 731.25) < 1e-8


def test_solar_position_returns_valid_angles():
    local_midday = datetime(2026, 11, 2, 12, 0, tzinfo=intelligence.TIMEZONE)
    result = intelligence.solar_position(12.9716, 77.5946, local_midday)
    assert 0 <= result["azimuth_deg"] < 360
    assert -90 <= result["elevation_deg"] <= 90
    assert result["elevation_deg"] > 0


def test_profile_weights_prioritize_air_quality_for_asthma():
    assert intelligence.PROFILE_WEIGHTS["asthma"]["aqi"] > intelligence.PROFILE_WEIGHTS["adult"]["aqi"]


def test_route_analysis_does_not_invent_environment_when_sources_fail(monkeypatch):
    samples_count = 4
    monkeypatch.setattr(intelligence, "fetch_route_forecasts", lambda samples: ([{} for _ in samples], [{} for _ in samples], {"weather": "unavailable", "air_quality": "unavailable"}))
    monkeypatch.setattr(intelligence, "fetch_osm_shade_features", lambda samples: ([], "unavailable"))
    result = intelligence.analyze_route(sample_geometry(), 600, departure_at="2026-11-02T12:00:00+05:30")
    assert result["status"] == "partial"
    assert result["route_exposure_score"] is None
    assert result["departure_recommendation"] is None
    assert all(row["temperature_c"] is None for row in result["samples"])
    assert result["segment_duration_sum_seconds"] == 600


def test_route_analysis_uses_forecast_for_each_route_sample(monkeypatch):
    samples, _ = intelligence.sample_geometry(sample_geometry())
    now = datetime.now(intelligence.TIMEZONE).replace(minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(30)]
    weather = [{"hourly": {
        "time": times,
        "temperature_2m": [30.0] * len(times),
        "apparent_temperature": [34.0] * len(times),
        "uv_index": [6.0] * len(times),
        "precipitation_probability": [10.0] * len(times),
        "precipitation": [0.0] * len(times),
        "wind_speed_10m": [8.0] * len(times),
    }} for _ in samples]
    air = [{"hourly": {"time": times, "us_aqi": [75.0] * len(times), "pm2_5": [20.0] * len(times), "pm10": [30.0] * len(times)}} for _ in samples]
    monkeypatch.setattr(intelligence, "fetch_route_forecasts", lambda items: (weather, air, {"weather": "forecast", "air_quality": "forecast"}))
    monkeypatch.setattr(intelligence, "fetch_osm_shade_features", lambda items: ([], "unavailable"))
    result = intelligence.analyze_route(sample_geometry(), 600, departure_at=now.isoformat(), profile="adult")
    assert result["route_exposure_score"] is not None
    assert result["sample_count"] == len(samples)
    assert result["segment_duration_sum_seconds"] == 600
    assert len(result["departure_candidates"]) == 13
    assert result["departure_recommendation"] is not None


def test_hourly_forecast_interpolates_only_between_valid_adjacent_observations():
    payload = {"hourly": {
        "time": ["2026-11-02T10:00", "2026-11-02T11:00"],
        "temperature_2m": [20.0, 30.0],
        "apparent_temperature": [None, 34.0],
    }}
    target = datetime(2026, 11, 2, 10, 30, tzinfo=intelligence.TIMEZONE)
    values, forecast_time = intelligence._weather_at(payload, target)
    assert values["temperature_c"] == 25.0
    assert values["apparent_temperature_c"] is None
    assert forecast_time and "interpolated" in forecast_time


def test_hourly_forecast_does_not_extrapolate_outside_horizon():
    payload = {"hourly": {
        "time": ["2026-11-02T10:00", "2026-11-02T11:00"],
        "temperature_2m": [20.0, 30.0],
    }}
    target = datetime(2026, 11, 2, 11, 1, tzinfo=intelligence.TIMEZONE)
    values, forecast_time = intelligence._weather_at(payload, target)
    assert values["temperature_c"] is None
    assert forecast_time is None


def test_building_shadow_uses_metric_footprint_geometry():
    point = {"latitude": 12.9716, "longitude": 77.5946}
    building_latitude = point["latitude"] - 0.00005
    features = [{
        "type": "way",
        "id": 1,
        "lat": building_latitude,
        "lon": point["longitude"],
        "tags": {"building": "yes", "height": "20 m"},
        "geometry": [
            {"lat": building_latitude - 0.00002, "lon": point["longitude"] - 0.00002},
            {"lat": building_latitude - 0.00002, "lon": point["longitude"] + 0.00002},
            {"lat": building_latitude + 0.00002, "lon": point["longitude"] + 0.00002},
            {"lat": building_latitude + 0.00002, "lon": point["longitude"] - 0.00002},
        ],
    }]
    result = intelligence.estimate_shade(
        point,
        {"azimuth_deg": 180, "elevation_deg": 45},
        features,
        include_shadow_geometry=True,
    )
    assert result["shade_estimated"] is True
    assert result["buildings_with_height"] == 1
    assert result["evaluated_buildings"] == 1
    assert len(result["building_shadow_polygons"]) == 1
    polygon = result["building_shadow_polygons"][0]
    assert polygon[0] == polygon[-1]
    assert all(-90 <= latitude <= 90 and -180 <= longitude <= 180 for latitude, longitude in polygon)


def test_departure_choice_respects_extra_journey_allowance(monkeypatch):
    now = datetime.now(intelligence.TIMEZONE).replace(minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(30)]
    weather_payload = {"hourly": {
        "time": times,
        "temperature_2m": [30.0] * len(times),
        "apparent_temperature": [34.0] * len(times),
        "uv_index": [6.0] * len(times),
    }}
    air_payload = {"hourly": {"time": times, "us_aqi": [75.0] * len(times)}}
    monkeypatch.setattr(
        intelligence,
        "fetch_route_forecasts",
        lambda items: ([weather_payload for _ in items], [air_payload for _ in items], {"weather": "forecast", "air_quality": "forecast"}),
    )
    monkeypatch.setattr(intelligence, "fetch_osm_shade_features", lambda items: ([], "unavailable"))
    result = intelligence.analyze_route(
        sample_geometry(),
        600,
        route_id="fast",
        route_options=[{
            "route_id": "slow",
            "geometry": sample_geometry(),
            "duration_seconds": 1200,
            "turn_count": 3,
        }],
        max_extra_time_minutes=5,
    )
    assert result["departure_recommendation"] is not None
    assert result["departure_recommendation"]["route_id"] == "fast"
    assert all(
        candidate["route_id"] == "fast"
        for candidate in result["departure_candidates"]
        if candidate["route_id"] is not None
    )
    assert result["route_comparison"]
    assert result["segment_duration_sum_seconds"] == 600
