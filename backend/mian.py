import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from backend.version import APP_VERSION
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .models.climate_models import ClimateReading
from .models.route_models import RoutePoint, Route
from .services.segmentation import create_route_segments
from .services.routing import build_route
from .services.climate_features import build_route_climate_features
from .utils.geo import calculate_distance_m
from .utils.validation import validate_route


app = FastAPI(
    title="ThermoRoute",
    description=(
        "Climate-aware route analysis backend for ThermoRoute."
    ),
    version=APP_VERSION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

SAMPLE_ROUTES_FILE = DATA_DIR / "sample_routes.json"
SAMPLE_CLIMATE_FILE = DATA_DIR / "sample_climate.json"


def load_json_file(file_path: Path):
    """
    Load JSON data from a local file.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the JSON is malformed.
    """

    if not file_path.exists():
        raise FileNotFoundError(
            f"Data file not found: {file_path}"
        )

    with file_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        try:
            return json.load(file)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Malformed JSON in {file_path}: {exc}"
            ) from exc


def build_demo_route(route_data: dict) -> Route:
    """
    Convert one sample route into a ThermoRoute Route
    with segmented route data.
    """

    points = [
        RoutePoint(
            latitude=point["latitude"],
            longitude=point["longitude"],
        )
        for point in route_data["points"]
    ]

    if len(points) < 2:
        raise ValueError(
            "A route must contain at least two points."
        )

    # Calculate distance for every consecutive point.
    segment_distances = []

    for index in range(len(points) - 1):
        distance = calculate_distance_m(
            points[index],
            points[index + 1],
        )

        segment_distances.append(distance)

    total_geometry_distance = sum(
        segment_distances
    )

    if total_geometry_distance <= 0:
        raise ValueError(
            "Route geometry has zero total distance."
        )

    # Allocate total route travel time
    # proportionally across the segments.
    total_time = route_data["estimated_time_s"]

    if total_time <= 0:
        raise ValueError(
            "Route travel time must be greater than zero."
        )

    segment_times = []

    for distance in segment_distances:
        segment_time = (
            distance
            / total_geometry_distance
            * total_time
        )

        segment_times.append(segment_time)

    segments = create_route_segments(
        points=points,
        distances=segment_distances,
        times=segment_times,
    )

    route = build_route(
        route_id=route_data["route_id"],
        points=points,
        distance_m=route_data["distance_m"],
        estimated_time_s=route_data["estimated_time_s"],
    )

    # Add generated segments to the Route model.
    route = route.model_copy(
        update={
            "segments": segments,
        }
    )

    validate_route(route)

    return route


def get_climate_readings_for_route(
    route_id: str,
    climate_data: list[dict],
) -> list[dict]:
    """
    Return climate readings belonging to one route.
    """

    return [
        reading
        for reading in climate_data
        if reading.get("route_id") == route_id
    ]


@app.get("/")
def root():
    """
    Basic API health check.
    """

    return {
        "name": "ThermoRoute",
        "status": "running",
        "mode": "demo",
        "climate_source": "sample_demo",
    }


@app.get("/health")
def health_check():
    """
    Backend health check.
    """

    return {
        "status": "healthy",
        "fortyguard": "not_connected",
        "mode": "demo",
    }


@app.get("/demo/routes")
def get_demo_routes():
    """
    Return the real OSRM-generated route alternatives
    used by the demo.
    """

    try:
        routes = load_json_file(
            SAMPLE_ROUTES_FILE
        )

    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

    return {
        "source": "osrm_openstreetmap",
        "route_count": len(routes),
        "routes": routes,
    }


@app.get("/demo/analyze/{route_id}")
def analyze_demo_route(
    route_id: str,
):
    """
    Run ThermoRoute climate analysis on one demo route.
    """

    # Load demo data.
    try:
        routes = load_json_file(
            SAMPLE_ROUTES_FILE
        )

        climate_data = load_json_file(
            SAMPLE_CLIMATE_FILE
        )

    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

    # Find requested route.
    route_data = next(
        (
            route
            for route in routes
            if route.get("route_id") == route_id
        ),
        None,
    )

    if route_data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Route '{route_id}' not found.",
        )

    # Build and validate route.
    try:
        route = build_demo_route(
            route_data
        )

    except (ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Route '{route_id}' could not "
                f"be processed: {exc}"
            ),
        ) from exc

    # Get climate readings for this route.
    route_climate_data = (
        get_climate_readings_for_route(
            route_id=route_id,
            climate_data=climate_data,
        )
    )

    if len(route_climate_data) != len(route.segments):
        raise HTTPException(
            status_code=500,
            detail=(
                "Climate reading count does not match "
                "route segment count."
            ),
        )

    # Validate climate readings using the Pydantic model.
    try:
        readings = [
            ClimateReading.model_validate(
                reading
            )
            for reading in route_climate_data
        ]

    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Invalid climate reading data: {exc}"
            ),
        ) from exc

    # Build the climate intelligence features.
    climate_features = (
        build_route_climate_features(
            segments=route.segments,
            readings=readings,
            baseline_c=30.0,
            anomaly_threshold_c=3.0,
            extreme_threshold_c=40.0,
            zscore_threshold=2.0,
        )
    )

    return {
        "status": "success",
        "mode": "demo",
        "route": route.model_dump(
            mode="json"
        ),
        "climate_source": "sample_demo",
        "climate_features": climate_features,
    }