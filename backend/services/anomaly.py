from statistics import mean, pstdev

from ..models.climate_models import ClimateReading
from ..models.route_models import RouteSegment
from ..utils.validation import (
    validate_climate_reading,
    validate_route_segment,
)


def calculate_temperature_anomaly(
    temperature_c: float,
    baseline_c: float,
) -> float:
    """
    Calculate the temperature anomaly relative to a baseline.

    Positive values mean the observed temperature is above
    the baseline. Negative values mean it is below the baseline.
    """

    return temperature_c - baseline_c


def calculate_zscore(
    temperature_c: float,
    historical_temperatures_c: list[float],
) -> float | None:
    """
    Calculate the z-score of the current temperature relative to
    a historical temperature distribution.

    Returns:
        Z-score when enough historical variation exists.
        None when there is insufficient data or zero variance.
    """

    if len(historical_temperatures_c) < 2:
        return None

    historical_mean = mean(historical_temperatures_c)
    historical_std = pstdev(historical_temperatures_c)

    if historical_std == 0:
        return None

    return (
        temperature_c - historical_mean
    ) / historical_std


def is_heat_anomaly(
    temperature_c: float,
    baseline_c: float,
    anomaly_threshold_c: float = 3.0,
) -> bool:
    """
    Detect a heat anomaly using a fixed baseline threshold.

    This is a simple application-level signal and is not intended
    to represent an official FortyGuard heat threshold.
    """

    if anomaly_threshold_c < 0:
        raise ValueError(
            "Anomaly threshold cannot be negative."
        )

    anomaly = calculate_temperature_anomaly(
        temperature_c=temperature_c,
        baseline_c=baseline_c,
    )

    return anomaly >= anomaly_threshold_c


def is_zscore_anomaly(
    zscore: float | None,
    zscore_threshold: float = 2.0,
) -> bool | None:
    """
    Determine whether a z-score represents a statistical heat anomaly.

    Returns:
        True/False when a valid z-score exists.
        None when there is insufficient historical signal.
    """

    if zscore_threshold < 0:
        raise ValueError(
            "Z-score threshold cannot be negative."
        )

    if zscore is None:
        return None

    return zscore >= zscore_threshold


def classify_extreme_condition(
    temperature_c: float,
    extreme_threshold_c: float = 40.0,
) -> str:
    """
    Classify the absolute temperature condition.

    Returns:
        "normal", "elevated", or "extreme".

    These are temporary application thresholds and should be
    refined once the final ThermoRoute methodology is established.
    """

    if extreme_threshold_c < 0:
        raise ValueError(
            "Extreme threshold cannot be negative."
        )

    elevated_threshold_c = extreme_threshold_c - 5.0

    if temperature_c >= extreme_threshold_c:
        return "extreme"

    if temperature_c >= elevated_threshold_c:
        return "elevated"

    return "normal"


def analyze_climate_anomaly(
    reading: ClimateReading,
    baseline_c: float,
    anomaly_threshold_c: float = 3.0,
    extreme_threshold_c: float = 40.0,
    historical_temperatures_c: list[float] | None = None,
    zscore_threshold: float = 2.0,
) -> dict:
    """
    Analyze one environmental reading using multiple anomaly signals.

    Signals:
        1. Fixed-baseline anomaly.
        2. Historical z-score anomaly when historical data exists.
        3. Absolute extreme-temperature classification.
    """

    validate_climate_reading(reading)

    if historical_temperatures_c is not None:
        if not historical_temperatures_c:
            raise ValueError(
                "Historical temperature list cannot be empty."
            )

        for temperature in historical_temperatures_c:
            if temperature < -273.15:
                raise ValueError(
                    "Historical temperature cannot be below "
                    "absolute zero."
                )

    anomaly_c = calculate_temperature_anomaly(
        temperature_c=reading.temperature_c,
        baseline_c=baseline_c,
    )

    baseline_anomaly_detected = is_heat_anomaly(
        temperature_c=reading.temperature_c,
        baseline_c=baseline_c,
        anomaly_threshold_c=anomaly_threshold_c,
    )

    zscore = None
    zscore_anomaly_detected = None
    historical_mean_c = None
    historical_std_c = None

    if historical_temperatures_c is not None:
        historical_mean_c = mean(
            historical_temperatures_c
        )

        historical_std_c = pstdev(
            historical_temperatures_c
        )

        zscore = calculate_zscore(
            temperature_c=reading.temperature_c,
            historical_temperatures_c=historical_temperatures_c,
        )

        zscore_anomaly_detected = is_zscore_anomaly(
            zscore=zscore,
            zscore_threshold=zscore_threshold,
        )

    condition = classify_extreme_condition(
        temperature_c=reading.temperature_c,
        extreme_threshold_c=extreme_threshold_c,
    )

    if zscore_anomaly_detected is None:
        overall_anomaly_detected = baseline_anomaly_detected
    else:
        overall_anomaly_detected = (
            baseline_anomaly_detected
            or zscore_anomaly_detected
        )

    return {
        "latitude": reading.latitude,
        "longitude": reading.longitude,
        "timestamp": reading.timestamp.isoformat(),
        "temperature_c": reading.temperature_c,
        "baseline_c": baseline_c,
        "anomaly_c": anomaly_c,
        "baseline_anomaly_detected": baseline_anomaly_detected,
        "historical_mean_c": historical_mean_c,
        "historical_std_c": historical_std_c,
        "zscore": zscore,
        "zscore_anomaly_detected": zscore_anomaly_detected,
        "overall_anomaly_detected": overall_anomaly_detected,
        "condition": condition,
        "source": reading.source,
    }


