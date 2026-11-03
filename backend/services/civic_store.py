"""SQLite persistence and community-submission summaries."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "civic_reports.sqlite3"
REPORT_STATUSES = {"unverified", "reviewed", "resolved"}


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS civic_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unverified',
                anonymous INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(civic_reports)").fetchall()
        }
        if "status" not in columns:
            connection.execute(
                "ALTER TABLE civic_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified'"
            )
        if "anonymous" not in columns:
            connection.execute(
                "ALTER TABLE civic_reports ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 1"
            )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_civic_reports_created_at "
            "ON civic_reports(created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_civic_reports_category_status "
            "ON civic_reports(category, status)"
        )


def _report(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["anonymous"] = bool(result["anonymous"])
    return result


def create_report(
    category: str,
    note: str,
    latitude: float,
    longitude: float,
    anonymous: bool = True,
) -> dict[str, Any]:
    initialize_database()
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as connection:
        cursor = connection.execute(
            "INSERT INTO civic_reports(category, note, latitude, longitude, created_at, status, anonymous) "
            "VALUES (?, ?, ?, ?, ?, 'unverified', ?)",
            (category, note, latitude, longitude, created_at, int(anonymous)),
        )
        row = connection.execute(
            "SELECT id, category, note, latitude, longitude, created_at, status, anonymous "
            "FROM civic_reports WHERE id = ?",
            (int(cursor.lastrowid),),
        ).fetchone()
    if row is None:
        raise RuntimeError("The civic report was inserted but could not be read back.")
    return _report(row)


def list_reports(
    limit: int = 100,
    category: str | None = None,
    status: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> list[dict[str, Any]]:
    initialize_database()
    safe_limit = max(1, min(int(limit), 500))
    clauses: list[str] = []
    values: list[Any] = []
    if category:
        clauses.append("category = ?")
        values.append(category)
    if status:
        clauses.append("status = ?")
        values.append(status)
    if from_date:
        clauses.append("created_at >= ?")
        values.append(from_date.astimezone(timezone.utc).isoformat())
    if to_date:
        clauses.append("created_at <= ?")
        values.append(to_date.astimezone(timezone.utc).isoformat())
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT id, category, note, latitude, longitude, created_at, status, anonymous "
            f"FROM civic_reports{where} ORDER BY created_at DESC, id DESC LIMIT ?",
            (*values, safe_limit),
        ).fetchall()
    return [_report(row) for row in rows]


def update_report_status(report_id: int, status: str) -> dict[str, Any] | None:
    if status not in REPORT_STATUSES:
        raise ValueError("Unsupported civic report status.")
    initialize_database()
    with _connect() as connection:
        connection.execute(
            "UPDATE civic_reports SET status = ? WHERE id = ?",
            (status, report_id),
        )
        row = connection.execute(
            "SELECT id, category, note, latitude, longitude, created_at, status, anonymous "
            "FROM civic_reports WHERE id = ?",
            (report_id,),
        ).fetchone()
    return _report(row) if row else None


def delete_report(report_id: int) -> bool:
    initialize_database()
    with _connect() as connection:
        cursor = connection.execute("DELETE FROM civic_reports WHERE id = ?", (report_id,))
    return cursor.rowcount > 0


def summarize_reports(days: int = 30) -> dict[str, Any]:
    """Summarize community submissions; spatial cells are not official neighbourhoods."""
    safe_days = max(1, min(int(days), 90))
    reports = list_reports(limit=500)
    now = datetime.now(timezone.utc)
    cutoff_7d = now - timedelta(days=7)
    cutoff_days = now - timedelta(days=safe_days)
    categories: dict[str, int] = {}
    areas: dict[str, int] = {}
    weekly: dict[str, int] = {}
    monthly: dict[str, int] = {}
    recent: list[dict[str, Any]] = []
    for report in reports:
        categories[report["category"]] = categories.get(report["category"], 0) + 1
        area = f"{report['latitude']:.2f}, {report['longitude']:.2f}"
        areas[area] = areas.get(area, 0) + 1
        try:
            created = datetime.fromisoformat(report["created_at"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created >= cutoff_7d:
            day = created.astimezone(timezone.utc).date().isoformat()
            weekly[day] = weekly.get(day, 0) + 1
            recent.append(report)
        if created >= cutoff_days:
            month = created.astimezone(timezone.utc).date().replace(day=1).isoformat()
            monthly[month] = monthly.get(month, 0) + 1
    return {
        "total_reports": len(reports),
        "reports_by_category": categories,
        "reports_by_neighbourhood_cell": [
            {"cell": cell, "count": count}
            for cell, count in sorted(areas.items(), key=lambda item: (-item[1], item[0]))
        ],
        "recent_hotspots": sorted(
            recent,
            key=lambda report: (report["created_at"], report["id"]),
            reverse=True,
        )[:20],
        "seven_day_trend": [{"date": key, "count": weekly[key]} for key in sorted(weekly)],
        "thirty_day_trend": [{"month": key, "count": monthly[key]} for key in sorted(monthly)],
        "density_note": (
            "Report density represents community submissions in approximate coordinate cells, "
            "not scientifically measured heat intensity or official neighbourhood boundaries."
        ),
    }
