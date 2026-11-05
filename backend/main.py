import hmac
import logging
import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal

from backend.version import APP_VERSION
from backend.services.integration_status import get_fortyguard_status


from backend.services.optimizer import optimize_journey
from backend.services.civic_store import (
    check_database_connection,
    create_report,
    delete_report,
    list_reports,
    storage_kind,
    summarize_reports,
    update_report_status,
)
from backend.services.route_intelligence import analyze_route

from backend.services.routing import (
    build_route_scenarios,
    create_demo_routes,
)

from backend.services.osrm import RoutingError

from backend.services.fortyguard import (
    FortyGuardClient,
    FortyGuardError,
)


# =========================================================
# APP
# =========================================================

app = FastAPI(
    title="ThermoRoute API",
    description=(
        "ThermoRoute decision-support API: OpenStreetMap-based routes, "
        "Open-Meteo and CAMS model forecasts, estimated shade from mapped "
        "OSM features, rule-based route exposure analysis, and local civic reports. "
        "FortyGuard is an optional integration, not the sole data provider."
    ),
    version=APP_VERSION,
)


# =========================================================
# CORS
# =========================================================

logger = logging.getLogger(__name__)
_default_cors_origins = "http://localhost:5173,http://127.0.0.1:5173"
_cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", _default_cors_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
# =========================================================
# FORTYGUARD
# =========================================================

fortyguard = FortyGuardClient()


# =========================================================
# REQUEST MODELS
# =========================================================

class JourneyRequest(BaseModel):
    from_location: str = Field(min_length=1, max_length=200)
    destination: str = Field(min_length=1, max_length=200)
    departure_time: str = Field(min_length=1, max_length=40)
    max_extra_time_percent: float = Field(default=20, ge=0, le=200)
    thermal_exposure_budget: float = Field(default=50, ge=0, le=100)


class HeatRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    temperature: float = Field(ge=-100, le=100)
    date: str = Field(min_length=10, max_length=10)
    start_time: str = Field(default="14:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class CivicReportRequest(BaseModel):
    category: Literal[
        "too_hot", "no_shade", "waterlogged", "broken_signal",
        "poor_air_quality", "damaged_pedestrian_infrastructure",
        "unsafe_crossing", "other"
    ]
    note: str = Field(default="", max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    anonymous: bool = True


class CivicReportResponse(BaseModel):
    id: int
    category: str
    note: str
    latitude: float
    longitude: float
    created_at: str
    status: Literal["unverified", "reviewed", "resolved"]
    anonymous: bool


class CivicReportListResponse(BaseModel):
    status: Literal["success"]
    count: int
    reports: list[CivicReportResponse]
    storage: Literal["sqlite", "postgresql"]


class CivicReportCreateResponse(BaseModel):
    status: Literal["success"]
    message: str
    report: CivicReportResponse
    storage: Literal["sqlite", "postgresql"]


class CivicReportStatusRequest(BaseModel):
    status: Literal["unverified", "reviewed", "resolved"]


class RouteCoordinate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RouteAlternativeRequest(BaseModel):
    route_id: str = Field(min_length=1, max_length=80)
    route_geometry: list[RouteCoordinate] = Field(min_length=2, max_length=1500)
    distance_m: float = Field(ge=0, le=10000000)
    duration_seconds: float = Field(ge=0, le=86400)
    turn_count: int = Field(default=0, ge=0, le=10000)


class RouteIntelligenceRequest(BaseModel):
    route_geometry: list[RouteCoordinate] = Field(min_length=2, max_length=1500)
    distance_m: float | None = Field(default=None, ge=0, le=10000000)
    duration_seconds: float = Field(ge=0, le=86400)
    turn_count: int = Field(default=0, ge=0, le=10000)
    route_id: str = Field(default="selected", min_length=1, max_length=80)
    route_options: list[RouteAlternativeRequest] = Field(default_factory=list, max_length=2)
    mode: Literal["driving", "cycling", "walking"] = "driving"
    departure_at: str | None = None
    profile: Literal["adult", "elderly", "child", "asthma", "outdoor_worker", "cyclist", "pedestrian"] = "adult"
    strategy: Literal["fastest", "shortest", "coolest", "cleanest", "balanced"] = "balanced"
    environmental_weight: float = Field(default=0.5, ge=0, le=1)
    max_extra_time_minutes: float = Field(default=10, ge=0, le=180)
    search_window_hours: int = Field(default=6, ge=1, le=12)
    sample_spacing_m: float = Field(default=400, ge=100, le=2000)


_civic_submission_times: dict[str, deque[float]] = defaultdict(deque)
_civic_rate_lock = threading.Lock()


def _check_civic_rate_limit(client_key: str) -> None:
    now = time.monotonic()
    with _civic_rate_lock:
        recent = _civic_submission_times[client_key]
        while recent and now - recent[0] >= 3600:
            recent.popleft()
        if len(recent) >= 10:
            raise HTTPException(status_code=429, detail="Submission limit reached. Try again later.")
        recent.append(now)


def _require_civic_admin(request: Request) -> None:
    expected_token = os.getenv("CIVIC_ADMIN_TOKEN", "")
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="Civic moderation is not configured on this server.",
        )

    scheme, separator, supplied_token = request.headers.get("authorization", "").partition(" ")
    if (
        scheme.lower() != "bearer"
        or not separator
        or not hmac.compare_digest(supplied_token, expected_token)
    ):
        raise HTTPException(
            status_code=401,
            detail="A valid civic moderator token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _ensure_persistent_civic_database() -> None:
    if os.getenv("APP_ENV", "").lower() == "production" and storage_kind() != "postgresql":
        raise HTTPException(
            status_code=503,
            detail="Production civic reporting requires a persistent PostgreSQL database.",
        )


def _utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# =========================================================
# HOME
# =========================================================

@app.get("/")
def home():
    return {
        "message": "ThermoRoute API is running",
        "status": "success",
        "version": APP_VERSION,
        "integrations": {
            "fortyguard": get_fortyguard_status(),
        },
        "routing": "OSRM-compatible road-network routing (OpenStreetMap); no live traffic",
    }


# =========================================================
# HEALTH
# =========================================================

@app.get("/api/health")
def health():
    try:
        _ensure_persistent_civic_database()
        check_database_connection()
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Civic database health check failed.")
        raise HTTPException(status_code=503, detail="Civic database is unavailable.") from error

    integration = get_fortyguard_status()
    return {
        "status": "healthy",
        "service": "ThermoRoute API",
        "version": APP_VERSION,
        "integrations": {
            "fortyguard": integration,
        },
        "data_status": (
            "fallback"
            if integration["last_sample_used_fallback"] is True
            else "not_yet_sampled"
            if integration["last_sample_used_fallback"] is None
            else "fortyguard"
        ),
        "note": "Reachability reports the last real API request; health checks do not send a third-party probe.",
    }


# =========================================================
# FORTYGUARD ENVIRONMENT
# =========================================================

@app.post("/api/fortyguard/environment")
def environmental_parameters(request: HeatRequest):

    try:

        result = fortyguard.get_environmental_parameters(
            latitude=request.latitude,
            longitude=request.longitude,
            temperature=request.temperature,
            start_date=request.date,
            start_time=request.start_time,
            analysis=[
                "heat_index_celsius",
                "apparent_temperature_celsius",
                "relative_humidity_percent",
            ],
        )

        return {
            "status": "success",
            "data": result,
        }

    except FortyGuardError as error:
        logger.warning("FortyGuard environmental request failed.")
        raise HTTPException(status_code=502, detail="Environmental provider is unavailable.") from error

    except Exception as error:
        logger.exception("Unexpected error while requesting FortyGuard environmental data.")
        raise HTTPException(status_code=502, detail="Environmental data could not be retrieved.") from error


# =========================================================
# FORTYGUARD STATUS
# =========================================================

@app.get("/api/fortyguard/status/{activity_id}")
def fortyguard_status(activity_id: str):

    try:

        result = fortyguard.get_status(
            activity_id
        )

        return {
            "status": "success",
            "data": result,
        }

    except FortyGuardError as error:
        logger.warning("FortyGuard status request failed.")
        raise HTTPException(status_code=502, detail="Environmental provider is unavailable.") from error

    except Exception as error:
        logger.exception("Unexpected error while requesting FortyGuard activity status.")
        raise HTTPException(status_code=502, detail="Activity status could not be retrieved.") from error


# =========================================================
# ROUTE OPTIMIZATION
# =========================================================

@app.post("/api/optimize")
def optimize_route(request: JourneyRequest):
    try:
        logger.info("Starting route optimization.")
        scenarios = build_route_scenarios(
            from_location=request.from_location,
            destination=request.destination,
            departure_time=request.departure_time,
        )
        if not scenarios:
            raise HTTPException(status_code=502, detail="No routes are currently available.")

        fastest_time = min(
            scenario.get(
                "travel_time_min",
                0,
            )
            for scenario in scenarios
        )
        result = optimize_journey(
            scenarios=scenarios,
            fastest_time=fastest_time,
            max_extra_time_percent=(
                request.max_extra_time_percent
            ),
            thermal_exposure_budget=(
                request.thermal_exposure_budget
            ),
        )

        response = {
            "status": "success",

            "from": request.from_location,

            "destination": request.destination,

            "departure_time": request.departure_time,

            "max_extra_time_percent": (
                request.max_extra_time_percent
            ),

            "thermal_exposure_budget": (
                request.thermal_exposure_budget
            ),

            "fastest_time": fastest_time,

            "routes_evaluated": len(scenarios),

            "recommendation": result,

            "all_routes": result.get("all_routes", []),
        }

        logger.info("Route optimization completed.")
        return response

    except HTTPException:
        raise
    except RoutingError as error:
        logger.warning("Route optimization failed.")
        raise HTTPException(
            status_code=502,
            detail="Route optimization is temporarily unavailable.",
        ) from error

    except Exception as error:
        logger.exception("Unexpected error during route optimization.")
        raise HTTPException(status_code=500, detail="Route optimization could not be completed.") from error


# =========================================================
# CIVIC REPORTS
# =========================================================

@app.get("/api/civic/reports", response_model=CivicReportListResponse)
def civic_reports(
    limit: int = Query(default=100, ge=1, le=500),
    category: str | None = None,
    status: Literal["unverified", "reviewed", "resolved"] | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
):
    _ensure_persistent_civic_database()
    if category and category not in {
        "too_hot", "no_shade", "waterlogged", "broken_signal",
        "poor_air_quality", "damaged_pedestrian_infrastructure",
        "unsafe_crossing", "other",
    }:
        raise HTTPException(status_code=422, detail="Unsupported civic report category.")
    if from_date and to_date and _utc_datetime(from_date) > _utc_datetime(to_date):
        raise HTTPException(status_code=422, detail="from_date must not be later than to_date.")
    try:
        reports = list_reports(limit=limit, category=category, status=status, from_date=from_date, to_date=to_date)
        return {
            "status": "success",
            "count": len(reports),
            "reports": reports,
            "storage": storage_kind(),
        }
    except Exception as error:
        logger.exception("Could not read civic reports.")
        raise HTTPException(status_code=500, detail="Could not read civic reports.") from error


@app.post("/api/civic/reports", status_code=201, response_model=CivicReportCreateResponse)
def submit_civic_report(report_request: CivicReportRequest, request: Request):
    _ensure_persistent_civic_database()
    _check_civic_rate_limit(request.client.host if request.client else "unknown")
    note = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", report_request.note).strip()
    try:
        report = create_report(
            category=report_request.category,
            note=note,
            latitude=report_request.latitude,
            longitude=report_request.longitude,
            anonymous=report_request.anonymous,
        )
        return {
            "status": "success",
            "message": "Civic report saved.",
            "report": report,
            "storage": storage_kind(),
        }
    except Exception as error:
        logger.exception("Could not save civic report.")
        raise HTTPException(status_code=500, detail="Could not save civic report.") from error


@app.patch("/api/civic/reports/{report_id}", response_model=CivicReportResponse)
def change_civic_report_status(
    report_id: int,
    status_request: CivicReportStatusRequest,
    request: Request,
):
    _ensure_persistent_civic_database()
    _require_civic_admin(request)
    try:
        report = update_report_status(report_id, status_request.status)
        if report is None:
            raise HTTPException(status_code=404, detail="Civic report not found.")
        return report
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not update civic report status.")
        raise HTTPException(status_code=500, detail="Could not update civic report status.") from error


@app.delete("/api/civic/reports/{report_id}", status_code=204)
def remove_civic_report(report_id: int, request: Request):
    _ensure_persistent_civic_database()
    _require_civic_admin(request)
    try:
        if not delete_report(report_id):
            raise HTTPException(status_code=404, detail="Civic report not found.")
        return None
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not delete civic report.")
        raise HTTPException(status_code=500, detail="Could not delete civic report.") from error


@app.get("/api/civic/hotspots")
def civic_hotspots(days: int = Query(default=30, ge=1, le=90)):
    _ensure_persistent_civic_database()
    try:
        return summarize_reports(days=days)
    except Exception as error:
        logger.exception("Could not summarize civic reports.")
        raise HTTPException(status_code=500, detail="Could not summarize civic reports.") from error


# =========================================================
# ROUTE-WIDE ENVIRONMENTAL INTELLIGENCE
# =========================================================

@app.post("/api/route-intelligence/analyze")
def route_wide_intelligence(request: RouteIntelligenceRequest):
    try:
        geometry = [(point.latitude, point.longitude) for point in request.route_geometry]
        return analyze_route(
            geometry=geometry,
            duration_seconds=request.duration_seconds,
            mode=request.mode,
            departure_at=request.departure_at,
            profile=request.profile,
            route_id=request.route_id,
            distance_m=request.distance_m,
            turn_count=request.turn_count,
            route_options=[
                {
                    "route_id": option.route_id,
                    "geometry": [(point.latitude, point.longitude) for point in option.route_geometry],
                    "distance_m": option.distance_m,
                    "duration_seconds": option.duration_seconds,
                    "turn_count": option.turn_count,
                }
                for option in request.route_options
            ],
            strategy=request.strategy,
            environmental_weight=request.environmental_weight,
            max_extra_time_minutes=request.max_extra_time_minutes,
            search_window_hours=request.search_window_hours,
            sample_spacing_m=request.sample_spacing_m,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Route analysis request is invalid.") from error
    except Exception as error:
        logger.exception("Could not complete route intelligence analysis.")
        raise HTTPException(status_code=502, detail="Route analysis could not be completed.") from error


# =========================================================
# TEST ROUTES
# =========================================================

@app.get("/api/routes")
def get_test_routes():

    try:

        routes = create_demo_routes(
            origin="Phoenix, Arizona",
            destination="Tempe, Arizona",
            departure_time="10:00",
        )

        return {
            "status": "demo",
            "data_status": "demo",
            "note": "Synthetic sample routes for development only; not live Bengaluru route data.",
            "origin": "Phoenix, Arizona",
            "destination": "Tempe, Arizona",
            "routes": routes,
        }

    except Exception as error:
        logger.exception("Could not create demo routes.")
        raise HTTPException(status_code=500, detail="Demo routes could not be created.") from error