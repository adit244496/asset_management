from __future__ import annotations

import csv
import io
import logging
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app import crud, mailer, registers, xlsx
from app.datefmt import DAY_TIME, DAY_TIME_SECONDS, display_date, now_ist, to_ist, today_ist
from app.masters import MASTER_SPECS
from app.models import NotificationSettings

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL = 7
MAX_INTERVAL = 365
ACTIVITY_LIMIT = 500_000

CATEGORY_LABELS = {
    "auth": "Passwords", "users": "Accounts", "masters": "Master data",
    "asset": "Assets", "peripheral": "Peripherals", "software": "Softwares",
    "verification": "Verification", "assistant": "Assistant", "notifications": "Email & approvals",
    "data": "All data",
    "assets": "Assets", "peripherals": "Peripherals", "softwares": "Softwares",
}
OUTCOME_LABELS = {"ok": "Done", "refused": "Refused", "failed": "Failed"}
SOURCE_LABELS = {"activity": "Action", "register": "Register change"}
ACTIVITY_HEADERS = ["When", "Who", "Area", "What happened", "Subject", "Outcome", "Kind",
                    "Field", "From", "To", "Action", "IP address"]

PERIPHERAL_LABELS = {"assetId": "Peripheral ID", "type": "Peripheral Type",
                     "assetTag": "Peripheral Name"}
LINK_COLUMNS = {registers.ASSETS: ("linkedPeripheralsText", "Linked Peripherals"),
                registers.PERIPHERALS: ("linkedAssetText", "Linked To")}


