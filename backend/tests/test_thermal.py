import pytest

from backend.services.thermal import (
    calculate_segment_exposure,
    calculate_route_exposure,
    exposure_level,
)


def test_heat_index_has_priority_over_raw_temperature():
    result = calculate_segment_exposure(temperature=30, duration_minutes=10, heat_index=35)
    assert result == 10.0


def test_route_exposure_is_clamped_to_100():
    segments = [{"temperature": 60, "duration_minutes": 100}]
    assert calculate_route_exposure(segments) == 100


def test_route_exposure_sums_segment_contributions():
    segments = [
        {"temperature": 30, "duration_minutes": 10},
        {"temperature": 35, "duration_minutes": 10},
    ]
    assert calculate_route_exposure(segments) == 15.0


def test_exposure_level_thresholds():
    assert exposure_level(29.9) == "LOW"
    assert exposure_level(30) == "MODERATE"
    assert exposure_level(50) == "HIGH"
    assert exposure_level(70) == "EXTREME"
