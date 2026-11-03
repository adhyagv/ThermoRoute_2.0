import json
import time
from pathlib import Path

import httpx


# OpenStreetMap/FOSSGIS OSRM foot-routing server
OSRM_BASE_URL = "https://routing.openstreetmap.de/routed-foot"

PROFILE = "foot"

# Save generated routes into backend/data/
OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "sample_routes.json"
)

# Same start and destination for all routes.
# The different waypoints make the routing engine produce
# different real walking paths between the same endpoints.
ORIGIN = (-112.0740, 33.4484)
DESTINATION = (-112.0600, 33.4650)

# Optional intermediate waypoints.
# Each route is still calculated by OSRM using real
# OpenStreetMap road/path data.
ROUTE_REQUESTS = [
    {
        "route_id": "route_a",
        "waypoints": [],
    },
    {
        "route_id": "route_b",
        "waypoints": [
            (-112.0780, 33.4550),
        ],
    },
    {
        "route_id": "route_c",
        "waypoints": [
            (-112.0680, 33.4560),
        ],
    },
]


def fetch_osrm_route(
    coordinates: list[tuple[float, float]],
) -> dict:
    """
    Fetch a real walking route from the OSRM server.

    Coordinates must be supplied as:
        (longitude, latitude)

    OSRM returns geometry as GeoJSON [longitude, latitude].
    """

    coordinate_string = ";".join(
        f"{longitude},{latitude}"
        for longitude, latitude in coordinates
    )

    url = (
        f"{OSRM_BASE_URL}/route/v1/"
        f"{PROFILE}/{coordinate_string}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "alternatives": "false",
    }

    headers = {
        "User-Agent": "ThermoRoute-Hackathon-Demo/1.0"
    }

    response = httpx.get(
        url,
        params=params,
        headers=headers,
        timeout=20.0,
    )

    response.raise_for_status()

    data = response.json()

    if data.get("code") != "Ok":
        raise RuntimeError(
            f"OSRM returned {data.get('code')}: "
            f"{data.get('message', 'Unknown error')}"
        )

    if not data.get("routes"):
        raise RuntimeError(
            "OSRM returned no routes."
        )

    return data


def convert_to_thermoroute_schema(
    route_id: str,
    osrm_response: dict,
) -> dict:
    """
    Convert OSRM route data into ThermoRoute's
    sample_routes.json format.
    """

    route = osrm_response["routes"][0]

    coordinates = route["geometry"]["coordinates"]

    if len(coordinates) < 2:
        raise RuntimeError(
            f"{route_id}: OSRM returned insufficient "
            "route geometry."
        )

    # OSRM/GeoJSON:
    # [longitude, latitude]
    #
    # ThermoRoute:
    # latitude / longitude
    points = [
        {
            "latitude": latitude,
            "longitude": longitude,
        }
        for longitude, latitude in coordinates
    ]

    return {
        "route_id": route_id,
        "origin": points[0],
        "destination": points[-1],
        "distance_m": route["distance"],
        "estimated_time_s": route["duration"],
        "points": points,
        "source": "osrm_openstreetmap",
        "routing_profile": "foot",
    }


def main() -> None:
    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    generated_routes = []

    for index, request in enumerate(ROUTE_REQUESTS):

        route_id = request["route_id"]

        coordinates = [
            ORIGIN,
            *request["waypoints"],
            DESTINATION,
        ]

        print(
            f"Fetching {route_id} "
            f"from real OSRM walking network..."
        )

        try:
            osrm_response = fetch_osrm_route(
                coordinates=coordinates,
            )

            route = convert_to_thermoroute_schema(
                route_id=route_id,
                osrm_response=osrm_response,
            )

            generated_routes.append(route)

            print(
                f"  Distance: "
                f"{route['distance_m']:.0f} m"
            )

            print(
                f"  Travel time: "
                f"{route['estimated_time_s']:.0f} s"
            )

            print(
                f"  Route points: "
                f"{len(route['points'])}"
            )

        except Exception as exc:
            print(
                f"  ERROR generating {route_id}: {exc}"
            )

        # Respect the public server's usage policy.
        if index < len(ROUTE_REQUESTS) - 1:
            time.sleep(1.1)

    if not generated_routes:
        raise RuntimeError(
            "No routes were generated."
        )

    with OUTPUT_PATH.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            generated_routes,
            file,
            indent=2,
        )

    print()
    print(
        f"Successfully generated "
        f"{len(generated_routes)} route(s)."
    )

    print(
        f"Saved to: {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()