def clamp(value, minimum=0, maximum=100):
    return max(minimum, min(maximum, value))


def calculate_segment_exposure(
    temperature,
    duration_minutes,
    heat_index=None,
    apparent_temperature=None,
    wet_bulb_temperature=None,
):
    """
    Calculate thermal exposure for one journey segment.

    Priority:
    1. Heat Index
    2. Apparent Temperature
    3. Wet Bulb Temperature
    4. Raw Temperature

    This is an explainable exposure score,
    not a medical risk prediction.
    """

    effective_temperature = temperature

    if heat_index is not None:
        effective_temperature = heat_index

    elif apparent_temperature is not None:
        effective_temperature = apparent_temperature

    elif wet_bulb_temperature is not None:
        effective_temperature = wet_bulb_temperature

    baseline = 25

    thermal_intensity = max(
        0,
        effective_temperature - baseline
    )

    exposure = (
        thermal_intensity
        * duration_minutes
        / 10
    )

    return round(exposure, 2)


def calculate_route_exposure(segments):
    """
    Calculate total thermal exposure for a journey.
    Final score is normalized between 0 and 100.
    """

    total_exposure = 0

    for segment in segments:

        total_exposure += calculate_segment_exposure(
            temperature=segment.get(
                "temperature",
                0
            ),
            duration_minutes=segment.get(
                "duration_minutes",
                0
            ),
            heat_index=segment.get(
                "heat_index"
            ),
            apparent_temperature=segment.get(
                "apparent_temperature"
            ),
            wet_bulb_temperature=segment.get(
                "wet_bulb_temperature"
            ),
        )

    return round(
        clamp(total_exposure),
        2
    )


def exposure_level(score):

    score = clamp(score)

    if score < 30:
        return "LOW"

    if score < 50:
        return "MODERATE"

    if score < 70:
        return "HIGH"

    return "EXTREME"


def explain_exposure(score):

    level = exposure_level(score)

    explanations = {

        "LOW":
            "Low estimated thermal exposure.",

        "MODERATE":
            "Moderate estimated thermal exposure. "
            "Consider reducing prolonged outdoor exposure.",

        "HIGH":
            "High estimated thermal exposure. "
            "Consider taking a cooling break or "
            "choosing a lower-exposure journey.",

        "EXTREME":
            "Extreme estimated thermal exposure. "
            "Consider avoiding prolonged outdoor exposure "
            "and finding a cooler location.",
    }

    return explanations[level]


def _format_number(value):
    rounded = round(value, 1)
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def build_why_this_route(
    recommended,
    fastest,
    other_routes=None,
):
    """
    Build an explanation from real route metrics. Never uses
    hardcoded extra minutes or exposure deltas.
    """
    rec_time = recommended.get("travel_time_min", 0)
    rec_exposure = recommended.get("thermal_exposure", 0)
    fast_time = fastest.get("travel_time_min", rec_time)
    fast_exposure = fastest.get("thermal_exposure", rec_exposure)

    extra_minutes = rec_time - fast_time
    exposure_reduction = fast_exposure - rec_exposure

    if extra_minutes > 0.05 and exposure_reduction > 0.05:
        return (
            f"This route adds {_format_number(extra_minutes)} minutes "
            f"but reduces thermal exposure by "
            f"{_format_number(exposure_reduction)} points "
            "while remaining within your time constraint."
        )

    if extra_minutes <= 0.05:
        hottest = None
        for route in other_routes or []:
            if route is recommended:
                continue
            if hottest is None or route.get(
                "thermal_exposure", 0
            ) > hottest.get("thermal_exposure", 0):
                hottest = route

        if hottest is not None:
            cooler_by = hottest.get("thermal_exposure", 0) - rec_exposure
            if cooler_by > 0.05:
                return (
                    "This is the fastest route among those returned "
                    "and still meets your time constraint. "
                    "It also reduces thermal exposure by "
                    f"{_format_number(cooler_by)} points compared "
                    "with the highest-exposure alternative."
                )

        return (
            "This is the fastest route among those returned "
            "and still meets your time constraint."
        )

    return (
        "This route remains within your time constraint "
        f"with a thermal exposure of {_format_number(rec_exposure)}."
    )