def _dash(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    return text or "—"


def _local_at(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        at = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return to_ist(at)


def _local(iso: Optional[str]) -> str:
    at = _local_at(iso)
    return at.strftime(DAY_TIME_SECONDS) if at else str(iso or "")


def _csv(headers: list[str], rows: list[list[Any]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(["" if v is None else v for v in row] for row in rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def register_columns(register) -> list[tuple[str, str]]:
    keys = crud.fields_for(register)
    link = LINK_COLUMNS.get(register)
    if link and "availability" in keys:
        keys.insert(keys.index("availability"), link[0])
    out = []
    for key in keys:
        if link and key == link[0]:
            label = link[1]
        elif register is registers.PERIPHERALS and key in PERIPHERAL_LABELS:
            label = PERIPHERAL_LABELS[key]
        else:
            label = crud.field_label(key, register)
        out.append((key, label))
    return out


def register_dicts(db: Session, register, waiting: bool = False) -> list[dict]:
    items = crud.list_unverified(db, register) if waiting else crud.list_assets(db, register)
    if register is registers.SOFTWARES:
        return [crud.asset_to_dict(s) for s in items]
    if register is registers.ASSETS:
        links = crud.linked_peripherals_map(db, [a.id for a in items])
        return [crud.asset_to_dict(a, links=links.get(a.id)) for a in items]
    on = crud.linked_assets_map(db, items)
    shared = crud.shared_type_names(db)
    return [crud.asset_to_dict(p, linked_to=on.get(p.id), shared=shared) for p in items]


def register_csv(db: Session, register, waiting: bool = False) -> tuple[bytes, int]:
    columns = register_columns(register)
    if waiting:
        columns = columns + [("verification", "Verification")]
    rows = [[display_date(d.get(key)) if key in crud.DATE_FIELDS else d.get(key) for key, _ in columns]
            for d in register_dicts(db, register, waiting)]
    return _csv([label for _, label in columns], rows), len(rows)


def activity_csv(db: Session, date_from: str, date_to: str) -> tuple[bytes, int, int, Optional[str]]:
    items, total = crud.list_activity(db, date_from=date_from, date_to=date_to, limit=ACTIVITY_LIMIT)
    rows = [[
        _local(i.get("at")), _dash(i.get("actor")),
        CATEGORY_LABELS.get(i.get("category"), i.get("category") or "—"),
        _dash(i.get("summary")), _dash(i.get("target")),
        OUTCOME_LABELS.get(i.get("outcome"), i.get("outcome") or "—"),
        SOURCE_LABELS.get(i.get("source"), i.get("source") or "—"),
        _dash(i.get("field")), _dash(display_date(i.get("oldValue"))), _dash(display_date(i.get("newValue"))),
        _dash(i.get("action")), _dash(i.get("ip")),
    ] for i in items]
    last = _local_at(items[-1].get("at")) if items else None
    oldest = last.date().isoformat() if last else None
    return _csv(ACTIVITY_HEADERS, rows), len(rows), total, oldest


USER_SHEET_COLUMNS = [("fullName", "Full Name"), ("email", "Email ID"), ("location", "Location"),
                      ("dateOfJoining", "Date of Joining"), ("username", "Username"),
                      ("role", "Profile")]


def _yes_no(value: Any) -> str:
    return "Yes" if value else "No"


def master_workbook(db: Session) -> tuple[bytes, dict]:
    items = crud.all_masters_snapshot(db)
    users = [crud.user_out_dict(u) for u in crud.list_users(db)]
    sheets = []
    for spec in MASTER_SPECS:
        types = spec.key == "type"
        header = [spec.label, "Description", "Active", "Order", *(["Shared"] if types else []), "In use"]
        rows = [[r["name"], r.get("description") or "", _yes_no(r.get("isActive")), r.get("sortOrder"),
                 *([_yes_no(r.get("isShared"))] if types else []), r.get("inUse")]
                for r in items.get(spec.key, [])]
        sheets.append((spec.plural, [header, *rows], [28, 40] + [10] * (len(header) - 2), True))
    sheets.append(("Users", [[label for _, label in USER_SHEET_COLUMNS] + ["Active"],
                             *[[display_date(u.get(k)) or "" for k, _ in USER_SHEET_COLUMNS]
                               + [_yes_no(u.get("isActive"))]
                               for u in users]],
                   [26, 32, 22, 15, 14, 14, 14], True))
    values = sum(len(v) for v in items.values())
    sheets.append(("About", [
        ["IT Asset Engine — Master Data"],
        ["Saved", now_ist().strftime(DAY_TIME)],
        ["Why", "Part of the data export."],
        ["Values", values],
        ["Users", len(users)],
        [],
        ["One sheet per list, and one for Users. To fill them from this file, open Master Data and "
         "choose Upload workbook."],
        ["Active and Shared take Yes or No. Order sets the dropdown order. In use is for reading only "
         "and is not uploaded."],
        ["A value already in a list is updated to what the sheet says; a value not in the list is added; "
         "nothing is deleted."],
        ["Users: matched by Email ID. Someone already on file has Email ID, Location and Date of Joining "
         "updated; someone new is added as an assignee on the starting password. All four columns are "
         "needed. Username, Profile and Active are for reading only -- a profile or password is never "
         "set from this file."],
    ], [14, 60], False))
    return xlsx.workbook(sheets), {"values": values, "users": len(users)}


def interval_of(cfg: Optional[NotificationSettings]) -> int:
    try:
        n = int(getattr(cfg, "export_interval_days", None) or DEFAULT_INTERVAL)
    except (TypeError, ValueError):
        n = DEFAULT_INTERVAL
    return min(max(n, 1), MAX_INTERVAL)


def activity_window(cfg: Optional[NotificationSettings], today: date) -> tuple[str, str]:
    last = getattr(cfg, "last_export_on", None)
    try:
        start = date.fromisoformat(last) if last else today - timedelta(days=interval_of(cfg))
    except ValueError:
        start = today - timedelta(days=interval_of(cfg))
    return min(start, today).isoformat(), today.isoformat()


def build_zip(db: Session, cfg: Optional[NotificationSettings], today: date,
              everything: bool = False, activity: bool = True, waiting: bool = False,
              name: str = "it-asset-export") -> tuple[bytes, str, dict]:
    start, end = activity_window(cfg, today)
    if everything:
        start = ""
    counts: dict[str, Any] = {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for register in registers.ALL:
            data, n = register_csv(db, register)
            zf.writestr(f"{register.plural}-{today.isoformat()}.csv", data)
            counts[register.plural] = n
            if waiting:
                data, n = register_csv(db, register, waiting=True)
                if n:
                    zf.writestr(f"{register.plural}-waiting-verification-{today.isoformat()}.csv", data)
                counts[f"{register.plural}Waiting"] = n
        if activity:
            data, n, total, oldest = activity_csv(db, start, end)
            if everything:
                start = min(oldest or end, end)
            zf.writestr(f"activity-log-{start}-to-{end}.csv", data)
            counts["activity"] = n
            counts["activityComplete"] = n >= total
        data, m = master_workbook(db)
        zf.writestr(f"master-data-{today.isoformat()}.xlsx", data)
        counts["masterValues"], counts["users"] = m["values"], m["users"]
    counts["activityFrom"], counts["activityTo"] = start, end
    return buf.getvalue(), f"{name}-{today.isoformat()}.zip", counts


def recipients_of(cfg: Optional[NotificationSettings]) -> list[str]:
    return mailer.split_addresses(getattr(cfg, "export_recipients", None))


def _message(counts: dict, name: str, by: str) -> tuple[str, str, str]:
    a, p, s = counts.get("assets", 0), counts.get("peripherals", 0), counts.get("softwares", 0)
    period = f"{display_date(counts['activityFrom'])} to {display_date(counts['activityTo'])}"
    day = counts["activityTo"]
    subject = f"IT Asset Engine data export ({display_date(day)})"
    lines = [f"Assets: {a} records (assets-{day}.csv)",
             f"Peripherals: {p} records (peripherals-{day}.csv)",
             f"Softwares: {s} records (softwares-{day}.csv)",
             f"Activity Log, {period}: {counts.get('activity', 0)} entries "
             f"(activity-log-{counts['activityFrom']}-to-{day}.csv)",
             f"Master Data: {counts.get('masterValues', 0)} values in every list and "
             f"{counts.get('users', 0)} users, a sheet each (master-data-{day}.xlsx)"]
    text = (f"The attached {name} holds the IT asset registers and the Master Data as they stand "
            f"now, and the Activity Log for {period}.\n\n" + "\n".join(f"  - {x}" for x in lines)
            + f"\n\n{by}. Every file opens in Excel; the Master Data workbook can be uploaded "
              "again on the Master Data screen (Upload workbook).")
    body = ("<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111'>"
            f"<p>The attached <b>{name}</b> holds the IT asset registers and the Master Data as they "
            f"stand now, and the Activity Log for {period}.</p><ul>"
            + "".join(f"<li>{x}</li>" for x in lines) + "</ul>"
            f"<p style='color:#777;font-size:12px;margin-top:24px'>{by}. Every file opens in Excel; "
            "the Master Data workbook can be uploaded again on the Master Data screen "
            "(Upload workbook).</p></div>")
    return subject, text, body


def send(db: Session, cfg: NotificationSettings, today: date, by: str, everything: bool = False) -> dict:
    to = recipients_of(cfg)
    if not to:
        raise mailer.MailError("Add at least one address to send the data export to, and save.")
    data, name, counts = build_zip(db, cfg, today, everything=everything)
    subject, text, body = _message(counts, name, by)
    mailer.send(cfg, to, subject, text, body, attachments=[(name, data, "application", "zip")])
    return {"to": to, "file": name, "bytes": len(data), "counts": counts}


def next_due(cfg: Optional[NotificationSettings]) -> Optional[str]:
    if cfg is None or not getattr(cfg, "export_enabled", False):
        return None
    today = today_ist()
    last = getattr(cfg, "last_export_on", None)
    if not last:
        return today.isoformat()
    try:
        return max(date.fromisoformat(last) + timedelta(days=interval_of(cfg)), today).isoformat()
    except ValueError:
        return today.isoformat()


def due(cfg: Optional[NotificationSettings], now_local: datetime) -> bool:
    if cfg is None or not getattr(cfg, "export_enabled", False) or not mailer.configured(cfg):
        return False
    if not recipients_of(cfg):
        return False
    today = now_local.date().isoformat()
    if getattr(cfg, "last_export_try_on", None) == today:
        return False
    when = next_due(cfg)
    if when is None or when > today:
        return False
    return now_local.strftime("%H:%M") >= (cfg.export_time or "09:00")


def claim_day(db: Session, today: str) -> bool:
    result = db.execute(sql_text(
        "UPDATE notification_settings SET last_export_try_on = :d "
        "WHERE id = 1 AND (last_export_try_on IS NULL OR last_export_try_on <> :d)"), {"d": today})
    db.commit()
    return result.rowcount == 1


def clear_activity(db: Session, cfg: NotificationSettings, cutoff: datetime) -> int:
    from sqlalchemy import delete

    from app.models import ActivityLog
    deleted = db.execute(delete(ActivityLog).where(ActivityLog.at <= cutoff)).rowcount or 0
    cfg.activity_cleared_at = cutoff.astimezone(timezone.utc).isoformat()
    db.commit()
    return deleted


def send_and_clear(db: Session, cfg: NotificationSettings, today: date, by: str) -> dict:
    clearing = bool(getattr(cfg, "export_clear_activity", False))
    cutoff = datetime.now(timezone.utc)
    sent = send(db, cfg, today, by + ("; it carries the whole Activity Log, which is cleared in "
                                      "the app once this email is sent" if clearing else ""),
                everything=clearing)
    sent["cleared"] = None
    if clearing:
        from app.approvals import _log
        if sent["counts"].get("activityComplete"):
            sent["cleared"] = clear_activity(db, cfg, cutoff)
            sent["clearedAt"] = cfg.activity_cleared_at
        else:
            _log(db, "The Activity Log was too long to email whole, so it was NOT cleared", ok=False)
    return sent


def cleared_line(sent: dict) -> str:
    return (f"Cleared the Activity Log after emailing it in {sent['file']}: {sent['cleared']} "
            "action entries deleted; register changes up to then stay in each record's History")


def run_if_due(now: Optional[datetime] = None) -> None:
    from app.approvals import _log, _session
    now = now or datetime.now(timezone.utc)
    now_local = to_ist(now)
    with _session() as db:
        cfg = db.get(NotificationSettings, 1)
        if not due(cfg, now_local) or not claim_day(db, now_local.date().isoformat()):
            return
        today = now_local.date()
        try:
            sent = send_and_clear(db, cfg, today, "Sent by IT Asset Engine on its schedule "
                                  f"(every {interval_of(cfg)} day{'s' if interval_of(cfg) != 1 else ''})")
        except mailer.MailError as exc:
            _log(db, f"Could not email the scheduled data export: {exc}", ok=False)
            return
        except Exception as exc:  # noqa: BLE001 -- logged, and tried again tomorrow
            logger.exception("Scheduled data export failed")
            _log(db, f"Could not build the scheduled data export: {exc.__class__.__name__}", ok=False)
            return
        cfg.last_export_on = today.isoformat()
        db.commit()
        _log(db, f"Emailed the scheduled data export ({sent['file']}, "
                 f"{sent['bytes'] // 1024 + 1} KB) to {', '.join(sent['to'])}")
        if sent["cleared"] is not None:
            _log(db, cleared_line(sent))

