import sqlite3
from datetime import datetime, timezone

import pytest

from backend.services import civic_store


@pytest.fixture(autouse=True)
def use_sqlite(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)


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


def test_existing_sqlite_records_are_preserved_during_schema_upgrade(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy_civic.sqlite3"
    monkeypatch.setattr(civic_store, "DB_PATH", database_path)
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE civic_reports ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, "
            "note TEXT NOT NULL DEFAULT '', latitude REAL NOT NULL, "
            "longitude REAL NOT NULL, created_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO civic_reports(category, note, latitude, longitude, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("no_shade", "Existing record", 12.9, 77.5, datetime.now(timezone.utc).isoformat()),
        )

    reports = civic_store.list_reports()
    assert len(reports) == 1
    assert reports[0]["note"] == "Existing record"
    assert reports[0]["status"] == "unverified"
    assert reports[0]["anonymous"] is True


def test_storage_kind_selects_postgresql_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@example.invalid/database")
    assert civic_store.storage_kind() == "postgresql"
    monkeypatch.setenv("DATABASE_URL", "")
    assert civic_store.storage_kind() == "sqlite"
