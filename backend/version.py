"""Read the single project version from the repository-root VERSION.json."""
from __future__ import annotations

import json
from pathlib import Path

_VERSION_FILE = Path(__file__).resolve().parents[1] / "VERSION.json"

try:
    with _VERSION_FILE.open("r", encoding="utf-8") as file:
        APP_VERSION = str(json.load(file)["version"])
except (OSError, KeyError, TypeError, json.JSONDecodeError):
    APP_VERSION = "0+unknown"
