from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .climate_models import ClimateReading


class RoutePoint(BaseModel):
    """
    Represents a geographic point along a route.
    """

    model_config = ConfigDict(
        extra="ignore",
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


class RouteSegment(BaseModel):
    """
    Represents one segment of a route,
    optionally enriched with climate data.
    """

    model_config = ConfigDict(
        extra="ignore",
    )

    segment_id: str = Field(
        min_length=1,
        description="Unique identifier for the route segment.",
    )

    origin: RoutePoint = Field(
        description="Starting geographic point of the segment.",
    )

    destination: RoutePoint = Field(
        description="Ending geographic point of the segment.",
    )

    distance_m: float = Field(
        ge=0.0,
        description="Segment distance in meters.",
    )

    estimated_time_s: float = Field(
        ge=0.0,
        description="Estimated travel time for the segment in seconds.",
    )

    climate: Optional[ClimateReading] = Field(
        default=None,
        description="Associated climate reading for this segment.",
    )

    @model_validator(mode="after")
    def validate_segment_points(self):
        if (
            self.origin.latitude == self.destination.latitude
            and self.origin.longitude == self.destination.longitude
        ):
            raise ValueError(
                "Segment origin and destination cannot be identical."
            )

        return self


class Route(BaseModel):
    """
    Represents a complete route from origin to destination.
    """

    model_config = ConfigDict(
        extra="ignore",
    )

    route_id: str = Field(
        min_length=1,
        description="Unique identifier for the route.",
    )

    origin: RoutePoint = Field(
        description="Route origin.",
    )

    destination: RoutePoint = Field(
        description="Route destination.",
    )

    distance_m: float = Field(
        ge=0.0,
        description="Total route distance in meters.",
    )

    estimated_time_s: float = Field(
        ge=0.0,
        description="Estimated total travel time in seconds.",
    )

    segments: list[RouteSegment] = Field(
        default_factory=list,
        description="Route segments making up the complete route.",
    )