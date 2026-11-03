from backend.services.optimizer import optimize_journey


def _scenario(route_id, duration, temperature):
    return {
        "route": [route_id],
        "route_id": route_id,
        "travel_time_min": duration,
        "distance_km": duration / 2,
        "segments": [{"temperature": temperature, "duration_minutes": duration}],
    }


def test_optimizer_selects_lowest_exposure_within_constraints():
    scenarios = [
        _scenario("fast-hot", 10, 38),
        _scenario("cooler", 11, 29),
        _scenario("too-slow", 20, 27),
    ]
    result = optimize_journey(
        scenarios=scenarios,
        fastest_time=10,
        max_extra_time_percent=20,
        thermal_exposure_budget=100,
    )
    assert result["found"] is True
    assert result["best_journey"]["route_id"] == "cooler"


def test_optimizer_returns_no_options_when_constraints_fail():
    result = optimize_journey(
        scenarios=[_scenario("hot", 10, 45)],
        fastest_time=10,
        max_extra_time_percent=0,
        thermal_exposure_budget=1,
    )
    assert result["found"] is False
    assert result["options"] == []
