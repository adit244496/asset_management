"""Change counters behind the app's live updates.

Every open page polls GET /api/live every few seconds. The answer is one
counter per topic (a register, Verification, Master Data, users, the Activity
Log, settings, the assistant). A topic's counter goes up whenever something
in it changes, so a page only re-fetches what it shows when its own topic
moved -- nobody re-downloads the register because someone changed a password.

The counters live in the `counters` table (rows named "live:<topic>"), so
they are shared by every API process and survive a restart.

Changes are noticed in two places:
  * after every successful POST/PATCH/PUT/DELETE (install(), below), by the
    request's blueprint -- see TOPICS_BY_BLUEPRINT;
  * by bump() calls from background jobs (Activity Log entries written by
    the scheduler, the Activity Log being cleared after an export).
"""
import logging

from flask import request
from sqlalchemy import bindparam, text

from app.database import engine

logger = logging.getLogger(__name__)

PREFIX = "live:"

ASSETS = "assets"
PERIPHERALS = "peripherals"
SOFTWARES = "softwares"
VERIFICATION = "verification"
MASTERS = "masters"
USERS = "users"
ACTIVITY = "activity"
SETTINGS = "settings"
ASSISTANT = "assistant"

REGISTERS = (ASSETS, PERIPHERALS, SOFTWARES)
TOPICS = REGISTERS + (VERIFICATION, MASTERS, USERS, ACTIVITY, SETTINGS, ASSISTANT)
EVERYTHING = frozenset(TOPICS)

MUTATING = frozenset({"POST", "PATCH", "PUT", "DELETE"})

# What a successful write through each blueprint can change. Erring wide is
# cheap (a page re-fetches once); erring narrow leaves a page stale.
#   * Linking a peripheral changes both the asset and the peripheral.
#   * A master value renamed or a person renamed is carried onto records.
#   * An approval decided or withdrawn unlocks records.
TOPICS_BY_BLUEPRINT = {
    ASSETS: {ASSETS, PERIPHERALS, VERIFICATION},
    PERIPHERALS: {ASSETS, PERIPHERALS, VERIFICATION},
    SOFTWARES: {SOFTWARES, VERIFICATION},
    "verification": {ASSETS, PERIPHERALS, SOFTWARES, VERIFICATION},
    "masters": {MASTERS, ASSETS, PERIPHERALS, SOFTWARES},
    "users": {USERS, ASSETS, PERIPHERALS, SOFTWARES},
    "auth": {USERS},
    "notifications": {SETTINGS, ASSETS, PERIPHERALS, SOFTWARES},
    "data": set(EVERYTHING),
    "admin_controls": {ASSISTANT},
    "activity": set(),
    "assistant": set(),
}

# POSTs that only read (QR labels, file downloads, a test email, ...). They
# change nothing a page shows, apart from their own Activity Log line.
READ_ONLY = frozenset(
    {f"{reg}.asset_qr_codes" for reg in REGISTERS}
    | {f"{reg}.register_history_export" for reg in REGISTERS}
    | {
        "auth.login",
        "assistant.ask",
        "assistant.start_conversation",
        "assistant.set_mode",
        "assistant.report_rows",
        "notifications.export_download",
        "notifications.send_test",
        "notifications.resend",
        "admin_controls.test_connection",
    }
)

# Nothing in these shows up anywhere, not even in the Activity Log.
SILENT = frozenset({"auth.login", "assistant.ask", "assistant.start_conversation",
                    "assistant.set_mode"})


def _name(topic: str) -> str:
    return PREFIX + topic


def ensure_counters() -> None:
    """Create any missing counter row (first start, or a new topic)."""
    with engine.begin() as conn:
        have = {row[0] for row in conn.execute(
            text("SELECT name FROM counters WHERE name LIKE :p"), {"p": PREFIX + "%"})}
        for topic in TOPICS:
            if _name(topic) not in have:
                conn.execute(text("INSERT INTO counters (name, next_value) VALUES (:n, 1)"),
                             {"n": _name(topic)})


def bump(*topics: str) -> None:
    """Note that these topics changed. Never raises: a missed live update must
    not turn a saved change into an error."""
    names = sorted({_name(t) for t in topics if t in EVERYTHING})
    if not names:
        return
    try:
        with engine.begin() as conn:
            done = conn.execute(
                text("UPDATE counters SET next_value = next_value + 1 WHERE name IN :names")
                .bindparams(bindparam("names", expanding=True)),
                {"names": names},
            ).rowcount
        if done is not None and done < len(names):
            ensure_counters()
    except Exception:  # noqa: BLE001
        logger.exception("Could not record a live-update change for %s", ", ".join(names))


def versions() -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT name, next_value FROM counters WHERE name LIKE :p"),
                            {"p": PREFIX + "%"}).all()
    out = {name[len(PREFIX):]: int(value) for name, value in rows}
    return {topic: out.get(topic, 0) for topic in TOPICS}


def topics_for(endpoint: str) -> set:
    if not endpoint or endpoint in SILENT:
        return set()
    if endpoint in READ_ONLY:
        return {ACTIVITY}
    blueprint = endpoint.rpartition(".")[0]
    found = TOPICS_BY_BLUEPRINT.get(blueprint)
    topics = set(EVERYTHING) if found is None else set(found)
    topics.add(ACTIVITY)
    return topics


def _after_request(response):
    try:
        if request.method in MUTATING and response.status_code < 400:
            bump(*topics_for(request.endpoint or ""))
    except Exception:  # noqa: BLE001
        logger.exception("Live-update hook failed for %s %s", request.method, request.path)
    return response


def install(app) -> None:
    app.after_request(_after_request)
