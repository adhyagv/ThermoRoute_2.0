from backend.services.integration_status import (
    get_fortyguard_status,
    record_request_result,
    record_sample_fallback,
    reset_status_for_tests,
    set_configured,
)
from backend.services.fortyguard import FortyGuardClient, FortyGuardError


def setup_function():
    reset_status_for_tests()


def test_unconfigured_client_reports_not_configured(monkeypatch):
    monkeypatch.delenv("FORTYGUARD_API_KEY", raising=False)
    client = FortyGuardClient()
    assert client.api_key is None
    assert get_fortyguard_status()["configured"] is False
    try:
        client._post("test", {})
    except FortyGuardError:
        pass
    status = get_fortyguard_status()
    assert status["reachable"] is None
    assert status["reachability_status"] == "not_configured"


def test_successful_request_state_is_recorded():
    set_configured(True)
    record_request_result(True)
    record_sample_fallback(False)
    status = get_fortyguard_status()
    assert status["configured"] is True
    assert status["reachable"] is True
    assert status["last_sample_used_fallback"] is False
    assert status["checked_at"] is not None


def test_temperature_provider_marks_fallback_sample(monkeypatch):
    from backend.services import temperature_provider

    monkeypatch.setattr(temperature_provider, "get_cache", lambda _key: None)
    monkeypatch.setattr(temperature_provider, "set_cache", lambda *_args, **_kwargs: None)

    def fail_request(**_kwargs):
        raise FortyGuardError("test upstream failure")

    monkeypatch.setattr(temperature_provider.client, "get_environmental_parameters", fail_request)
    result = temperature_provider.get_temperature_for_segment(
        latitude=12.93,
        longitude=77.56,
        fallback_temperature=35,
    )

    assert result == {"temperature": 35, "source": "fallback"}
    assert get_fortyguard_status()["last_sample_used_fallback"] is True
