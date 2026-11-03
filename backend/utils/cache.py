import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / ".cache"
DEFAULT_TTL_SECONDS = 3600

_SAFE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_\-]+$")


def _ensure_cache_directory() -> None:
    """
    Create the cache directory if it does not already exist.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _validate_key(key: str) -> None:
    """
    Ensure a cache key is non-empty and safe to use as a filename
    component (alphanumeric, underscore, hyphen only), preventing
    path traversal via crafted keys.
    """
    if not key.strip():
        raise ValueError("Cache key cannot be empty.")
    if not _SAFE_KEY_PATTERN.match(key):
        raise ValueError(
            "Cache key must contain only letters, digits, "
            "underscores, and hyphens."
        )


def _build_cache_key(
    prefix: str,
    payload: Any,
) -> str:
    """
    Create a stable cache key from a payload.
    """
    serialized = json.dumps(
        payload,
        sort_keys=True,
        default=str,
    )
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return f"{prefix}_{digest}"


def set_cache(
    key: str,
    value: Any,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> None:
    """
    Store a value in the local cache.

    Args:
        key: Unique cache key (letters, digits, underscore, hyphen only).
        value: JSON-serializable value. If caching a Pydantic model
            (e.g. ClimateReading), pass value.model_dump(mode="json")
            rather than the model instance, so datetimes are
            serialized to ISO strings first.
        ttl_seconds: Cache lifetime in seconds.
    """
    _validate_key(key)
    if ttl_seconds <= 0:
        raise ValueError("Cache TTL must be greater than zero.")

    _ensure_cache_directory()
    cache_file = CACHE_DIR / f"{key}.json"
    cache_data = {
        "created_at": time.time(),
        "ttl_seconds": ttl_seconds,
        "value": value,
    }

    try:
        with cache_file.open("w", encoding="utf-8") as file:
            json.dump(cache_data, file, ensure_ascii=False, indent=2)
    except TypeError as exc:
        raise ValueError(
            "Cache value is not JSON-serializable. If caching a "
            "Pydantic model, pass model.model_dump(mode='json') "
            "instead of the model instance."
        ) from exc


def get_cache(
    key: str,
) -> Any | None:
    """
    Retrieve a value from the local cache.

    Returns:
        Cached value if it exists and has not expired.
        None otherwise.
    """
    _validate_key(key)
    cache_file = CACHE_DIR / f"{key}.json"
    if not cache_file.exists():
        return None

    try:
        with cache_file.open("r", encoding="utf-8") as file:
            cache_data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return None

    created_at = cache_data.get("created_at")
    ttl_seconds = cache_data.get("ttl_seconds")

    if not isinstance(created_at, (int, float)):
        delete_cache(key)
        return None
    if not isinstance(ttl_seconds, (int, float)):
        delete_cache(key)
        return None
    if time.time() - created_at >= ttl_seconds:
        delete_cache(key)
        return None

    return cache_data.get("value")


def delete_cache(
    key: str,
) -> None:
    """
    Delete a cached value.
    """
    _validate_key(key)
    cache_file = CACHE_DIR / f"{key}.json"
    if cache_file.exists():
        try:
            cache_file.unlink()
        except OSError:
            pass


def clear_cache() -> None:
    """
    Remove all cached values.
    """
    if not CACHE_DIR.exists():
        return
    for cache_file in CACHE_DIR.glob("*.json"):
        try:
            cache_file.unlink()
        except OSError:
            pass


def build_climate_cache_key(
    latitude: float,
    longitude: float,
    timestamp: str,
) -> str:
    """
    Build a stable cache key for a climate lookup.
    """
    payload = {
        "latitude": latitude,
        "longitude": longitude,
        "timestamp": timestamp,
    }
    return _build_cache_key(prefix="climate", payload=payload)