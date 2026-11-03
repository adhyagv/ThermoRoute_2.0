from datetime import datetime

from .fortyguard import FortyGuardClient
from .integration_status import record_sample_fallback
from backend.utils.cache import (
    get_cache,
    set_cache,
    build_climate_cache_key,
)


# ============================================================
# FORTYGUARD CLIENT
# ============================================================

client = FortyGuardClient()


def _round_coord(value):
    return round(float(value), 3)


def _first_numeric(values):
    if not isinstance(values, list) or not values:
        return None
    first = values[0]
    if isinstance(first, (int, float)):
        return first
    return None


# ============================================================
# GET ENVIRONMENTAL DATA FOR ROUTE SEGMENT
# ============================================================

def get_temperature_for_segment(
    latitude: float,
    longitude: float,
    fallback_temperature: float,
):
    """
    Get environmental information for one route segment.

    FortyGuard provides:
        - Temperature
        - Heat Index
        - Apparent Temperature
        - GHI
        - DNI
        - DHI

    If FortyGuard takes too long or fails,
    fallback values are returned so ThermoRoute
    can continue calculating the route.
    """

    now = datetime.now()

    start_date = now.strftime("%Y-%m-%d")
    start_time = now.strftime("%H:%M")

    cache_key = build_climate_cache_key(
        latitude=_round_coord(latitude),
        longitude=_round_coord(longitude),
        timestamp=start_date,
    )

    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        record_sample_fallback(cached.get("source") != "fortyguard")
        return cached

    try:

        # ----------------------------------------------------
        # SUBMIT ENVIRONMENTAL ANALYSIS
        # ----------------------------------------------------

        submitted = client.get_environmental_parameters(
            latitude=latitude,
            longitude=longitude,
            temperature=fallback_temperature,
            start_date=start_date,
            start_time=start_time,
            analysis=[
                "heat_index_celsius",
                "apparent_temperature_celsius",
            ],
        )

        print("FortyGuard submission:")
        print(submitted)

        # ----------------------------------------------------
        # EXTRACT ACTIVITY ID
        # ----------------------------------------------------

        activity_id = client.extract_activity_id(
            submitted
        )

        if not activity_id:
            raise RuntimeError(
                "FortyGuard did not return an activity ID."
            )

        print(
            f"FortyGuard activity started: "
            f"{activity_id}"
        )

        # ----------------------------------------------------
        # WAIT FOR COMPLETION
        # ----------------------------------------------------
        #
        # IMPORTANT:
        # Keep this short so route optimization
        # does not remain blocked for minutes.
        #

        completed = client.wait_for_activity(
            activity_id=activity_id,
            timeout_seconds=20,
            poll_seconds=5,
        )

        print("FortyGuard completed result:")
        print(completed)

        # ----------------------------------------------------
        # FIND LOCATION DATA
        # ----------------------------------------------------

        location = (
            completed
            .get("data", {})
            .get("result", {})
            .get("locations", [{}])[0]
        )

        if not isinstance(location, dict):
            location = {}

        # ----------------------------------------------------
        # ENVIRONMENT PARAMETERS
        # ----------------------------------------------------

        parameters = location.get(
            "parameters",
            {},
        )
        if not isinstance(parameters, dict):
            parameters = {}

        # ----------------------------------------------------
        # SOLAR DATA
        # ----------------------------------------------------

        solar = (
            location
            .get("solar_irradiance", {})
            .get("clear_sky", {})
        )
        if not isinstance(solar, dict):
            solar = {}

        # ----------------------------------------------------
        # TEMPERATURE
        # ----------------------------------------------------

        temperature = location.get("temperature")
        if not isinstance(temperature, (int, float)):
            temperature = fallback_temperature

        result = {
            "temperature": temperature,
            "source": "fortyguard",
            "activity_id": activity_id,
        }

        heat_index = _first_numeric(
            parameters.get("heat_index_celsius")
        )
        if heat_index is not None:
            result["heat_index"] = heat_index

        apparent_temperature = _first_numeric(
            parameters.get("apparent_temperature_celsius")
        )
        if apparent_temperature is not None:
            result["apparent_temperature"] = apparent_temperature

        for solar_key in ("ghi", "dni", "dhi"):
            solar_value = solar.get(solar_key)
            if isinstance(solar_value, (int, float)):
                result[solar_key] = solar_value

        set_cache(cache_key, result)
        record_sample_fallback(False)
        return result

    # ========================================================
    # FALLBACK
    # ========================================================

    except Exception as error:

        print(
            "FortyGuard environmental analysis failed:"
        )

        print(error)

        record_sample_fallback(True)
        return {
            "temperature": fallback_temperature,
            "source": "fallback",
        }
