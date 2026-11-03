from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class ClimateReading(BaseModel):
    """
    Normalized environmental reading used internally by ThermoRoute.
    """

    model_config = ConfigDict(
        extra="ignore",
        str_strip_whitespace=True,
    )

    latitude: float = Field(
        ge=-90.0,
        le=90.0,
        description="Latitude in decimal degrees.",
    )

    longitude: float = Field(
        ge=-180.0,
        le=180.0,
        description="Longitude in decimal degrees.",
    )

    timestamp: datetime = Field(
        description="Timestamp of the environmental reading.",
    )

    temperature_c: float = Field(
        ge=-273.15,
        description="Temperature in degrees Celsius.",
    )

    source: str = Field(
        default="unknown",
        min_length=1,
        description="Source of the environmental data.",
    )

    environmental_data: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional environmental measurements.",
    )