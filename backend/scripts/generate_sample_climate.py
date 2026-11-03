import json
from datetime import datetime, timezone
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent

ROUTES_PATH = BASE_DIR / "data" / "sample_routes.json"
OUTPUT_PATH = BASE_DIR / "data" / "sample_climate.json"


# Demo departure time.
# This is SAMPLE data, not FortyGuard data.
DEMO_TIMESTAMP = datetime(
    2026,
    8,
    15,
    18,
    0,
    tzinfo=timezone.utc,
)


def calculate_demo_temperature(
    route_id: str,
    segment_index: int,
    segment_count: int,
) -> float:
    """
    Generate representative synthetic temperature data
    for the ThermoRoute pre-FortyGuard demo.

    These values are NOT real FortyGuard measurements.
    They are intentionally varied by route so that the
    climate pipeline has meaningful data to process.
    """

    # Route-specific base temperatures.
    #
    # These are deliberately synthetic demo values.
    route_base_temperatures = {
        "route_a": 39.0,
        "route_b": 34.0,
        "route_c": 36.5,
    }

    base_temperature = route_base_temperatures.get(
        route_id,
        36.0,
    )

    # Small spatial variation along the route.
    if segment_count > 1:
        position = segment_index / (segment_count - 1)
    else:
        position = 0.0

    variation = (
        1.5 * position
        - 0.5 * (1.0 - position)
    )

    temperature = base_temperature + variation

    return round(temperature, 2)


def main() -> None:
    if not ROUTES_PATH.exists():
        raise FileNotFoundError(
            f"Route file not found: {ROUTES_PATH}"
        )

    with ROUTES_PATH.open(
        "r",
        encoding="utf-8",
    ) as file:
        routes = json.load(file)

    if not isinstance(routes, list):
        raise ValueError(
            "sample_routes.json must contain a JSON list."
        )

    climate_readings = []

    for route in routes:
        route_id = route["route_id"]
        points = route["points"]

        if len(points) < 2:
            raise ValueError(
                f"{route_id} must contain at least "
                "two route points."
            )

        segment_count = len(points) - 1

        for index in range(segment_count):
            origin = points[index]
            destination = points[index + 1]

            midpoint_latitude = (
                origin["latitude"]
                + destination["latitude"]
            ) / 2.0

            midpoint_longitude = (
                origin["longitude"]
                + destination["longitude"]
            ) / 2.0

            temperature = calculate_demo_temperature(
                route_id=route_id,
                segment_index=index,
                segment_count=segment_count,
            )

            climate_readings.append(
                {
                    "route_id": route_id,
                    "segment_id": (
                        f"{route_id}_segment_{index + 1}"
                    ),
                    "latitude": round(
                        midpoint_latitude,
                        7,
                    ),
                    "longitude": round(
                        midpoint_longitude,
                        7,
                    ),
                    "timestamp": (
                        DEMO_TIMESTAMP.isoformat()
                    ),
                    "temperature_c": temperature,
                    "source": "sample_demo",
                    "environmental_data": {
                        "is_sample": True,
                        "data_note": (
                            "Synthetic demonstration data. "
                            "Not FortyGuard measurements."
                        ),
                    },
                }
            )

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with OUTPUT_PATH.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            climate_readings,
            file,
            indent=2,
        )

    print(
        f"Successfully generated "
        f"{len(climate_readings)} climate readings."
    )

    print(
        f"Saved to: {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()