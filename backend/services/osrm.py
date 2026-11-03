import requests

USER_AGENT = "ThermoRoute-Hackathon-Demo/1.0"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_BASE_URL = "https://routing.openstreetmap.de/routed-car"
OSRM_PROFILE = "driving"
MAX_ALTERNATIVES = 3


class RoutingError(Exception):
    """Geocoding or OSRM routing failed. The journey cannot proceed."""


def _headers():
    return {"User-Agent": USER_AGENT}


def geocode_location(place_name: str) -> dict:
    """
    Resolve a free-text place name to lon/lat via Nominatim.

    Returns:
        {latitude, longitude, display_name}
    """
    query = (place_name or "").strip()
    if not query:
        raise RoutingError("Unable to find location: empty search text.")

    try:
        response = requests.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "json",
                "limit": 1,
            },
            headers=_headers(),
            timeout=20,
        )
        response.raise_for_status()
        results = response.json()
    except requests.Timeout as error:
        raise RoutingError(
            f"Location lookup timed out for '{query}'."
        ) from error
    except requests.RequestException as error:
        raise RoutingError(
            f"Unable to look up location '{query}': {error}"
        ) from error
    except ValueError as error:
        raise RoutingError(
            f"Location lookup returned invalid data for '{query}'."
        ) from error

    if not results:
        raise RoutingError(
            f"Unable to find location: '{query}'."
        )

    first = results[0]
    try:
        latitude = float(first["lat"])
        longitude = float(first["lon"])
    except (KeyError, TypeError, ValueError) as error:
        raise RoutingError(
            f"Unable to find location: '{query}'."
        ) from error

    return {
        "latitude": latitude,
        "longitude": longitude,
        "display_name": first.get("display_name", query),
    }


def fetch_osrm_routes(
    origin: dict,
    destination: dict,
) -> list[dict]:
    """
    Fetch up to 3 real driving route alternatives from FOSSGIS OSRM.

    Does not invent geometry, distance, or duration.
    """
    coordinate_string = (
        f"{origin['longitude']},{origin['latitude']};"
        f"{destination['longitude']},{destination['latitude']}"
    )

    url = (
        f"{OSRM_BASE_URL}/route/v1/"
        f"{OSRM_PROFILE}/{coordinate_string}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "alternatives": "true",
    }

    try:
        response = requests.get(
            url,
            params=params,
            headers=_headers(),
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
    except requests.Timeout as error:
        raise RoutingError(
            "Routing service timed out. Try again in a moment."
        ) from error
    except requests.RequestException as error:
        raise RoutingError(
            f"Unable to fetch driving routes: {error}"
        ) from error
    except ValueError as error:
        raise RoutingError(
            "Routing service returned invalid data."
        ) from error

    code = data.get("code")
    if code != "Ok":
        message = data.get("message") or code or "Unknown error"
        if code in {"NoRoute", "NoSegment"}:
            raise RoutingError(
                "No driving route found between these locations."
            )
        raise RoutingError(f"Routing failed: {message}")

    raw_routes = data.get("routes") or []
    if not raw_routes:
        raise RoutingError(
            "No driving route found between these locations."
        )

    converted = []
    for index, route in enumerate(raw_routes[:MAX_ALTERNATIVES]):
        geometry = route.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue

        distance_m = route.get("distance")
        duration_s = route.get("duration")
        if distance_m is None or duration_s is None:
            continue

        converted.append(
            {
                "route_id": f"osrm_{index + 1}",
                "distance_m": distance_m,
                "duration_s": duration_s,
                "geometry": {
                    "type": geometry.get("type", "LineString"),
                    "coordinates": coordinates,
                },
                "route_source": "osrm_openstreetmap",
            }
        )

    if not converted:
        raise RoutingError(
            "No driving route found between these locations."
        )

    return converted
