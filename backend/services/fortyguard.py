import os
import time
import requests
from dotenv import load_dotenv

from .integration_status import record_request_result, set_configured


# =========================================================
# LOAD ENVIRONMENT
# =========================================================

load_dotenv()

BASE_URL = "https://api.fortyguard.com/v1"

API_KEY = os.getenv("FORTYGUARD_API_KEY")

# Keep the API optional at startup. Route optimization can still run in
# fallback mode when a user has not configured a FortyGuard key yet.


# =========================================================
# ERROR
# =========================================================

class FortyGuardError(Exception):
    pass


# =========================================================
# FORTYGUARD CLIENT
# =========================================================

class FortyGuardClient:

    def __init__(self):
        self.api_key = API_KEY
        self.headers = {"Content-Type": "application/json"}
        if self.api_key:
            self.headers["api-key"] = self.api_key
        set_configured(bool(self.api_key))

    # =====================================================
    # COMMON POST
    # =====================================================

    def _post(self, endpoint, payload):

        if not self.api_key:
            message = (
                "FORTYGUARD_API_KEY is not configured. "
                "Add it to the project-root .env file to enable live environmental sampling."
            )
            set_configured(False)
            raise FortyGuardError(message)

        try:
            response = requests.post(
                f"{BASE_URL}/{endpoint}",
                headers=self.headers,
                json=payload,
                timeout=60,
            )

        except requests.RequestException as error:
            record_request_result(False, str(error))
            raise FortyGuardError(
                f"Unable to connect to FortyGuard: {error}"
            )

        if not response.ok:
            message = f"FortyGuard {endpoint} failed: {response.status_code} - {response.text}"
            set_configured(False)
            raise FortyGuardError(message)

        record_request_result(True)
        try:
            return response.json()

        except ValueError:
            raise FortyGuardError(
                f"FortyGuard returned invalid JSON: "
                f"{response.text}"
            )

    # =====================================================
    # COMMON GET
    # =====================================================

    def _get(self, endpoint):
        if not self.api_key:
            message = "FORTYGUARD_API_KEY is not configured."
            record_request_result(False, message)
            raise FortyGuardError(message)

        try:
            response = requests.get(
                f"{BASE_URL}/{endpoint}",
                headers=self.headers,
                timeout=60,
            )

        except requests.RequestException as error:
            record_request_result(False, str(error))
            raise FortyGuardError(
                f"Unable to connect to FortyGuard: {error}"
            )

        if not response.ok:
            message = f"FortyGuard request failed: {response.status_code} - {response.text}"
            record_request_result(False, message)
            raise FortyGuardError(message)

        record_request_result(True)
        try:
            return response.json()

        except ValueError:
            raise FortyGuardError(
                f"FortyGuard returned invalid JSON: "
                f"{response.text}"
            )

    # =====================================================
    # HEATMAP
    # =====================================================

    def create_heatmap(
        self,
        polygon_aoi,
        start_date,
        start_time,
        granularity=100,
        analytic_type="tcm",
        threshold=30,
        direction="above",
    ):

        payload = {
            "polygon_aoi": polygon_aoi,

            "date_time": {
                "start_date": start_date,
                "start_time": start_time,
                "filter_type": 1,
            },

            "granularity": granularity,

            "analytic_type": analytic_type,
        }

        if analytic_type in [
            "exceedance",
            "persistence",
        ]:
            payload["threshold"] = threshold
            payload["direction"] = direction

        return self._post(
            "heatmap",
            payload
        )

    # =====================================================
    # ENVIRONMENTAL PARAMETERS
    # =====================================================

    def get_environmental_parameters(
        self,
        latitude,
        longitude,
        temperature,
        start_date,
        start_time,
        analysis=None,
    ):

        payload = {
            "latitude": latitude,
            "longitude": longitude,
            "temperature": temperature,

            "date_time": {
                "start_date": start_date,
                "start_time": start_time,
                "filter_type": 1,
            },
        }

        if analysis:
            payload["analysis"] = analysis

        return self._post(
            "env_params",
            payload
        )

    # =====================================================
    # HEAT INTELLIGENCE
    # =====================================================

    def heat_intelligence(
        self,
        latitude,
        longitude,
        temperature,
        date,
        analysis=None,
    ):

        payload = {
            "latitude": latitude,
            "longitude": longitude,
            "temperature": temperature,
            "date": date,
        }

        if analysis:
            payload["analysis"] = analysis

        return self._post(
            "heat_intelligence",
            payload
        )

    # =====================================================
    # SATELLITE
    # =====================================================

    def satellite(
        self,
        latitude,
        longitude,
        start_date,
        start_time,
        granularity=80,
    ):

        payload = {
            "sat": {
                "latitude": latitude,
                "longitude": longitude,
            },

            "date_time": {
                "start_date": start_date,
                "start_time": start_time,
                "filter_type": 1,
            },

            "granularity": granularity,
        }

        return self._post(
            "satellite",
            payload
        )

    # =====================================================
    # STREET VIEW
    # =====================================================

    def streetview(
        self,
        latitude,
        longitude,
        vertical_angle=10.0,
        horizontal_angle=90.0,
        back_view=False,
    ):

        payload = {
            "latitude": latitude,
            "longitude": longitude,
            "vertical_angle": vertical_angle,
            "horizontal_angle": horizontal_angle,
            "back_view": back_view,
        }

        return self._post(
            "streetview",
            payload
        )

    # =====================================================
    # ACTIVITY STATUS
    # =====================================================

    def get_status(self, activity_id):

        return self._get(
            f"status/{activity_id}"
        )

    # =====================================================
    # EXTRACT ACTIVITY ID
    # =====================================================

    def extract_activity_id(self, response):
        """
        Extract activity_id from FortyGuard responses.

        Handles:
        1. Direct activity_id
        2. activity_id inside data
        3. Nested dictionaries
        """

        if not response:
            return None

        # -------------------------------------------------
        # CASE 1
        # {
        #     "activity_id": "..."
        # }
        # -------------------------------------------------

        if isinstance(response, dict):

            activity_id = response.get(
                "activity_id"
            )

            if activity_id:
                return activity_id

        # -------------------------------------------------
        # CASE 2
        # {
        #     "data": {
        #         "activity_id": "..."
        #     }
        # }
        # -------------------------------------------------

        if isinstance(response, dict):

            data = response.get("data")

            if isinstance(data, dict):

                activity_id = data.get(
                    "activity_id"
                )

                if activity_id:
                    return activity_id

        # -------------------------------------------------
        # CASE 3
        # Search all nested dictionaries
        # -------------------------------------------------

        if isinstance(response, dict):

            for value in response.values():

                if isinstance(value, dict):

                    activity_id = (
                        self.extract_activity_id(
                            value
                        )
                    )

                    if activity_id:
                        return activity_id

                elif isinstance(value, list):

                    for item in value:

                        if isinstance(item, dict):

                            activity_id = (
                                self.extract_activity_id(
                                    item
                                )
                            )

                            if activity_id:
                                return activity_id

        return None
    # =====================================================
    # WAIT FOR ACTIVITY
    # =====================================================

    def wait_for_activity(
        self,
        activity_id,
        timeout_seconds=90,
        poll_seconds=5,
    ):
        """
        Wait for a FortyGuard activity to complete.
        """

        start_time = time.time()

        while (time.time() - start_time) < timeout_seconds:

            result = self.get_status(activity_id)

            status = None

            if isinstance(result, dict):

                status = result.get("status")

                if not status:
                    data = result.get("data")

                    if isinstance(data, dict):

                        status = data.get("status")

                        if not status:
                            nested_data = data.get("data")

                            if isinstance(
                                nested_data,
                                dict,
                            ):
                                status = nested_data.get(
                                    "status"
                                )

            print(
                f"FortyGuard activity "
                f"{activity_id} status: "
                f"{status}"
            )

            normalized_status = (
                str(status)
                .strip()
                .lower()
            )

            if normalized_status in {
                "completed",
                "complete",
                "success",
                "succeeded",
                "done",
            }:
                return result

            if normalized_status in {
                "failed",
                "failure",
                "error",
                "cancelled",
                "canceled",
            }:
                raise FortyGuardError(
                    "FortyGuard activity failed: "
                    f"{result}"
                )

            print(
                "Activity still running... "
                f"waiting {poll_seconds}s"
            )

            time.sleep(poll_seconds)

        raise FortyGuardError(
            f"Activity {activity_id} timed out "
            f"after {timeout_seconds} seconds."
        )

    # =====================================================
    # GET DOWNLOAD LINK
    # =====================================================

    def get_download_link(self, result):
        """
        Extract download_link from completed
        FortyGuard response.
        """

        if not result:
            return None

        # -------------------------------------------------
        # Direct
        # -------------------------------------------------

        if isinstance(result, dict):

            download_link = result.get(
                "download_link"
            )

            if download_link:
                return download_link

        # -------------------------------------------------
        # Recursive search
        # -------------------------------------------------

        def find_download_link(value):

            if isinstance(value, dict):

                if value.get("download_link"):
                    return value.get(
                        "download_link"
                    )

                for nested_value in value.values():

                    found = find_download_link(
                        nested_value
                    )

                    if found:
                        return found

            elif isinstance(value, list):

                for item in value:

                    found = find_download_link(
                        item
                    )

                    if found:
                        return found

            return None

        return find_download_link(
            result
        ) 