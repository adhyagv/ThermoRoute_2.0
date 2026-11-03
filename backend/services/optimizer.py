from backend.services.thermal import (
    calculate_route_exposure,
    exposure_level,
    explain_exposure,
    build_why_this_route,
)


def _numeric_mean(values):
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _numeric_max(values):
    if not values:
        return None
    return round(max(values), 2)


def build_heat_intelligence(scenario):
    """
    Summarize FortyGuard (or fallback) sample values separately
    from calculated thermal scores.
    """
    segments = scenario.get("segments") or []

    fortyguard_count = 0
    fallback_count = 0
    temperatures = []
    heat_indexes = []
    apparent_temps = []
    ghi_values = []
    dni_values = []
    dhi_values = []
    activity_ids = []

    for segment in segments:
        source = segment.get("environment_source", "fallback")
        if source == "fortyguard":
            fortyguard_count += 1
        else:
            fallback_count += 1

        if segment.get("temperature") is not None:
            temperatures.append(segment["temperature"])
        if segment.get("heat_index") is not None:
            heat_indexes.append(segment["heat_index"])
        if segment.get("apparent_temperature") is not None:
            apparent_temps.append(segment["apparent_temperature"])
        if segment.get("ghi") is not None:
            ghi_values.append(segment["ghi"])
        if segment.get("dni") is not None:
            dni_values.append(segment["dni"])
        if segment.get("dhi") is not None:
            dhi_values.append(segment["dhi"])
        if segment.get("activity_id"):
            activity_ids.append(segment["activity_id"])

    if fortyguard_count and not fallback_count:
        source_label = "fortyguard"
        source_note = (
            "Environmental values below come from FortyGuard "
            "for sampled points along this route."
        )
    elif fortyguard_count and fallback_count:
        source_label = "mixed"
        source_note = (
            "Some sampled points used FortyGuard; others used "
            "fallback values after a request failed or timed out."
        )
    else:
        source_label = "fallback"
        source_note = (
            "FortyGuard data was unavailable for these samples. "
            "Shown temperatures are fallback values, not live API results."
        )

    api_data = {
        "source": source_label,
        "source_note": source_note,
        "fortyguard_sample_count": fortyguard_count,
        "fallback_sample_count": fallback_count,
    }

    avg_temp = _numeric_mean(temperatures)
    if avg_temp is not None:
        api_data["temperature_c_avg"] = avg_temp
        api_data["temperature_c_max"] = _numeric_max(temperatures)

    avg_hi = _numeric_mean(heat_indexes)
    if avg_hi is not None:
        api_data["heat_index_c_avg"] = avg_hi
        api_data["heat_index_c_max"] = _numeric_max(heat_indexes)

    avg_at = _numeric_mean(apparent_temps)
    if avg_at is not None:
        api_data["apparent_temperature_c_avg"] = avg_at

    avg_ghi = _numeric_mean(ghi_values)
    if avg_ghi is not None:
        api_data["ghi_avg"] = avg_ghi
    avg_dni = _numeric_mean(dni_values)
    if avg_dni is not None:
        api_data["dni_avg"] = avg_dni
    avg_dhi = _numeric_mean(dhi_values)
    if avg_dhi is not None:
        api_data["dhi_avg"] = avg_dhi

    if activity_ids:
        api_data["activity_ids"] = activity_ids

    exposure = scenario.get("thermal_exposure")
    if exposure is None:
        exposure = calculate_route_exposure(segments)

    return {
        "api_data": api_data,
        "calculated": {
            "thermal_exposure": exposure,
            "thermal_level": scenario.get(
                "thermal_level",
                exposure_level(exposure),
            ),
            "thermal_explanation": scenario.get(
                "thermal_explanation",
                explain_exposure(exposure),
            ),
            "note": (
                "Thermal exposure and risk are calculated by "
                "ThermoRoute from sampled temperatures and "
                "travel time. They are not FortyGuard forecasts."
            ),
        },
    }


