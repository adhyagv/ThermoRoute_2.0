"""Route-wide environmental sampling and transparent exposure estimates.

Forecast values are model grid-cell outputs. Shade and waterlogging indicators
are spatial estimates from mapped OpenStreetMap features; missing OSM tags are
never interpreted as proof that shade or hazards do not exist.
"""
from __future__ import annotations

import math
import hashlib
import threading
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests
from astral import Observer
from astral.sun import azimuth as astral_azimuth
from astral.sun import elevation as astral_elevation
from astral.sun import sunrise as astral_sunrise
from astral.sun import sunset as astral_sunset

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
TIMEZONE = ZoneInfo("Asia/Kolkata")
PROFILE_WEIGHTS = {
    "adult": {"heat": 0.40, "uv": 0.20, "aqi": 0.25, "shade": 0.15},
    "elderly": {"heat": 0.45, "uv": 0.20, "aqi": 0.20, "shade": 0.15},
    "child": {"heat": 0.40, "uv": 0.25, "aqi": 0.20, "shade": 0.15},
    "asthma": {"heat": 0.20, "uv": 0.10, "aqi": 0.55, "shade": 0.15},
    "outdoor_worker": {"heat": 0.50, "uv": 0.20, "aqi": 0.15, "shade": 0.15},
    "cyclist": {"heat": 0.35, "uv": 0.15, "aqi": 0.20, "shade": 0.30},
    "pedestrian": {"heat": 0.40, "uv": 0.20, "aqi": 0.20, "shade": 0.20},
}
MAX_ROUTE_SAMPLES = 20
MAX_DEPARTURE_HOURS = 12
_response_cache: dict[str, tuple[float, Any]] = {}
_response_cache_lock = threading.Lock()


def _cache_key(prefix: str, payload: Any) -> str:
    digest = hashlib.sha256(repr(payload).encode("utf-8")).hexdigest()
    return f"{prefix}:{digest}"


def _get_cached(key: str) -> Any | None:
    now = time.monotonic()
    with _response_cache_lock:
        entry = _response_cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= now:
            del _response_cache[key]
            return None
        return value


def _set_cached(key: str, value: Any, ttl_seconds: int) -> None:
    with _response_cache_lock:
        _response_cache[key] = (time.monotonic() + ttl_seconds, value)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Coordinates are (latitude, longitude)."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def _interpolate_point(a: tuple[float, float], b: tuple[float, float], fraction: float) -> tuple[float, float]:
    return (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)


def sample_geometry(
    geometry: list[tuple[float, float]],
    max_samples: int = MAX_ROUTE_SAMPLES,
    spacing_m: float = 400.0,
) -> tuple[list[dict[str, float]], float]:
    """Resample a (lat, lon) route at equally spaced distances."""
    if len(geometry) < 2:
        raise ValueError("Route geometry must contain at least two points.")
    cumulative = [0.0]
    for index in range(1, len(geometry)):
        cumulative.append(cumulative[-1] + haversine_m(geometry[index - 1], geometry[index]))
    total_distance = cumulative[-1]
    if total_distance <= 0:
        raise ValueError("Route geometry has zero length.")
    if spacing_m <= 0:
        raise ValueError("Sample spacing must be greater than zero.")
    sample_count = max(2, min(max_samples, math.ceil(total_distance / spacing_m) + 1))
    samples: list[dict[str, float]] = []
    segment_index = 0
    for sample_index in range(sample_count):
        target = total_distance * sample_index / (sample_count - 1)
        while segment_index < len(cumulative) - 2 and cumulative[segment_index + 1] < target:
            segment_index += 1
        start, end = cumulative[segment_index], cumulative[segment_index + 1]
        fraction = 0.0 if end <= start else (target - start) / (end - start)
        point = _interpolate_point(geometry[segment_index], geometry[segment_index + 1], fraction)
        samples.append({"latitude": point[0], "longitude": point[1], "distance_from_start_m": target})
    return samples, total_distance


def allocate_sample_durations(samples: list[dict[str, float]], total_duration_seconds: float, total_distance_m: float) -> list[float]:
    """Allocate route duration across n-1 intervals; sum equals route duration."""
    if len(samples) < 2:
        return []
    if total_duration_seconds < 0 or total_distance_m <= 0:
        raise ValueError("Duration must be non-negative and route distance positive.")
    durations = []
    for index in range(len(samples) - 2):
        segment_distance = samples[index + 1]["distance_from_start_m"] - samples[index]["distance_from_start_m"]
        durations.append(total_duration_seconds * segment_distance / total_distance_m)
    if len(samples) > 1:
        durations.append(total_duration_seconds - sum(durations))
    return durations


def solar_position(latitude: float, longitude: float, when: datetime) -> dict[str, float]:
    """Return Astral solar azimuth clockwise from north and elevation in degrees."""
    local = when.astimezone(TIMEZONE) if when.tzinfo else when.replace(tzinfo=TIMEZONE)
    observer = Observer(latitude=latitude, longitude=longitude)
    return {
        "azimuth_deg": astral_azimuth(observer, local),
        "elevation_deg": astral_elevation(observer, local),
    }


def solar_daylight(latitude: float, longitude: float, when: datetime) -> dict[str, str | None]:
    local = when.astimezone(TIMEZONE) if when.tzinfo else when.replace(tzinfo=TIMEZONE)
    observer = Observer(latitude=latitude, longitude=longitude)
    try:
        sunrise = astral_sunrise(observer, date=local.date(), tzinfo=TIMEZONE).isoformat()
    except ValueError:
        sunrise = None
    try:
        sunset = astral_sunset(observer, date=local.date(), tzinfo=TIMEZONE).isoformat()
    except ValueError:
        sunset = None
    return {"sunrise": sunrise, "sunset": sunset}


def _parse_departure(value: str | None) -> datetime:
    if not value:
        return datetime.now(TIMEZONE).replace(second=0, microsecond=0)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(TIMEZONE) if parsed.tzinfo else parsed.replace(tzinfo=TIMEZONE)


