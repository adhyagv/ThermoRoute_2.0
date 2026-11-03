import logging

from ..models.route_models import RoutePoint, RouteSegment

logger = logging.getLogger(__name__)


def create_route_segments(
    points: list[RoutePoint],
    distances: list[float],
    times: list[float],
) -> list[RouteSegment]:
    """
    Convert route points into route segments.

    Consecutive points with identical coordinates (U-turns, GPS
    snapping artifacts, simplified OSRM polylines) are skipped
    rather than raising, so one bad pair doesn't invalidate the
    whole route.
    """
    if len(points) < 2:
        raise ValueError("At least two route points are required.")
    if len(distances) != len(points) - 1:
        raise ValueError(
            "Number of distances must be one less than number of points."
        )
    if len(times) != len(points) - 1:
        raise ValueError(
            "Number of times must be one less than number of points."
        )

    segments = []
    skipped = 0

    for i in range(len(points) - 1):
        origin = points[i]
        destination = points[i + 1]

        if (
            origin.latitude == destination.latitude
            and origin.longitude == destination.longitude
        ):
            skipped += 1
            logger.warning(
                "Skipping segment %d: origin and destination coordinates "
                "are identical (%s, %s).",
                i + 1,
                origin.latitude,
                origin.longitude,
            )
            continue

        segment = RouteSegment(
            segment_id=f"segment_{i + 1 - skipped}",
            origin=origin,
            destination=destination,
            distance_m=distances[i],
            estimated_time_s=times[i],
        )
        segments.append(segment)

    if not segments:
        raise ValueError(
            "No valid segments could be created from the given points."
        )

    return segments


def get_segment_midpoint(
    segment: RouteSegment,
) -> RoutePoint:
    """Return the approximate midpoint of a segment."""
    latitude = (
        segment.origin.latitude
        + segment.destination.latitude
    ) / 2
    longitude = (
        segment.origin.longitude
        + segment.destination.longitude
    ) / 2
    return RoutePoint(
        latitude=latitude,
        longitude=longitude,
    )