def _route_summary(scenario, exposure, meets_constraints, recommended):
    summary = {
        "route": scenario.get("route", []),
        "route_id": scenario.get("route_id"),
        "departure_time": scenario.get("departure_time"),
        "travel_time_min": scenario.get("travel_time_min", 0),
        "distance_km": scenario.get("distance_km", 0),
        "thermal_exposure": exposure,
        "thermal_level": exposure_level(exposure),
        "thermal_explanation": explain_exposure(exposure),
        "meets_constraints": meets_constraints,
        "recommended": recommended,
    }

    for extra_key in (
        "geometry",
        "route_source",
        "origin_lat",
        "origin_lon",
        "destination_lat",
        "destination_lon",
    ):
        if extra_key in scenario:
            summary[extra_key] = scenario[extra_key]

    return summary


def optimize_journey(
    scenarios,
    fastest_time,
    max_extra_time_percent,
    thermal_exposure_budget,
):
    """
    Select the best journey based on:

    1. Maximum allowed travel time
    2. Thermal exposure budget
    3. Lowest thermal exposure

    The fastest route is used as the baseline.
    """

    max_allowed_time = fastest_time * (
        1 + max_extra_time_percent / 100
    )

    scored = []
    valid_options = []

    for scenario in scenarios:
        travel_time = scenario.get("travel_time_min", 0)
        exposure = calculate_route_exposure(
            scenario.get("segments", [])
        )

        within_time = travel_time <= max_allowed_time
        within_budget = exposure <= thermal_exposure_budget
        meets_constraints = within_time and within_budget

        summary = _route_summary(
            scenario=scenario,
            exposure=exposure,
            meets_constraints=meets_constraints,
            recommended=False,
        )
        summary["_segments"] = scenario.get("segments", [])
        scored.append(summary)

        if not meets_constraints:
            continue

        option = {
            "route": scenario.get("route", []),
            "departure_time": scenario.get("departure_time"),
            "travel_time_min": travel_time,
            "distance_km": scenario.get("distance_km", 0),
            "thermal_exposure": exposure,
            "thermal_level": exposure_level(exposure),
            "thermal_explanation": explain_exposure(exposure),
        }
        for extra_key in (
            "geometry",
            "route_source",
            "origin_lat",
            "origin_lon",
            "destination_lat",
            "destination_lon",
            "route_id",
        ):
            if extra_key in scenario:
                option[extra_key] = scenario[extra_key]

        option["_segments"] = scenario.get("segments", [])
        valid_options.append(option)

    constraints = {
        "fastest_time_min": fastest_time,
        "max_extra_time_percent": max_extra_time_percent,
        "max_allowed_time_min": round(max_allowed_time, 2),
        "thermal_exposure_budget": thermal_exposure_budget,
    }

    if not valid_options:
        all_routes = []
        for item in scored:
            public = dict(item)
            public.pop("_segments", None)
            all_routes.append(public)

        return {
            "found": False,
            "message": (
                "No journey satisfies both "
                "the travel-time and thermal "
                "exposure constraints."
            ),
            "options": [],
            "all_routes": all_routes,
            "constraints": constraints,
        }

    best = min(
        valid_options,
        key=lambda option: option["thermal_exposure"],
    )

    fastest = min(
        scored,
        key=lambda option: option["travel_time_min"],
    )

    why = build_why_this_route(
        recommended=best,
        fastest=fastest,
        other_routes=scored,
    )

    heat_intelligence = build_heat_intelligence(
        {
            "segments": best.get("_segments", []),
            "thermal_exposure": best["thermal_exposure"],
            "thermal_level": best["thermal_level"],
            "thermal_explanation": best["thermal_explanation"],
        }
    )

    public_options = []
    for option in valid_options:
        public = dict(option)
        public.pop("_segments", None)
        public["recommended"] = option is best
        public_options.append(public)

    all_routes = []
    for item in scored:
        public = dict(item)
        public.pop("_segments", None)
        public["recommended"] = (
            item.get("route_id") is not None
            and item.get("route_id") == best.get("route_id")
        ) or (
            item.get("route") == best.get("route")
            and item.get("travel_time_min") == best.get("travel_time_min")
        )
        all_routes.append(public)

    public_best = dict(best)
    public_best.pop("_segments", None)
    public_best["recommended"] = True
    public_best["meets_constraints"] = True
    public_best["why_this_route"] = why
    public_best["heat_intelligence"] = heat_intelligence

    return {
        "found": True,
        "best_journey": public_best,
        "options": public_options,
        "all_routes": all_routes,
        "constraints": constraints,
    }
