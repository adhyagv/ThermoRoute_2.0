from datetime import datetime
from typing import Iterable

from ..models.climate_models import ClimateReading
from ..models.route_models import Route, RoutePoint, RouteSegment


def validate_route_points(points: list[RoutePoint]) -> None:
    """
    Validate a sequence of route points.

    Raises:
        ValueError: If there are fewer than two points or if all points
        are effectively identical.
    """
    if len(points) < 2:
        raise ValueError("At least two route points are required.")

    unique_points = {
        (point.latitude, point.longitude)
        for point in points
    }
    if len(unique_points) < 2:
        raise ValueError(
            "Route must contain at least two distinct geographic points."
        )


def validate_route_segment(segment: RouteSegment) -> None:
    """
    Validate an individual route segment.
    """
    if not segment.segment_id.strip():
        raise ValueError("Segment ID cannot be empty.")
    if segment.distance_m <= 0:
        raise ValueError(
            f"Segment {segment.segment_id} must have a positive distance."
        )
    if segment.estimated_time_s <= 0:
        raise ValueError(
            f"Segment {segment.segment_id} must have a positive travel time."
        )
    if (
        segment.origin.latitude == segment.destination.latitude
        and segment.origin.longitude == segment.destination.longitude
    ):
        raise ValueError(
            f"Segment {segment.segment_id} has identical endpoints."
        )


def validate_route(route: Route) -> None:
    """
    Validate a complete route before climate processing.
    """
    if not route.route_id.strip():
        raise ValueError("Route ID cannot be empty.")
    if route.distance_m < 0:
        raise ValueError("Route distance cannot be negative.")
    if route.estimated_time_s < 0:
        raise ValueError("Route estimated time cannot be negative.")
    if not route.segments:
        raise ValueError("Route must contain at least one segment.")

    for segment in route.segments:
        validate_route_segment(segment)

    validate_route_points(
        [segment.origin for segment in route.segments]
        + [route.segments[-1].destination]
    )


def validate_climate_reading(reading: ClimateReading) -> None:
    """
    Validate a normalized environmental reading before it enters
    the climate intelligence pipeline.
    """
    if not reading.source.strip():
        raise ValueError("Climate reading source cannot be empty.")
    if reading.temperature_c < -273.15:
        raise ValueError(
            "Temperature cannot be below absolute zero."
        )
    if not isinstance(reading.timestamp, datetime):
        raise ValueError(
            "Climate reading timestamp must be a datetime object."
        )


def validate_climate_readings(
    readings: Iterable[ClimateReading],
) -> list[ClimateReading]:
    """
    Validate a collection of climate readings.

    Returns:
        The validated readings as a list.
    """
    readings = list(readings)
    if not readings:
        raise ValueError("At least one climate reading is required.")
    for reading in readings:
        validate_climate_reading(reading)
    return readings


def validate_route_climate_alignment(
    segments: list[RouteSegment],
    readings: list[ClimateReading],
) -> None:
    """
    Ensure that climate readings are available for the route segments.
    The current implementation expects one climate reading per segment,
    matched by list position (segments[i] <-> readings[i]).
    """
    if not segments:
        raise ValueError("No route segments provided.")
    if not readings:
        raise ValueError("No climate readings provided.")
    if len(readings) != len(segments):
        raise ValueError(
            "Number of climate readings must match the number "
            "of route segments."
        )