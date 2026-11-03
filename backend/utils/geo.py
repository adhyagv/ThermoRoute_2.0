import math

from ..models.route_models import RoutePoint

EARTH_RADIUS_M = 6_371_000.0


def calculate_distance_m(
    point_a: RoutePoint,
    point_b: RoutePoint,
) -> float:
    """
    Calculate the great-circle distance between two geographic points
    using the Haversine formula.

    Returns:
        Distance between the points in meters.
    """
    lat1 = math.radians(point_a.latitude)
    lat2 = math.radians(point_b.latitude)
    delta_lat = math.radians(point_b.latitude - point_a.latitude)
    delta_lon = math.radians(point_b.longitude - point_a.longitude)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_M * c


def calculate_route_distance_m(
    points: list[RoutePoint],
) -> float:
    """
    Calculate the total geographic distance of a route
    by summing the distances between consecutive points.

    Returns:
        Total route distance in meters.
    """
    if len(points) < 2:
        raise ValueError("At least two route points are required.")

    total_distance = 0.0
    for i in range(len(points) - 1):
        total_distance += calculate_distance_m(points[i], points[i + 1])
    return total_distance


def get_midpoint(
    point_a: RoutePoint,
    point_b: RoutePoint,
) -> RoutePoint:
    """
    Calculate an approximate geographic midpoint between
    two route points.

    This is suitable for selecting a representative coordinate
    for segment-level environmental lookup. Uses simple lat/lon
    averaging, which is accurate for the short intra-city segment
    lengths ThermoRoute deals with. Not accurate for points that
    straddle the antimeridian (±180° longitude) — not a concern
    for U.S. coverage outside the far western Aleutians.
    """
    latitude = (point_a.latitude + point_b.latitude) / 2
    longitude = (point_a.longitude + point_b.longitude) / 2
    return RoutePoint(latitude=latitude, longitude=longitude)


def calculate_bearing(
    point_a: RoutePoint,
    point_b: RoutePoint,
) -> float:
    """
    Calculate the initial bearing from point_a to point_b.

    Returns:
        Bearing in degrees from north, in the range [0, 360).
    """
    lat1 = math.radians(point_a.latitude)
    lat2 = math.radians(point_b.latitude)
    delta_lon = math.radians(point_b.longitude - point_a.longitude)

    x = math.sin(delta_lon) * math.cos(lat2)
    y = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    )
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def interpolate_point(
    point_a: RoutePoint,
    point_b: RoutePoint,
    fraction: float,
) -> RoutePoint:
    """
    Interpolate between two geographic points.

    Args:
        point_a: Starting point.
        point_b: Ending point.
        fraction: Value between 0.0 and 1.0.

    Returns:
        A geographic point between point_a and point_b.
    """
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("Fraction must be between 0.0 and 1.0.")

    latitude = point_a.latitude + (point_b.latitude - point_a.latitude) * fraction
    longitude = point_a.longitude + (point_b.longitude - point_a.longitude) * fraction
    return RoutePoint(latitude=latitude, longitude=longitude)


def is_same_point(
    point_a: RoutePoint,
    point_b: RoutePoint,
    tolerance_deg: float = 0.0,
) -> bool:
    """
    Check whether two route points have identical (or near-identical,
    within tolerance_deg) coordinates.

    Args:
        tolerance_deg: Maximum allowed difference per coordinate.
            Defaults to 0.0 for exact equality, matching prior
            behavior. Pass a small value (e.g. 1e-9) if comparing
            points derived from floating-point arithmetic
            (get_midpoint, interpolate_point) where exact equality
            may fail to catch effectively-identical points.
    """
    return (
        abs(point_a.latitude - point_b.latitude) <= tolerance_deg
        and abs(point_a.longitude - point_b.longitude) <= tolerance_deg
    )