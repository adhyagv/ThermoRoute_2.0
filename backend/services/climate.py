from statistics import mean

from ..models.climate_models import ClimateReading
from ..models.route_models import RouteSegment
from ..utils.validation import (
    validate_climate_reading,
    validate_route_segment,
)


def calculate_heat_risk_level(
    temperature_c: float,
) -> str:
    """
    Classify temperature into a simple ThermoRoute heat-risk level.

    These thresholds are initial application thresholds and can be
    refined later using FortyGuard data and the team's final
    heat-risk methodology.
    """
    if temperature_c < 30.0:
        return "low"
    if temperature_c < 35.0:
        return "moderate"
    if temperature_c < 40.0:
        return "high"
    return "extreme"


def calculate_temperature_excess(
    temperature_c: float,
    baseline_c: float = 30.0,
) -> float:
    """
    Calculate how far the temperature is above a baseline.

    Returns:
        Temperature excess in degrees Celsius.
        Values below the baseline return 0.
    """
    return max(0.0, temperature_c - baseline_c)


def calculate_segment_exposure(
    segment: RouteSegment,
    reading: ClimateReading,
    baseline_c: float = 30.0,
) -> float:
    """
    Calculate a simple thermal-exposure score for a route segment.

    Exposure is based on temperature above the baseline multiplied
    by the segment travel duration in minutes.

    This is an internal relative exposure metric, not a medical
    heat-exposure measurement.
    """
    validate_route_segment(segment)
    validate_climate_reading(reading)

    temperature_excess = calculate_temperature_excess(
        temperature_c=reading.temperature_c,
        baseline_c=baseline_c,
    )

    duration_minutes = segment.estimated_time_s / 60.0

    return temperature_excess * duration_minutes


def enrich_segment_with_climate(
    segment: RouteSegment,
    reading: ClimateReading,
) -> dict:
    """
    Combine route-segment information with its climate reading.

    Returns:
        A dictionary containing the segment's climate intelligence.
        Timestamp is serialized to ISO 8601 string so this dict is
        safely JSON-serializable (e.g. for API responses or caching).
    """
    validate_route_segment(segment)
    validate_climate_reading(reading)

    exposure = calculate_segment_exposure(
        segment=segment,
        reading=reading,
    )

    return {
        "segment_id": segment.segment_id,
        "temperature_c": reading.temperature_c,
        "risk_level": calculate_heat_risk_level(reading.temperature_c),
        "exposure_score": exposure,
        "distance_m": segment.distance_m,
        "estimated_time_s": segment.estimated_time_s,
        "latitude": reading.latitude,
        "longitude": reading.longitude,
        "timestamp": reading.timestamp.isoformat(),
        "source": reading.source,
    }


def calculate_route_exposure(
    segments: list[RouteSegment],
    readings: list[ClimateReading],
    baseline_c: float = 30.0,
) -> float:
    """
    Calculate cumulative thermal exposure across a route.

    Each segment is matched with the climate reading at the same
    list position.
    """
    if not segments:
        raise ValueError("At least one route segment is required.")

    if len(segments) != len(readings):
        raise ValueError(
            "Number of climate readings must match "
            "number of route segments."
        )

    total_exposure = 0.0

    for segment, reading in zip(segments, readings):
        validate_route_segment(segment)
        validate_climate_reading(reading)

        total_exposure += calculate_segment_exposure(
            segment=segment,
            reading=reading,
            baseline_c=baseline_c,
        )

    return total_exposure


def calculate_route_climate_summary(
    segments: list[RouteSegment],
    readings: list[ClimateReading],
    baseline_c: float = 30.0,
) -> dict:
    """
    Generate a climate summary for a complete route.
    """
    if not segments:
        raise ValueError("At least one route segment is required.")

    if len(segments) != len(readings):
        raise ValueError(
            "Number of climate readings must match "
            "number of route segments."
        )

    for segment in segments:
        validate_route_segment(segment)

    for reading in readings:
        validate_climate_reading(reading)

    temperatures = [reading.temperature_c for reading in readings]

    total_exposure = calculate_route_exposure(
        segments=segments,
        readings=readings,
        baseline_c=baseline_c,
    )

    risk_levels = [
        calculate_heat_risk_level(temperature)
        for temperature in temperatures
    ]

    return {
        "total_exposure_score": total_exposure,
        "average_temperature_c": mean(temperatures),
        "maximum_temperature_c": max(temperatures),
        "minimum_temperature_c": min(temperatures),
        "maximum_risk_level": _get_highest_risk_level(risk_levels),
        "segment_count": len(segments),
    }


def _get_highest_risk_level(
    risk_levels: list[str],
) -> str:
    """
    Return the highest heat-risk level from a collection.
    """
    if not risk_levels:
        return "unknown"

    priority = {
        "low": 1,
        "moderate": 2,
        "high": 3,
        "extreme": 4,
    }

    return max(
        risk_levels,
        key=lambda level: priority.get(level, 0),
    )