from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .climate_models import ClimateReading
from .route_models import Route, RoutePoint


class RouteAnalysisRequest(BaseModel):
    """
    Incoming request to analyze environmental conditions
    for a trip.
    """

    model_config = ConfigDict(
        extra="ignore",
    )

    origin: RoutePoint = Field(
        description="Starting point of the route.",
    )

    destination: RoutePoint = Field(
        description="Destination point of the route.",
    )

    departure_time: Optional[datetime] = Field(
        default=None,
        description="Requested departure time.",
    )

    @model_validator(mode="after")
    def validate_endpoints(self) -> "RouteAnalysisRequest":
        if (
            self.origin.latitude == self.destination.latitude
            and self.origin.longitude == self.destination.longitude
        ):
            raise ValueError(
                "Origin and destination coordinates cannot be identical."
            )

        return self


class RouteAnalysisResponse(BaseModel):
    """
    Aggregated climate information returned by ThermoRoute.
    """

    model_config = ConfigDict(
        extra="ignore",
    )

    status: str = Field(
        default="success",
        description="Status of the route analysis.",
    )

    route: Route = Field(
        description="Processed route information.",
    )

    climate_readings: list[ClimateReading] = Field(
        default_factory=list,
        description="Environmental readings used for the analysis.",
    )

    message: Optional[str] = Field(
        default=None,
        description="Additional information about the analysis.",
    )