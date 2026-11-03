"""Optional manual FortyGuard smoke test. Never runs during pytest collection.

Run with: python -m backend.scripts.fortyguard_smoke_test
Requires FORTYGUARD_API_KEY and makes a real external API request.
"""
import json
import os

import requests
from dotenv import load_dotenv


def main() -> None:
    load_dotenv()
    api_key = os.getenv("FORTYGUARD_API_KEY")
    if not api_key:
        raise SystemExit("Set FORTYGUARD_API_KEY to run this optional smoke test.")

    response = requests.post(
        "https://api.fortyguard.com/v1/heatmap",
        headers={"api-key": api_key, "Content-Type": "application/json"},
        json={
            "polygon_aoi": {"type": "FeatureCollection", "features": [{
                "type": "Feature", "properties": {}, "geometry": {
                    "type": "Polygon", "coordinates": [[[55.2708, 25.2048], [55.2808, 25.2048], [55.2808, 25.2148], [55.2708, 25.2148], [55.2708, 25.2048]]]
                }
            }]},
            "date_time": {"start_date": "2026-08-15", "start_time": "14:00", "filter_type": 1},
            "granularity": 100, "analytic_type": "tcm"
        },
        timeout=60,
    )
    print(f"HTTP {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2))
    except ValueError:
        print(response.text)


if __name__ == "__main__":
    main()
