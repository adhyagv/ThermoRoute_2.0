import pytest

from backend.services.routing import (
    allocate_duration_minutes,
    osrm_routes_to_thermoroute,
)


def _route(duration_seconds=601, coordinates=None):
    return {
        "route_id": "test-route",
        "duration_s": duration_seconds,
        "distance_m": 2500,
        "geometry": {"coordinates": coordinates or [
            [77.5600, 12.9300], [77.5610, 12.9310],
            [77.5620, 12.9320], [77.5630, 12.9330],
            [77.5640, 12.9340],
        ]},
    }


def test_duration_buckets_sum_to_route_duration():
    routes = osrm_routes_to_thermoroute(
        "Origin", "Destination",
        {"latitude": 12.93, "longitude": 77.56},
        {"latitude": 12.934, "longitude": 77.564},
        "10:00", [_route()],
    )
    assert len(routes) == 1
    route = routes[0]
    assert len(route["segments"]) == 4
    assert sum(segment["duration_minutes"] for segment in route["segments"]) == pytest.approx(route["travel_time_min"], abs=1e-9)


@pytest.mark.parametrize("total,count", [(10.0, 4), (10.1, 3), (0.1, 4), (22.37, 7), (0.0, 4)])
def test_duration_allocator_preserves_total(total, count):
    shares = allocate_duration_minutes(total, count)
    assert len(shares) == count
    assert sum(shares) == pytest.approx(round(total, 2), abs=1e-9)


def test_duration_allocator_empty_for_zero_segments():
    assert allocate_duration_minutes(10, 0) == []
