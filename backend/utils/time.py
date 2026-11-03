from datetime import datetime, timedelta, timezone


def ensure_timezone_aware(dt: datetime) -> datetime:
    """
    Ensure a datetime contains timezone information.

    Raises:
        ValueError: If the datetime is naive.

    Returns:
        The original timezone-aware datetime.
    """
    if dt.tzinfo is None:
        raise ValueError(
            "Datetime must be timezone-aware."
        )

    return dt


def calculate_arrival_time(
    departure_time: datetime,
    travel_time_s: float,
) -> datetime:
    """
    Calculate the expected arrival time from a departure time
    and travel duration.
    """
    ensure_timezone_aware(departure_time)

    if travel_time_s < 0:
        raise ValueError(
            "Travel time cannot be negative."
        )

    return departure_time + timedelta(
        seconds=travel_time_s
    )


def calculate_segment_times(
    departure_time: datetime,
    segment_times_s: list[float],
) -> list[tuple[datetime, datetime]]:
    """
    Calculate start and end times for each route segment.

    Each tuple contains:
        (segment_start_time, segment_end_time)
    """
    ensure_timezone_aware(departure_time)

    if not segment_times_s:
        raise ValueError(
            "At least one segment travel time is required."
        )

    segment_times = []

    current_time = departure_time

    for travel_time_s in segment_times_s:
        if travel_time_s < 0:
            raise ValueError(
                "Segment travel time cannot be negative."
            )

        segment_start = current_time

        segment_end = current_time + timedelta(
            seconds=travel_time_s
        )

        segment_times.append(
            (segment_start, segment_end)
        )

        current_time = segment_end

    return segment_times


def get_time_at_offset(
    start_time: datetime,
    offset_minutes: float,
) -> datetime:
    """
    Return the datetime occurring a given number of minutes
    after start_time.
    """
    ensure_timezone_aware(start_time)

    return start_time + timedelta(
        minutes=offset_minutes
    )


def generate_departure_times(
    start_time: datetime,
    end_time: datetime,
    interval_minutes: int = 60,
) -> list[datetime]:
    """
    Generate departure times between start_time and end_time.

    This will later be useful for evaluating multiple
    Route × Time combinations.
    """
    ensure_timezone_aware(start_time)
    ensure_timezone_aware(end_time)

    if end_time < start_time:
        raise ValueError(
            "End time cannot be earlier than start time."
        )

    if interval_minutes <= 0:
        raise ValueError(
            "Interval must be greater than zero."
        )

    departure_times = []
    current_time = start_time

    while current_time <= end_time:
        departure_times.append(current_time)

        current_time += timedelta(
            minutes=interval_minutes
        )

    return departure_times


def duration_minutes(
    start_time: datetime,
    end_time: datetime,
) -> float:
    """
    Calculate the duration between two timezone-aware
    datetimes in minutes.
    """
    ensure_timezone_aware(start_time)
    ensure_timezone_aware(end_time)

    duration = end_time - start_time

    if duration.total_seconds() < 0:
        raise ValueError(
            "End time cannot be earlier than start time."
        )

    return duration.total_seconds() / 60.0


def to_utc(dt: datetime) -> datetime:
    """
    Convert a timezone-aware datetime to UTC.
    """
    ensure_timezone_aware(dt)

    return dt.astimezone(timezone.utc)