def analyze_segment_anomaly(
    segment: RouteSegment,
    reading: ClimateReading,
    baseline_c: float,
    anomaly_threshold_c: float = 3.0,
    extreme_threshold_c: float = 40.0,
    historical_temperatures_c: list[float] | None = None,
    zscore_threshold: float = 2.0,
) -> dict:
    """
    Analyze climate anomaly for one route segment.
    """

    validate_route_segment(segment)
    validate_climate_reading(reading)

    result = analyze_climate_anomaly(
        reading=reading,
        baseline_c=baseline_c,
        anomaly_threshold_c=anomaly_threshold_c,
        extreme_threshold_c=extreme_threshold_c,
        historical_temperatures_c=historical_temperatures_c,
        zscore_threshold=zscore_threshold,
    )

    result["segment_id"] = segment.segment_id
    result["distance_m"] = segment.distance_m
    result["estimated_time_s"] = segment.estimated_time_s

    return result


def analyze_route_anomalies(
    segments: list[RouteSegment],
    readings: list[ClimateReading],
    baseline_c: float,
    anomaly_threshold_c: float = 3.0,
    extreme_threshold_c: float = 40.0,
    historical_temperatures_by_segment: dict[
        str, list[float]
    ] | None = None,
    zscore_threshold: float = 2.0,
) -> dict:
    """
    Analyze climate anomalies across an entire route.

    historical_temperatures_by_segment maps each segment ID to
    historical temperatures for that segment's location/time window.

    Example:

        {
            "segment_1": [31.2, 32.0, 33.1, 31.8],
            "segment_2": [34.0, 35.2, 34.7, 35.0]
        }

    This allows each route segment to have its own local
    historical reference distribution.
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

    segment_results = []

    for segment, reading in zip(segments, readings):

        historical_temperatures = None

        if historical_temperatures_by_segment is not None:
            historical_temperatures = (
                historical_temperatures_by_segment.get(
                    segment.segment_id
                )
            )

        result = analyze_segment_anomaly(
            segment=segment,
            reading=reading,
            baseline_c=baseline_c,
            anomaly_threshold_c=anomaly_threshold_c,
            extreme_threshold_c=extreme_threshold_c,
            historical_temperatures_c=historical_temperatures,
            zscore_threshold=zscore_threshold,
        )

        segment_results.append(result)

    anomaly_values = [
        result["anomaly_c"]
        for result in segment_results
    ]

    anomaly_count = sum(
        result["overall_anomaly_detected"]
        for result in segment_results
    )

    extreme_count = sum(
        result["condition"] == "extreme"
        for result in segment_results
    )

    statistical_anomaly_count = sum(
        result["zscore_anomaly_detected"] is True
        for result in segment_results
    )

    return {
        "segment_count": len(segment_results),
        "anomaly_count": anomaly_count,
        "statistical_anomaly_count": statistical_anomaly_count,
        "extreme_segment_count": extreme_count,
        "maximum_anomaly_c": max(anomaly_values),
        "average_anomaly_c": mean(anomaly_values),
        "anomaly_detected": anomaly_count > 0,
        "extreme_condition_detected": extreme_count > 0,
        "segments": segment_results,
    }
