from statistics import mean

from ..models.climate_models import ClimateReading
from ..models.route_models import RouteSegment
from ..utils.validation import (
    validate_climate_reading,
    validate_route_segment,
)
from .anomaly import analyze_segment_anomaly
from .climate import (
    calculate_heat_risk_level,
    calculate_segment_exposure,
)


def build_segment_climate_features(
    segment: RouteSegment,
    reading: ClimateReading,
    baseline_c: float = 30.0,
    anomaly_threshold_c: float = 3.0,
    extreme_threshold_c: float = 40.0,
    historical_temperatures_c: list[float] | None = None,
    zscore_threshold: float = 2.0,
) -> dict:
    """
    Build climate intelligence features for one route segment.

    This function combines:
        - temperature
        - heat-risk level
        - thermal exposure
        - temperature anomaly
        - historical z-score anomaly
        - extreme-condition classification

    Note: "heat_risk_level" (from climate.py) and "condition" (from
    anomaly.py) are deliberately separate classification scales with
    different thresholds — heat_risk_level is ThermoRoute's routing
    signal, condition is the raw extreme-heat classifier. The same
    temperature can legitimately land in different-sounding buckets
    on each scale (e.g. 32C = "moderate" risk but "normal" condition).

    The result is intended to be consumed by the optimizer.
    """

    validate_route_segment(segment)
    validate_climate_reading(reading)

    exposure_score = calculate_segment_exposure(
        segment=segment,
        reading=reading,
        baseline_c=baseline_c,
    )

    anomaly = analyze_segment_anomaly(
        segment=segment,
        reading=reading,
        baseline_c=baseline_c,
        anomaly_threshold_c=anomaly_threshold_c,
        extreme_threshold_c=extreme_threshold_c,
        historical_temperatures_c=historical_temperatures_c,
        zscore_threshold=zscore_threshold,
    )

    return {
        "segment_id": segment.segment_id,
        "latitude": reading.latitude,
        "longitude": reading.longitude,
        "timestamp": reading.timestamp.isoformat(),

        "temperature_c": reading.temperature_c,

        "heat_risk_level": calculate_heat_risk_level(
            reading.temperature_c
        ),

        "thermal_exposure_score": exposure_score,

        "temperature_anomaly_c": anomaly["anomaly_c"],
        "baseline_anomaly_detected": (
            anomaly["baseline_anomaly_detected"]
        ),

        "historical_mean_c": anomaly["historical_mean_c"],
        "historical_std_c": anomaly["historical_std_c"],
        "zscore": anomaly["zscore"],
        "zscore_anomaly_detected": (
            anomaly["zscore_anomaly_detected"]
        ),

        "overall_anomaly_detected": (
            anomaly["overall_anomaly_detected"]
        ),

        "condition": anomaly["condition"],

        "distance_m": segment.distance_m,
        "estimated_time_s": segment.estimated_time_s,

        "source": reading.source,
    }


def build_route_climate_features(
    segments: list[RouteSegment],
    readings: list[ClimateReading],
    baseline_c: float = 30.0,
    anomaly_threshold_c: float = 3.0,
    extreme_threshold_c: float = 40.0,
    historical_temperatures_by_segment: dict[
        str, list[float]
    ] | None = None,
    zscore_threshold: float = 2.0,
) -> dict:
    """
    Build climate intelligence features for an entire route.

    Each route segment is matched with its corresponding climate
    reading by list position.
    """

    if not segments:
        raise ValueError(
            "At least one route segment is required."
        )

    if len(segments) != len(readings):
        raise ValueError(
            "Number of climate readings must match "
            "number of route segments."
        )

    segment_features = []

    for segment, reading in zip(segments, readings):
        historical_temperatures = None

        if historical_temperatures_by_segment is not None:
            historical_temperatures = (
                historical_temperatures_by_segment.get(
                    segment.segment_id
                )
            )

        features = build_segment_climate_features(
            segment=segment,
            reading=reading,
            baseline_c=baseline_c,
            anomaly_threshold_c=anomaly_threshold_c,
            extreme_threshold_c=extreme_threshold_c,
            historical_temperatures_c=historical_temperatures,
            zscore_threshold=zscore_threshold,
        )

        segment_features.append(features)

    temperatures = [
        feature["temperature_c"]
        for feature in segment_features
    ]

    exposure_scores = [
        feature["thermal_exposure_score"]
        for feature in segment_features
    ]

    risk_levels = [
        feature["heat_risk_level"]
        for feature in segment_features
    ]

    anomaly_count = sum(
        feature["overall_anomaly_detected"]
        for feature in segment_features
    )

    extreme_count = sum(
        feature["condition"] == "extreme"
        for feature in segment_features
    )

    return {
        "segment_count": len(segment_features),

        "average_temperature_c": mean(
            temperatures
        ),

        "maximum_temperature_c": max(
            temperatures
        ),

        "minimum_temperature_c": min(
            temperatures
        ),

        "total_thermal_exposure": sum(
            exposure_scores
        ),

        "maximum_segment_exposure": max(
            exposure_scores
        ),

        "anomaly_segment_count": anomaly_count,

        "extreme_segment_count": extreme_count,

        "route_anomaly_detected": (
            anomaly_count > 0
        ),

        "extreme_condition_detected": (
            extreme_count > 0
        ),

        "maximum_heat_risk_level": (
            _get_highest_risk_level(risk_levels)
        ),

        "segments": segment_features,
    }


def _get_highest_risk_level(
    risk_levels: list[str],
) -> str:
    """
    Return the highest heat-risk level in a route.
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
