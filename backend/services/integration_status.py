"""In-memory status for optional external integrations.

Reachability is the result of the last real request made by this process.
A health check does not send an unrequested probe to a third-party service.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock

_lock = Lock()
_state = {
    "configured": False,
    "reachable": None,
    "reachability_status": "not_checked",
    "checked_at": None,
    "last_error": None,
    "last_sample_used_fallback": None,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def set_configured(configured: bool) -> None:
    with _lock:
        _state["configured"] = bool(configured)
        if not configured and _state["reachable"] is None:
            _state["reachability_status"] = "not_configured"


def record_request_result(reachable: bool, error: str | None = None) -> None:
    with _lock:
        _state["reachable"] = bool(reachable)
        _state["reachability_status"] = "reachable" if reachable else "unreachable"
        _state["checked_at"] = _now()
        _state["last_error"] = error[:500] if error else None


def record_sample_fallback(used_fallback: bool) -> None:
    with _lock:
        _state["last_sample_used_fallback"] = bool(used_fallback)


def get_fortyguard_status() -> dict:
    with _lock:
        result = deepcopy(_state)
    if not result["configured"] and result["reachable"] is None:
        result["reachability_status"] = "not_configured"
    return result


def reset_status_for_tests() -> None:
    with _lock:
        _state.update({
            "configured": False,
            "reachable": None,
            "reachability_status": "not_checked",
            "checked_at": None,
            "last_error": None,
            "last_sample_used_fallback": None,
        })
