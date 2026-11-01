"""Dates as people read them -- dd-mm-yyyy, in Indian Standard Time -- in
emails and exported files. Stored values, API payloads and file names stay
yyyy-mm-dd; timestamps are stored in UTC.

IST is used explicitly, never the server's own time zone, so a server hosted
in another country still works in Indian dates and times. India has no
daylight saving, so a fixed +05:30 offset is exact (and needs no tz database,
which Windows does not ship)."""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

IST = timezone(timedelta(hours=5, minutes=30), "IST")

_ISO_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def to_ist(moment: Optional[datetime]) -> Optional[datetime]:
    """A stored timestamp in IST. A naive one is taken to be UTC, as stored."""
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(IST)


def ist_day_start_utc(day: str) -> Optional[datetime]:
    """00:00 IST on yyyy-mm-dd, as a UTC instant; None if not a date."""
    try:
        d = date.fromisoformat(str(day).strip())
    except ValueError:
        return None
    return datetime(d.year, d.month, d.day, tzinfo=IST).astimezone(timezone.utc)

DAY = "%d-%m-%Y"
DAY_TIME = "%d-%m-%Y, %H:%M"
DAY_TIME_SECONDS = "%d-%m-%Y %H:%M:%S"


def display_date(value: Any) -> Any:
    """yyyy-mm-dd (a string, date or datetime) -> dd-mm-yyyy; anything else unchanged."""
    if isinstance(value, datetime):
        return to_ist(value).strftime(DAY)
    if isinstance(value, date):
        return value.strftime(DAY)
    if isinstance(value, str):
        m = _ISO_DAY.match(value.strip())
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return value
