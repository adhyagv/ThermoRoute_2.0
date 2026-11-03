from datetime import datetime, timezone
from pathlib import Path
import json

from pydantic import ValidationError

from ..models.climate_models import ClimateReading
from ..models.route_models import RoutePoint

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_fallback_climate_data(
    file_name: str = "fallback_climate.json",
) -> list[ClimateReading]:
    """
    Load fallback climate readings from a local JSON file.

    This is used when FortyGuard data is unavailable.

    Raises:
        FileNotFoundError: If the fallback file does not exist.
        ValueError: If the file is not a JSON list, or if any
            entry fails to validate against ClimateReading.
    """
    file_path = DATA_DIR / file_name
    if not file_path.exists():
        raise FileNotFoundError(
            f"Fallback climate file not found: {file_path}"
        )

    with file_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, list):
        raise ValueError("Fallback climate data must be a JSON list.")

    readings = []
    for index, item in enumerate(data):
        try:
            readings.append(ClimateReading.model_validate(item))
        except ValidationError as exc:
            raise ValueError(
                f"Invalid fallback climate reading at index {index}: {exc}"
            ) from exc

    return readings


def create_fallback_climate_reading(
    point: RoutePoint,
    temperature_c: float = 32.0,
    timestamp: datetime | None = None,
) -> ClimateReading:
    """
    Create a fallback climate reading for a specific coordinate.

    This is useful when a climate reading is temporarily unavailable
    for a route segment.
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    return ClimateReading(
        latitude=point.latitude,
        longitude=point.longitude,
        timestamp=timestamp,
        temperature_c=temperature_c,
        source="fallback",
        environmental_data={
            "is_fallback": True,
        },
    )


def get_fallback_reading_for_point(
    point: RoutePoint,
    temperature_c: float = 32.0,
    timestamp: datetime | None = None,
) -> ClimateReading:
    """
    Return a fallback climate reading for a route point.

    This provides a simple safe fallback when real environmental
    data cannot be retrieved.
    """
    return create_fallback_climate_reading(
        point=point,
        temperature_c=temperature_c,
        timestamp=timestamp,
    )