def _multi_json(response: requests.Response, count: int) -> list[dict[str, Any]]:
    payload = response.json()
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def fetch_route_forecasts(samples: list[dict[str, float]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    latitudes = ",".join(f"{item['latitude']:.5f}" for item in samples)
    longitudes = ",".join(f"{item['longitude']:.5f}" for item in samples)
    common = {"latitude": latitudes, "longitude": longitudes, "timezone": "Asia/Kolkata", "forecast_days": 2}
    cache_key = _cache_key("forecast", (latitudes, longitudes))
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached
    headers = {"Accept": "application/json", "User-Agent": "ThermoRoute/3.2.1 (open-data research prototype)"}
    status: dict[str, str] = {"weather": "unavailable", "air_quality": "unavailable"}
    weather: list[dict[str, Any]] = [{} for _ in samples]
    air: list[dict[str, Any]] = [{} for _ in samples]
    try:
        response = requests.get(WEATHER_URL, params={**common, "hourly": "temperature_2m,apparent_temperature,uv_index,precipitation_probability,precipitation,wind_speed_10m"}, headers=headers, timeout=20)
        response.raise_for_status()
        weather = _multi_json(response, len(samples))
        if len(weather) < len(samples) and len(samples) == 1:
            weather = weather[:1]
        status["weather"] = "forecast" if len(weather) == len(samples) else "partial"
    except requests.RequestException as error:
        status["weather"] = f"unavailable: {error.__class__.__name__}"
    except (ValueError, TypeError):
        status["weather"] = "unavailable: invalid response"
    try:
        response = requests.get(AIR_URL, params={**common, "hourly": "us_aqi,pm2_5,pm10"}, headers=headers, timeout=20)
        response.raise_for_status()
        air = _multi_json(response, len(samples))
        status["air_quality"] = "forecast" if len(air) == len(samples) else "partial"
    except requests.RequestException as error:
        status["air_quality"] = f"unavailable: {error.__class__.__name__}"
    except (ValueError, TypeError):
        status["air_quality"] = "unavailable: invalid response"
    weather = (weather + [{} for _ in samples])[:len(samples)]
    air = (air + [{} for _ in samples])[:len(samples)]
    result = (weather, air, status)
    if status["weather"] != "unavailable" or status["air_quality"] != "unavailable":
        _set_cached(cache_key, result, 1800)
    return result


def fetch_osm_shade_features(samples: list[dict[str, float]]) -> tuple[list[dict[str, Any]], str]:
    """Fetch nearby building/tree/low-lying features once for all route samples."""
    location_key = tuple((round(item["latitude"], 5), round(item["longitude"], 5)) for item in samples)
    cache_key = _cache_key("osm-shade", location_key)
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached
    statements = []
    for point in samples:
        lat, lon = point["latitude"], point["longitude"]
        statements.extend([
            f'way["building"](around:400,{lat:.6f},{lon:.6f});',
            f'node["natural"="tree"](around:25,{lat:.6f},{lon:.6f});',
            f'way["natural"="tree_row"](around:30,{lat:.6f},{lon:.6f});',
            f'nwr["tunnel"](around:25,{lat:.6f},{lon:.6f});',
            f'nwr["highway"="ford"](around:25,{lat:.6f},{lon:.6f});',
            f'way["landuse"~"forest|grass|meadow|orchard"](around:120,{lat:.6f},{lon:.6f});',
        ])
    query = "[out:json][timeout:20];(\n" + "\n".join(statements) + "\n);out geom tags;"
    try:
        response = requests.post(OVERPASS_URL, data={"data": query}, headers={"User-Agent": "ThermoRoute/3.2.1 (open-data research prototype)"}, timeout=25)
        response.raise_for_status()
        data = response.json()
        elements = data.get("elements", []) if isinstance(data, dict) else []
        result = ([element for element in elements if isinstance(element, dict)], "osm_overpass")
        _set_cached(cache_key, result, 3600)
        return result
    except (requests.RequestException, ValueError, TypeError) as error:
        result = ([], f"unavailable: {error.__class__.__name__}")
        return result


def _feature_center(element: dict[str, Any]) -> tuple[float, float] | None:
    if isinstance(element.get("lat"), (int, float)) and isinstance(element.get("lon"), (int, float)):
        return float(element["lat"]), float(element["lon"])
    center = element.get("center")
    if isinstance(center, dict) and isinstance(center.get("lat"), (int, float)) and isinstance(center.get("lon"), (int, float)):
        return float(center["lat"]), float(center["lon"])
    geometry = element.get("geometry")
    points = [
        (float(vertex["lat"]), float(vertex["lon"]))
        for vertex in geometry or []
        if isinstance(vertex, dict)
        and isinstance(vertex.get("lat"), (int, float))
        and isinstance(vertex.get("lon"), (int, float))
    ]
    if points:
        return (
            sum(point[0] for point in points) / len(points),
            sum(point[1] for point in points) / len(points),
        )
    return None


def _bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    delta_lon = math.radians(b[1] - a[1])
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _angle_difference(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def _project_local(latitude: float, longitude: float, origin: tuple[float, float]) -> tuple[float, float]:
    """Local equirectangular metric projection, suitable for Bengaluru-scale geometry."""
    origin_latitude, origin_longitude = origin
    x = math.radians(longitude - origin_longitude) * 6_371_000 * math.cos(math.radians(origin_latitude))
    y = math.radians(latitude - origin_latitude) * 6_371_000
    return x, y


def _unproject_local(x: float, y: float, origin: tuple[float, float]) -> tuple[float, float]:
    origin_latitude, origin_longitude = origin
    latitude = origin_latitude + math.degrees(y / 6_371_000)
    longitude_scale = math.cos(math.radians(origin_latitude))
    longitude = origin_longitude + math.degrees(x / (6_371_000 * longitude_scale))
    return latitude, longitude


def _point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    if len(polygon) < 3:
        return False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    ordered = sorted(set(points))
    if len(ordered) <= 2:
        return ordered

    def cross(origin: tuple[float, float], first: tuple[float, float], second: tuple[float, float]) -> float:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _positive_tag(tags: dict[str, Any], key: str) -> float | None:
    raw = tags.get(key)
    if not isinstance(raw, (str, int, float)):
        return None
    try:
        number = float(str(raw).lower().replace("meters", "").replace("meter", "").replace("m", "").strip())
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0 else None


def _building_height(tags: dict[str, Any]) -> tuple[float | None, str]:
    height = _positive_tag(tags, "height")
    if height is not None:
        return height, "tagged_height"
    levels = _positive_tag(tags, "building:levels")
    if levels is not None:
        return levels * 3.0, "levels_estimate"
    return None, "unknown_height"


def estimate_shade(
    point: dict[str, float],
    solar: dict[str, float],
    features: list[dict[str, Any]],
    include_shadow_geometry: bool = False,
) -> dict[str, Any]:
    position = (point["latitude"], point["longitude"])
    elevation = solar["elevation_deg"]
    shadow_direction = (solar["azimuth_deg"] + 180) % 360
    shade_sources: list[str] = []
    shadow_polygons: list[list[tuple[float, float]]] = []
    buildings = 0
    buildings_with_height = 0
    buildings_with_footprints = 0
    evaluated_buildings = 0
    trees = 0
    trees_with_canopy_data = 0
    for element in features:
        center = _feature_center(element)
        tags = element.get("tags") if isinstance(element.get("tags"), dict) else {}
        if tags.get("building"):
            buildings += 1
            height, _ = _building_height(tags)
            geometry = element.get("geometry")
            if height is not None:
                buildings_with_height += 1
            if isinstance(geometry, list) and len(geometry) >= 3:
                buildings_with_footprints += 1
            if elevation <= 0 or height is None or center is None or not isinstance(geometry, list) or len(geometry) < 3:
                continue
            evaluated_buildings += 1
            distance = haversine_m(position, center)
            if distance > 600:
                continue
            shadow_length = min(600.0, height / max(math.tan(math.radians(elevation)), 1e-4))
            radians = math.radians(shadow_direction)
            dx, dy = math.sin(radians) * shadow_length, math.cos(radians) * shadow_length
            projected: list[tuple[float, float]] = []
            for vertex in geometry:
                if isinstance(vertex, dict) and isinstance(vertex.get("lat"), (int, float)) and isinstance(vertex.get("lon"), (int, float)):
                    projected.append(_project_local(float(vertex["lat"]), float(vertex["lon"]), position))
            if len(projected) >= 3:
                shadow_polygon = _convex_hull(projected + [(x + dx, y + dy) for x, y in projected])
                if _point_in_polygon((0.0, 0.0), shadow_polygon):
                    shade_sources.append("building_shadow_estimate")
                    if include_shadow_geometry and len(shadow_polygons) < 20:
                        ring = [_unproject_local(x, y, position) for x, y in shadow_polygon]
                        if len(ring) >= 3:
                            shadow_polygons.append([*ring, ring[0]])
            continue
        if tags.get("natural") == "tree":
            trees += 1
            crown_diameter = _positive_tag(tags, "diameter_crown")
            height = _positive_tag(tags, "height")
            if crown_diameter is not None and height is not None and center is not None:
                trees_with_canopy_data += 1
                if elevation > 0:
                    shadow_length = min(100.0, height / max(math.tan(math.radians(elevation)), 1e-4))
                    tree_base = _project_local(center[0], center[1], position)
                    radians = math.radians(shadow_direction)
                    shadow_tip = (
                        tree_base[0] + math.sin(radians) * shadow_length,
                        tree_base[1] + math.cos(radians) * shadow_length,
                    )
                    radius = crown_diameter / 2
                    if _point_segment_distance((0.0, 0.0), tree_base, shadow_tip) <= radius:
                        shade_sources.append("mapped_tree_canopy_estimate")
        if tags.get("natural") == "tree_row" and center is not None:
            trees += 1
            width = _positive_tag(tags, "width")
            height = _positive_tag(tags, "height")
            if width is not None and height is not None:
                trees_with_canopy_data += 1
                geometry = element.get("geometry")
                if elevation > 0 and isinstance(geometry, list):
                    row_points = [
                        _project_local(float(vertex["lat"]), float(vertex["lon"]), position)
                        for vertex in geometry
                        if isinstance(vertex, dict) and isinstance(vertex.get("lat"), (int, float)) and isinstance(vertex.get("lon"), (int, float))
                    ]
                    radius = width / 2 + min(100.0, height / max(math.tan(math.radians(elevation)), 1e-4))
                    if any(math.hypot(x, y) <= radius for x, y in row_points):
                        shade_sources.append("mapped_tree_row_estimate")
    if elevation <= 0:
        shade_estimated = None
        source = "sun_below_horizon"
    elif evaluated_buildings or trees_with_canopy_data:
        shade_estimated = bool(shade_sources)
        source = ",".join(sorted(set(shade_sources))) if shade_sources else "no_mapped_shadow_intersection"
    else:
        shade_estimated = None
        source = "insufficient_mapped_height_or_canopy_data"
    return {
        "shade_estimated": shade_estimated,
        "shade_source": source,
        "building_shadow_polygons": shadow_polygons,
        "mapped_cover_candidates": len(features),
        "building_count": buildings,
        "buildings_with_height": buildings_with_height,
        "buildings_with_footprints": buildings_with_footprints,
        "evaluated_buildings": evaluated_buildings,
        "tree_count": trees,
        "trees_with_canopy_data": trees_with_canopy_data,
    }


def _point_segment_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.hypot(px - sx, py - sy)
    fraction = max(0.0, min(1.0, ((px - sx) * dx + (py - sy) * dy) / length_squared))
    return math.hypot(px - (sx + fraction * dx), py - (sy + fraction * dy))


def _interpolate_hourly(
    payload: dict[str, Any],
    target: datetime,
    fields: dict[str, str],
) -> tuple[dict[str, float | None], str | None]:
    hourly = payload.get("hourly") if isinstance(payload.get("hourly"), dict) else {}
    times = hourly.get("time") if isinstance(hourly.get("time"), list) else []
    parsed_times: list[datetime | None] = []
    for raw in times:
        try:
            value = datetime.fromisoformat(str(raw))
            if value.tzinfo is None:
                value = value.replace(tzinfo=TIMEZONE)
            parsed_times.append(value.astimezone(TIMEZONE))
        except ValueError:
            parsed_times.append(None)
    target = target.astimezone(TIMEZONE)
    valid_times = [(index, when) for index, when in enumerate(parsed_times) if when is not None]
    if not valid_times or target < valid_times[0][1] or target > valid_times[-1][1]:
        return {key: None for key in fields.values()}, None
    right_position = next((position for position, (_, when) in enumerate(valid_times) if when >= target), None)
    if right_position is None:
        return {key: None for key in fields.values()}, None
    right_index, right_time = valid_times[right_position]
    if right_time == target:
        left_index, left_time = right_index, right_time
    elif right_position == 0:
        return {key: None for key in fields.values()}, None
    else:
        left_index, left_time = valid_times[right_position - 1]
        if right_index != left_index + 1:
            return {key: None for key in fields.values()}, None
    fraction = 0.0 if right_time == left_time else (target - left_time).total_seconds() / (right_time - left_time).total_seconds()
    result: dict[str, float | None] = {}
    for source_key, output_key in fields.items():
        values = hourly.get(source_key)
        left = values[left_index] if isinstance(values, list) and left_index < len(values) else None
        right = values[right_index] if isinstance(values, list) and right_index < len(values) else None
        if isinstance(left, (int, float)) and math.isfinite(float(left)) and isinstance(right, (int, float)) and math.isfinite(float(right)):
            result[output_key] = float(left) + (float(right) - float(left)) * fraction
        else:
            result[output_key] = None
    if right_time == left_time:
        forecast_time = right_time.isoformat()
    else:
        forecast_time = f"{left_time.isoformat()} / {right_time.isoformat()} (interpolated)"
    return result, forecast_time


def _weather_at(payload: dict[str, Any], target: datetime) -> tuple[dict[str, float | None], str | None]:
    return _interpolate_hourly(payload, target, {
        "temperature_2m": "temperature_c",
        "apparent_temperature": "apparent_temperature_c",
        "uv_index": "uv_index",
        "precipitation_probability": "precipitation_probability",
        "precipitation": "precipitation_mm",
        "wind_speed_10m": "wind_speed_kmh",
    })


def _air_at(payload: dict[str, Any], target: datetime) -> tuple[dict[str, float | None], str | None]:
    return _interpolate_hourly(payload, target, {
        "us_aqi": "us_aqi",
        "pm2_5": "pm2_5",
        "pm10": "pm10",
    })


def _component_score(weather: dict[str, float | None], air: dict[str, float | None], shade: dict[str, Any], profile: str) -> float | None:
    weights = PROFILE_WEIGHTS.get(profile, PROFILE_WEIGHTS["adult"])
    components: dict[str, float | None] = {
        "heat": _clamp(((weather["apparent_temperature_c"] - 24) / 16) * 100) if weather.get("apparent_temperature_c") is not None else None,
        "uv": _clamp((weather["uv_index"] / 11) * 100) if weather.get("uv_index") is not None else None,
        "aqi": _clamp((air["us_aqi"] / 300) * 100) if air.get("us_aqi") is not None else None,
        "shade": 100.0 if shade.get("shade_estimated") is False else 0.0 if shade.get("shade_estimated") is True else None,
    }
    usable = [(weights[key], value) for key, value in components.items() if value is not None]
    total_weight = sum(weight for weight, _ in usable)
    if total_weight <= 0:
        return None
    return round(sum(weight * float(value) for weight, value in usable) / total_weight, 2)


def _analyze_at_departure(
    samples: list[dict[str, float]],
    duration_seconds: float,
    departure: datetime,
    weather_data: list[dict[str, Any]],
    air_data: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
    profile: str,
    include_shadow_geometry: bool = False,
) -> tuple[list[dict[str, Any]], float | None]:
    sample_durations = []
    total_distance = samples[-1]["distance_from_start_m"]
    # Segment intervals sum exactly to the supplied route duration.
    interval_durations = allocate_sample_durations(samples, duration_seconds, total_distance)
    elapsed_seconds = 0.0
    for index, sample in enumerate(samples):
        arrival = departure + timedelta(seconds=elapsed_seconds)
        solar = solar_position(sample["latitude"], sample["longitude"], arrival)
        local_features = []
        position = (sample["latitude"], sample["longitude"])
        for feature in osm_features:
            center = _feature_center(feature)
            tags = feature.get("tags") if isinstance(feature.get("tags"), dict) else {}
            radius = 650 if tags.get("building") else 40
            if center and haversine_m(position, center) <= radius:
                local_features.append(feature)
        shade = estimate_shade(sample, solar, local_features, include_shadow_geometry)
        weather, weather_forecast_time = _weather_at(weather_data[index], arrival)
        air, air_forecast_time = _air_at(air_data[index], arrival)
        score = _component_score(weather, air, shade, profile)
        precipitation_probability = weather.get("precipitation_probability")
        rain_risk = "unknown"
        if precipitation_probability is not None:
            rain_risk = "elevated_estimate" if precipitation_probability >= 60 else "possible" if precipitation_probability >= 30 else "lower_forecast_probability"
        has_low_lying = any(
            isinstance(item.get("tags"), dict) and (
                "tunnel" in item["tags"] or item["tags"].get("highway") == "ford"
            ) for item in local_features
        )
        if has_low_lying and precipitation_probability is not None and precipitation_probability >= 30:
            rain_risk = "waterlogging_watch_estimate"
        sample_durations.append({
            "sample_index": index,
            "latitude": sample["latitude"],
            "longitude": sample["longitude"],
            "distance_from_start_m": round(sample["distance_from_start_m"], 1),
            "elapsed_minutes": round(elapsed_seconds / 60, 2),
            "predicted_arrival_at": arrival.isoformat(),
            "forecast_time": {
                "weather": weather_forecast_time,
                "air_quality": air_forecast_time,
            },
            "temperature_c": weather.get("temperature_c"),
            "apparent_temperature_c": weather.get("apparent_temperature_c"),
            "uv_index": weather.get("uv_index"),
            "us_aqi": air.get("us_aqi"),
            "pm2_5": air.get("pm2_5"),
            "precipitation_probability": precipitation_probability,
            "precipitation_mm": weather.get("precipitation_mm"),
            "wind_speed_kmh": weather.get("wind_speed_kmh"),
            "solar_azimuth_deg": round(solar["azimuth_deg"], 1),
            "solar_elevation_deg": round(solar["elevation_deg"], 1),
            "shade_estimated": shade.get("shade_estimated"),
            "shade_source": shade.get("shade_source"),
            "building_shadow_polygons": shade.get("building_shadow_polygons", []),
            "mapped_feature_count": len(local_features),
            "building_count": shade.get("building_count", 0),
            "buildings_with_height": shade.get("buildings_with_height", 0),
            "buildings_with_footprints": shade.get("buildings_with_footprints", 0),
            "tree_count": shade.get("tree_count", 0),
            "trees_with_canopy_data": shade.get("trees_with_canopy_data", 0),
            "waterlogging_risk": rain_risk,
            "route_exposure_score": score,
            "provenance": {
                "weather": "forecast_interpolated" if weather_forecast_time else "unavailable",
                "air_quality": "forecast_interpolated" if air_forecast_time else "unavailable",
                "shade": "estimated" if shade.get("shade_estimated") is not None else "unavailable",
            },
        })
        if index < len(interval_durations):
            elapsed_seconds += interval_durations[index]
    valid_scores = [row["route_exposure_score"] for row in sample_durations if row["route_exposure_score"] is not None]
    route_score = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None
    return sample_durations, route_score


def analyze_route(
    geometry: list[tuple[float, float]],
    duration_seconds: float,
    mode: str = "driving",
    departure_at: str | None = None,
    profile: str = "adult",
    max_extra_time_minutes: float = 10.0,
    route_id: str = "selected",
    route_options: list[dict[str, Any]] | None = None,
    strategy: str = "balanced",
    environmental_weight: float = 0.5,
    search_window_hours: int = 6,
    sample_spacing_m: float = 400.0,
    distance_m: float | None = None,
    turn_count: int = 0,
) -> dict[str, Any]:
    if not 0 <= environmental_weight <= 1:
        raise ValueError("Environmental preference weight must be between 0 and 1.")
    if not 0 <= max_extra_time_minutes <= 180:
        raise ValueError("Maximum additional journey time must be between 0 and 180 minutes.")
    if not 1 <= search_window_hours <= MAX_DEPARTURE_HOURS:
        raise ValueError(f"Departure search window must be between 1 and {MAX_DEPARTURE_HOURS} hours.")
    if sample_spacing_m <= 0:
        raise ValueError("Sample spacing must be greater than zero.")

    route_inputs = list(route_options or [])
    if any(item.get("route_id") == route_id for item in route_inputs):
        raise ValueError("route_options must not include the primary route identifier.")
    route_inputs.insert(0, {
        "route_id": route_id,
        "geometry": geometry,
        "distance_m": distance_m,
        "duration_seconds": duration_seconds,
        "turn_count": turn_count,
    })
    if not 1 <= len(route_inputs) <= 3:
        raise ValueError("Analyze between one and three route alternatives.")
    route_ids = [str(item.get("route_id", "")) for item in route_inputs]
    if not all(route_ids) or len(set(route_ids)) != len(route_ids):
        raise ValueError("Route alternative identifiers must be unique and non-empty.")

    per_route_limit = min(MAX_ROUTE_SAMPLES, max(2, 24 // len(route_inputs)))
    route_data: list[dict[str, Any]] = []
    all_samples: list[dict[str, float]] = []
    for item in route_inputs:
        route_geometry = item["geometry"]
        route_duration = float(item["duration_seconds"])
        route_samples, route_distance = sample_geometry(
            route_geometry,
            max_samples=per_route_limit,
            spacing_m=sample_spacing_m,
        )
        route_data.append({
            "route_id": str(item["route_id"]),
            "duration_seconds": route_duration,
            "distance_m": float(item.get("distance_m") or route_distance),
            "geometry_distance_m": route_distance,
            "turn_count": int(item.get("turn_count", 0)),
            "samples": route_samples,
            "sample_start": len(all_samples),
        })
        all_samples.extend(route_samples)

    departure = _parse_departure(departure_at)
    weather_data, air_data, forecast_status = fetch_route_forecasts(all_samples)
    osm_features, osm_status = fetch_osm_shade_features(all_samples)
    analyzed_at = datetime.now(TIMEZONE).isoformat()
    route_results: list[dict[str, Any]] = []
    for route in route_data:
        offset = route["sample_start"]
        count = len(route["samples"])
        route_weather = weather_data[offset:offset + count]
        route_air = air_data[offset:offset + count]
        sample_rows, exposure = _analyze_at_departure(
            route["samples"], route["duration_seconds"], departure,
            route_weather, route_air, osm_features, profile,
            include_shadow_geometry=route["route_id"] == route_id,
        )
        interval_durations = allocate_sample_durations(
            route["samples"], route["duration_seconds"], route["geometry_distance_m"]
        )
        for index, row in enumerate(sample_rows):
            row["segment_distance_m"] = round(
                route["samples"][index + 1]["distance_from_start_m"] - route["samples"][index]["distance_from_start_m"],
                1,
            ) if index < len(route["samples"]) - 1 else 0.0
            row["segment_duration_seconds"] = interval_durations[index] if index < len(interval_durations) else 0.0
        shade_stats = _route_shade_stats(sample_rows, route["geometry_distance_m"])
        route_features = _features_near_route(osm_features, route["samples"])
        building_features = [item for item in route_features if (item.get("tags") or {}).get("building")]
        tagged_height_count = sum(
            1 for item in building_features
            if _positive_tag(item.get("tags", {}), "height") is not None
        )
        level_height_count = sum(
            1 for item in building_features
            if _positive_tag(item.get("tags", {}), "height") is None
            and _positive_tag(item.get("tags", {}), "building:levels") is not None
        )
        tree_features = [
            item for item in route_features
            if (item.get("tags") or {}).get("natural") in {"tree", "tree_row"}
        ]
        green_cover_features = [
            item for item in route_features
            if (item.get("tags") or {}).get("landuse") in {"forest", "grass", "meadow", "orchard"}
            or (item.get("tags") or {}).get("natural") in {"wood", "grassland"}
        ]
        tree_data_count = sum(
            1 for item in tree_features
            if _positive_tag(item.get("tags", {}), "height") is not None
            and (
                _positive_tag(item.get("tags", {}), "diameter_crown") is not None
                or _positive_tag(item.get("tags", {}), "width") is not None
            )
        )
        building_coverage = round(
            100 * (tagged_height_count + level_height_count) / len(building_features), 1
        ) if building_features else None
        tree_coverage = round(100 * tree_data_count / len(tree_features), 1) if tree_features else None
        route_results.append({
            "route_id": route["route_id"],
            "distance_m": round(route["distance_m"], 1),
            "duration_seconds": round(route["duration_seconds"], 3),
            "turn_count": route["turn_count"],
            "sample_count": len(sample_rows),
            "segment_duration_sum_seconds": sum(interval_durations),
            "route_exposure_score": exposure,
            "heat_exposure_score": _mean_or_none([
                _clamp(((row["apparent_temperature_c"] - 24) / 16) * 100)
                if row["apparent_temperature_c"] is not None else None
                for row in sample_rows
            ]),
            "aqi_exposure_score": _mean_or_none([
                _clamp(row["us_aqi"] / 300 * 100) if row["us_aqi"] is not None else None
                for row in sample_rows
            ]),
            "mean_apparent_temperature_c": _mean_or_none([row["apparent_temperature_c"] for row in sample_rows]),
            "mean_us_aqi": _mean_or_none([row["us_aqi"] for row in sample_rows]),
            "mean_pm2_5": _mean_or_none([row["pm2_5"] for row in sample_rows]),
            "route_shade_percentage": shade_stats["shade_percentage"],
            "direct_sun_exposure_percentage": shade_stats["direct_sun_exposure_percentage"],
            "evaluated_shade_length_m": round(
                shade_stats["evaluated_length_m"] * route["distance_m"] / route["geometry_distance_m"],
                1,
            ) if route["geometry_distance_m"] else 0.0,
            "shade_segments": shade_stats["segments"],
            "building_height_data_coverage_percentage": building_coverage,
            "building_counts": {
                "mapped": len(building_features),
                "tagged_height": tagged_height_count,
                "levels_estimated_height": level_height_count,
                "unknown_height": max(0, len(building_features) - tagged_height_count - level_height_count),
            },
            "tree_data_coverage_percentage": tree_coverage,
            "tree_counts": {"mapped": len(tree_features), "with_height_and_canopy": tree_data_count},
            "green_cover_feature_count": len(green_cover_features),
            "shade_confidence": _shade_confidence(shade_stats, route["geometry_distance_m"], building_coverage, tree_coverage),
            "samples": sample_rows,
        })

    selected_result = next((item for item in route_results if item["route_id"] == route_id), route_results[0])
    route_comparison = _rank_route_alternatives(route_results, strategy, environmental_weight)

    departure_candidates: list[dict[str, Any]] = []
    start = datetime.now(TIMEZONE).replace(second=0, microsecond=0)
    fastest_duration = min(route["duration_seconds"] for route in route_data)
    all_departure_options: list[dict[str, Any]] = []
    for step in range(search_window_hours * 2 + 1):
        candidate_departure = start + timedelta(minutes=30 * step)
        candidate_options = []
        for route in route_data:
            offset = route["sample_start"]
            count = len(route["samples"])
            _, score = _analyze_at_departure(
                route["samples"],
                route["duration_seconds"],
                candidate_departure,
                weather_data[offset:offset + count],
                air_data[offset:offset + count],
                osm_features,
                profile,
            )
            extra_minutes = max(0.0, (route["duration_seconds"] - fastest_duration) / 60)
            option = {
                "departure_at": candidate_departure.isoformat(),
                "route_id": route["route_id"],
                "exposure_score": score,
                "journey_duration_minutes": round(route["duration_seconds"] / 60, 1),
                "extra_travel_time_minutes": round(extra_minutes, 1),
                "wait_minutes": round((candidate_departure - start).total_seconds() / 60, 1),
                "expected_arrival_at": (candidate_departure + timedelta(seconds=route["duration_seconds"])).isoformat(),
                "eligible": extra_minutes <= max_extra_time_minutes,
            }
            all_departure_options.append(option)
            if option["eligible"] and score is not None:
                candidate_options.append(option)
        best_option = min(candidate_options, key=lambda item: item["exposure_score"], default=None)
        departure_candidates.append({
            "departure_at": candidate_departure.isoformat(),
            "exposure_score": best_option["exposure_score"] if best_option else None,
            "route_id": best_option["route_id"] if best_option else None,
            "journey_duration_minutes": best_option["journey_duration_minutes"] if best_option else None,
            "extra_travel_time_minutes": best_option["extra_travel_time_minutes"] if best_option else None,
            "wait_minutes": round((candidate_departure - start).total_seconds() / 60, 1),
            "expected_arrival_at": best_option["expected_arrival_at"] if best_option else None,
        })
    recommended_departure = min(
        (item for item in all_departure_options if item["eligible"] and item["exposure_score"] is not None),
        key=lambda item: (item["exposure_score"], item["wait_minutes"]),
        default=None,
    )
    closest_alternatives = sorted(
        (
            item for item in all_departure_options
            if not item["eligible"] and item["exposure_score"] is not None
        ),
        key=lambda item: (
            item["extra_travel_time_minutes"] - max_extra_time_minutes,
            item["exposure_score"],
            item["wait_minutes"],
        ),
    )[:3]
    immediate_options = [
        item for item in all_departure_options
        if item["wait_minutes"] == 0 and item["eligible"] and item["exposure_score"] is not None
    ]
    immediate_reference = min(immediate_options, key=lambda item: item["exposure_score"], default=None)

    if mode == "driving":
        co2_factor_g_km = 170.0
    elif mode in {"cycling", "walking"}:
        co2_factor_g_km = 0.0
    else:
        co2_factor_g_km = None
    daylight = solar_daylight(
        selected_result["samples"][0]["latitude"],
        selected_result["samples"][0]["longitude"],
        departure,
    )
    return {
        "status": "success" if selected_result["route_exposure_score"] is not None else "partial",
        "mode": mode,
        "profile": profile,
        "route_id": selected_result["route_id"],
        "distance_m": selected_result["distance_m"],
        "duration_seconds": selected_result["duration_seconds"],
        "sample_count": selected_result["sample_count"],
        "sample_spacing_m": sample_spacing_m,
        "segment_duration_sum_seconds": selected_result["segment_duration_sum_seconds"],
        "route_exposure_score": selected_result["route_exposure_score"],
        "samples": selected_result["samples"],
        "route_shade_percentage": selected_result["route_shade_percentage"],
        "direct_sun_exposure_percentage": selected_result["direct_sun_exposure_percentage"],
        "evaluated_shade_length_m": selected_result["evaluated_shade_length_m"],
        "shade_segments": selected_result["shade_segments"],
        "building_height_data_coverage_percentage": selected_result["building_height_data_coverage_percentage"],
        "building_counts": selected_result["building_counts"],
        "tree_data_coverage_percentage": selected_result["tree_data_coverage_percentage"],
        "tree_counts": selected_result["tree_counts"],
        "shade_confidence": selected_result["shade_confidence"],
        "solar_daylight": daylight,
        "solar_position": {
            "azimuth_deg": selected_result["samples"][0]["solar_azimuth_deg"],
            "elevation_deg": selected_result["samples"][0]["solar_elevation_deg"],
            "sampled_at": selected_result["samples"][0]["predicted_arrival_at"],
        },
        "route_comparison": route_comparison,
        "strategy": strategy,
        "environmental_weight": environmental_weight,
        "route_recommendation": _route_recommendation(route_comparison, strategy),
        "departure_recommendation": recommended_departure,
        "departure_message": None if recommended_departure else "No suitable departure time found within your selected time limit.",
        "departure_candidates": departure_candidates,
        "closest_alternatives": closest_alternatives,
        "immediate_reference": immediate_reference,
        "max_extra_time_minutes": max_extra_time_minutes,
        "search_window_hours": search_window_hours,
        "analyzed_at": analyzed_at,
        "co2_tailpipe_estimate_g": round(selected_result["distance_m"] / 1000 * co2_factor_g_km, 1) if co2_factor_g_km is not None else None,
        "co2_method": "Illustrative default tailpipe factor: 170 g CO2/km for a passenger car; zero direct tailpipe emissions for walking/cycling. Not lifecycle emissions.",
        "data_status": {"weather": forecast_status["weather"], "air_quality": forecast_status["air_quality"], "osm_shade": osm_status},
        "limitations": [
            "Open-Meteo values are forecast grid-cell model outputs, not street sensors.",
            "OSM building and tree coverage is incomplete; shade uses estimated local-metric shadow geometry, not a ray-traced urban model.",
            "Building levels are converted to height using an assumed 3 m per level; such values are explicitly estimated.",
            "Route comparison covers only alternatives returned by the routing provider, not every possible path through the road network.",
            "Departure comparison holds OSRM route duration constant and does not model future traffic.",
            "Hourly forecast values are linearly interpolated only between valid adjacent observations; values outside the forecast horizon are unavailable.",
            "Waterlogging is an estimate from forecast precipitation and nearby mapped tunnel/ford tags, not a flood forecast.",
            "Exposure score is a project-specific decision-support index, not a medical risk assessment.",
        ],
    }


def _mean_or_none(values: list[float | None]) -> float | None:
    valid = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
    return round(sum(valid) / len(valid), 2) if valid else None


def _features_near_route(features: list[dict[str, Any]], samples: list[dict[str, float]]) -> list[dict[str, Any]]:
    near: dict[tuple[Any, Any], dict[str, Any]] = {}
    for feature in features:
        center = _feature_center(feature)
        if center and any(haversine_m((sample["latitude"], sample["longitude"]), center) <= 650 for sample in samples):
            key = (feature.get("type"), feature.get("id", id(feature)))
            near[key] = feature
    return list(near.values())


def _route_shade_stats(samples: list[dict[str, Any]], total_distance: float) -> dict[str, Any]:
    evaluated_length = 0.0
    shaded_length = 0.0
    segments: list[dict[str, Any]] = []
    for sample in samples:
        sample["segment_shade_percentage"] = None
    for index in range(len(samples) - 1):
        start, end = samples[index], samples[index + 1]
        length = float(end["distance_from_start_m"] - start["distance_from_start_m"])
        known = [state for state in (start["shade_estimated"], end["shade_estimated"]) if isinstance(state, bool)]
        shade_percentage = 100 * sum(known) / len(known) if known else None
        if known:
            evaluated_length += length
            shaded_length += length * sum(known) / len(known)
        start["segment_shade_percentage"] = round(shade_percentage, 1) if shade_percentage is not None else None
        segments.append({
            "segment_index": index,
            "distance_m": round(length, 1),
            "shade_percentage": round(shade_percentage, 1) if shade_percentage is not None else None,
        })
    shade_percentage = round(100 * shaded_length / evaluated_length, 1) if evaluated_length else None
    return {
        "shade_percentage": shade_percentage,
        "direct_sun_exposure_percentage": round(100 - shade_percentage, 1) if shade_percentage is not None else None,
        "evaluated_length_m": round(min(evaluated_length, total_distance), 1),
        "segments": segments,
    }


def _shade_confidence(
    shade_stats: dict[str, Any],
    total_distance: float,
    building_coverage: float | None,
    tree_coverage: float | None,
) -> str:
    if shade_stats["shade_percentage"] is None:
        return "unavailable"
    coverage = shade_stats["evaluated_length_m"]
    if coverage <= 0:
        return "unavailable"
    source_coverage = [value for value in (building_coverage, tree_coverage) if value is not None]
    if coverage / max(total_distance, 1.0) >= 0.8 and source_coverage and min(source_coverage) >= 70:
        return "moderate"
    return "low"


def _normalized_lower(value: float | None, values: list[float | None]) -> float | None:
    if value is None:
        return None
    valid = [candidate for candidate in values if candidate is not None and math.isfinite(candidate)]
    if not valid:
        return None
    minimum, maximum = min(valid), max(valid)
    return 1.0 if maximum - minimum < 1e-9 else 1 - (value - minimum) / (maximum - minimum)


def _route_dominates(first: dict[str, Any], second: dict[str, Any]) -> bool:
    metrics = [
        (first["duration_seconds"], second["duration_seconds"]),
        (first["distance_m"], second["distance_m"]),
        (first["route_exposure_score"], second["route_exposure_score"]),
        (first["aqi_exposure_score"], second["aqi_exposure_score"]),
        (first["turn_count"], second["turn_count"]),
        (
            100 - first["route_shade_percentage"] if first["route_shade_percentage"] is not None else None,
            100 - second["route_shade_percentage"] if second["route_shade_percentage"] is not None else None,
        ),
    ]
    comparable = [(first_value, second_value) for first_value, second_value in metrics if first_value is not None and second_value is not None]
    return bool(comparable) and all(first_value <= second_value for first_value, second_value in comparable) and any(
        first_value < second_value for first_value, second_value in comparable
    )


def _rank_route_alternatives(
    results: list[dict[str, Any]],
    strategy: str,
    environmental_weight: float,
) -> list[dict[str, Any]]:
    durations = [item["duration_seconds"] for item in results]
    distances = [item["distance_m"] for item in results]
    turns = [item["turn_count"] for item in results]
    environmental = [item["route_exposure_score"] for item in results]
    aqis = [item["aqi_exposure_score"] for item in results]
    ranked: list[dict[str, Any]] = []
    for item in results:
        time_score = _normalized_lower(item["duration_seconds"], durations)
        distance_score = _normalized_lower(item["distance_m"], distances)
        heat_score = _normalized_lower(item["route_exposure_score"], environmental)
        air_score = _normalized_lower(item["aqi_exposure_score"], aqis)
        turn_score = _normalized_lower(item["turn_count"], turns)
        environment_values = [value for value in (heat_score, air_score) if value is not None]
        environment_score = sum(environment_values) / len(environment_values) if environment_values else None
        if strategy == "fastest":
            score = time_score
        elif strategy == "shortest":
            score = distance_score
        elif strategy == "coolest":
            score = heat_score
        elif strategy == "cleanest":
            score = air_score
        else:
            components: list[tuple[float, float]] = []
            if time_score is not None and environmental_weight < 1:
                components.append((time_score, 0.9 * (1 - environmental_weight)))
            if environment_score is not None and environmental_weight > 0:
                components.append((environment_score, 0.9 * environmental_weight))
            if turn_score is not None:
                components.append((turn_score, 0.1))
            weight_sum = sum(weight for _, weight in components)
            score = sum(value * weight for value, weight in components) / weight_sum if weight_sum else None
        ranked.append({
            **item,
            "samples": [
                {key: value for key, value in sample.items() if key != "building_shadow_polygons"}
                for sample in item["samples"]
            ],
            "normalized_score": round(score * 100, 1) if score is not None else None,
            "environmental_score": round(environment_score * 100, 1) if environment_score is not None else None,
            "pareto_dominated": any(_route_dominates(other, item) for other in results if other is not item),
            "rank": 0,
        })
    ranked.sort(key=lambda item: (
        item["normalized_score"] is None,
        -(item["normalized_score"] if item["normalized_score"] is not None else 0),
        item["duration_seconds"],
    ))
    return [{**item, "rank": index + 1} for index, item in enumerate(ranked)]


def _route_recommendation(results: list[dict[str, Any]], strategy: str) -> dict[str, Any] | None:
    top = next((item for item in results if item["rank"] == 1 and item["normalized_score"] is not None), None)
    if top is None:
        return None
    reasons = {
        "fastest": "Lowest normalized OSRM journey duration among returned alternatives.",
        "shortest": "Shortest returned route geometry.",
        "coolest": "Lowest available route exposure index among returned alternatives.",
        "cleanest": "Lowest available forecast AQI exposure among returned alternatives.",
        "balanced": "Best normalized trade-off between route time, available environmental indicators and turn complexity.",
    }
    return {"route_id": top["route_id"], "reason": reasons[strategy]}
