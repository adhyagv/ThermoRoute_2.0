from backend.services import civic_store


def test_create_and_list_civic_report(tmp_path, monkeypatch):
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "civic_test.sqlite3")
    created = civic_store.create_report(
        category="too_hot",
        note="No shade at this crossing",
        latitude=12.9716,
        longitude=77.5946,
    )
    assert created["id"] == 1
    assert created["category"] == "too_hot"
    assert created["note"] == "No shade at this crossing"
    reports = civic_store.list_reports(limit=10)
    assert len(reports) == 1
    assert reports[0]["latitude"] == 12.9716


def test_limit_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "civic_test.sqlite3")
    civic_store.create_report("other", "", 12.9, 77.5)
    assert len(civic_store.list_reports(limit=0)) == 1
    assert civic_store.list_reports(limit=900)  # bounded to 500, still returns the one row


def test_report_status_update_and_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(civic_store, "DB_PATH", tmp_path / "civic_test.sqlite3")
    report = civic_store.create_report("poor_air_quality", "Dust", 12.9, 77.5, anonymous=False)
    assert report["status"] == "unverified"
    assert report["anonymous"] is False
    reviewed = civic_store.update_report_status(report["id"], "reviewed")
    assert reviewed and reviewed["status"] == "reviewed"
    assert civic_store.delete_report(report["id"]) is True
    assert civic_store.list_reports() == []
