from __future__ import annotations

import html
import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app import crud, mailer
from app.datefmt import display_date, to_ist, today_ist
from app.models import NotificationSettings, RenewalNotice, Software

logger = logging.getLogger(__name__)

EARLY_DAYS = 30
SECOND_DAYS = 15
DAILY_DAYS = 7
STAGE_30, STAGE_15, STAGE_DAILY = "30", "15", "daily"
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def stage_for(days_left: int) -> Optional[str]:
    if days_left <= DAILY_DAYS:
        return STAGE_DAILY
    if days_left <= SECOND_DAYS:
        return STAGE_15
    if days_left <= EARLY_DAYS:
        return STAGE_30
    return None


def _days_left(item, today: date) -> Optional[int]:
    value = str(item.warranty_end or "").strip()
    if not _DATE.match(value):
        return None
    try:
        return (date.fromisoformat(value) - today).days
    except ValueError:
        return None


def watched(db: Session) -> list:
    rows = db.execute(select(Software).where(
        Software.is_deleted.is_(False), Software.verification == crud.VERIFIED,
    )).scalars().all()
    return [s for s in rows if not crud.is_sold(s.status)]


def plan(db: Session, today: date) -> dict[str, list[dict]]:
    sent = {(n.software_id, n.renewal_date, n.stage, n.sent_on)
            for n in db.execute(select(RenewalNotice)).scalars()}
    once = {(sid, d, st) for sid, d, st, _ in sent}
    out = {STAGE_30: [], STAGE_15: [], STAGE_DAILY: []}
    for item in watched(db):
        days = _days_left(item, today)
        if days is None:
            continue
        stage = stage_for(days)
        if stage is None:
            continue
        key = (item.id, item.warranty_end)
        if stage == STAGE_DAILY:
            if (*key, STAGE_DAILY, today.isoformat()) in sent:
                continue
        elif (*key, stage) in once:
            continue
        out[stage].append({"item": item, "days": days, "date": item.warranty_end})
    for stage in out:
        out[stage].sort(key=lambda e: (e["days"], (e["item"].asset_tag or "").lower()))
    return out


def _when(days: int) -> str:
    if days < 0:
        return f"overdue by {-days} day{'s' if days != -1 else ''}"
    if days == 0:
        return "due today"
    return f"in {days} day{'s' if days != 1 else ''}"


def _rupees(price: Any) -> str:
    try:
        return "₹ " + f"{float(price):,.0f}" if price not in (None, "") else ""
    except ValueError:
        return str(price)


def _table(entries: list[dict]) -> tuple[str, str]:
    lines, rows = [], []
    for e in entries:
        s = e["item"]
        name = " ".join(x for x in (s.asset_tag, s.version) if x)
        bits = [s.asset_id, name, f"renews {display_date(e['date'])} ({_when(e['days'])})",
                f"{s.quantity} seats" if s.quantity else "", s.vendor or "", _rupees(s.price),
                f"PO {s.po_no}" if s.po_no else ""]
        lines.append("  - " + " · ".join(b for b in bits if b))
        tone = "#b91c1c" if e["days"] < 0 else ("#b45309" if e["days"] <= DAILY_DAYS else "#111")
        cells = (s.asset_id, name, display_date(e["date"]), _when(e["days"]), s.quantity or "", s.vendor or "",
                 _rupees(s.price), s.po_no or "")
        rows.append("<tr>" + "".join(
            f"<td style='padding:4px 8px;border-bottom:1px solid #ddd;"
            f"{'color:' + tone + ';font-weight:600' if i == 3 else ''}'>{html.escape(str(v) or '—')}</td>"
            for i, v in enumerate(cells)) + "</tr>")
    head = "".join(f"<th style='padding:4px 8px;text-align:left;border-bottom:2px solid #333'>{h}</th>"
                   for h in ("ID", "Software", "Renewal date", "When", "Seats", "Vendor / Used By",
                             "Price", "PO Number"))
    return "\n".join(lines), (f"<table style='border-collapse:collapse;font-size:13px'>"
                              f"<thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>")


def _wrap(body: str) -> str:
    return (f"<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111'>{body}"
            "<p style='color:#777;font-size:12px;margin-top:24px'>Sent by IT Asset Engine. "
            "Renew the licence and update its Renewal Date to stop these reminders.</p></div>")


def _record(db: Session, entries: list[dict], stage: str, today: date, to: list[str]) -> None:
    for e in entries:
        db.add(RenewalNotice(software_id=e["item"].id, renewal_date=e["date"], stage=stage,
                             sent_on=today.isoformat(), sent_to=", ".join(to)[:1000]))
    db.commit()


def send_due(db: Session, cfg: NotificationSettings, today: date) -> list[str]:
    from app.approvals import _log
    todo = plan(db, today)
    cc = mailer.split_addresses(cfg.cc_emails)
    done: list[str] = []

    early = [(STAGE_30, todo[STAGE_30]), (STAGE_15, todo[STAGE_15])]
    if any(entries for _, entries in early):
        if not cc:
            n = sum(len(e) for _, e in early)
            _log(db, f"Software renewals: {n} licence(s) reached the 30/15-day notice, but "
                     "Also inform has no addresses -- nothing sent", ok=False)
        else:
            for stage, entries in early:
                if not entries:
                    continue
                text, table = _table(entries)
                n = len(entries)
                subject = (f"Software renewal reminder: {n} licence{'s' if n != 1 else ''} "
                           f"due within {stage} days")
                intro = (f"{'This licence comes' if n == 1 else 'These licences come'} up for renewal "
                         f"within {stage} days.")
                try:
                    mailer.send(cfg, cc, subject, f"{intro}\n\n{text}",
                                _wrap(f"<p>{html.escape(intro)}</p>{table}"))
                    _record(db, entries, stage, today, cc)
                    done.append(f"{stage}-day notice for {n} licence(s) to Also inform")
                    _log(db, f"Emailed the {stage}-day software renewal notice ({n}) to Also inform")
                except mailer.MailError as exc:
                    _log(db, f"Could not email the {stage}-day software renewal notice: {exc}", ok=False)

    daily = todo[STAGE_DAILY]
    if daily:
        if not cfg.it_head_email:
            _log(db, "Software renewals: licences are within 7 days of renewal, but there is no "
                     "IT head address -- nothing sent", ok=False)
        else:
            to = mailer.split_addresses(cfg.it_head_email)
            heads = {a.lower() for a in to}
            copy = [a for a in cc if a.lower() not in heads]
            text, table = _table(daily)
            n = len(daily)
            overdue = sum(1 for e in daily if e["days"] < 0)
            subject = (f"Software renewal: {n} licence{'s' if n != 1 else ''} due within "
                       f"{DAILY_DAYS} days" + (f" ({overdue} overdue)" if overdue else ""))
            intro = (f"{n} licence{'s' if n != 1 else ''} {'is' if n == 1 else 'are'} due for renewal "
                     f"within {DAILY_DAYS} days{f', {overdue} already overdue' if overdue else ''}. "
                     "This reminder is sent every day until the Renewal Date is updated.")
            try:
                mailer.send(cfg, to, subject, f"{intro}\n\n{text}",
                            _wrap(f"<p>{html.escape(intro)}</p>{table}"), cc=copy)
                _record(db, daily, STAGE_DAILY, today, to + copy)
                done.append(f"daily notice for {n} licence(s) to the IT head")
                _log(db, f"Emailed the daily software renewal notice ({n}) to the IT head"
                         + (" and Also inform" if copy else ""))
            except mailer.MailError as exc:
                _log(db, f"Could not email the daily software renewal notice: {exc}", ok=False)
    return done


def claim_day(db: Session, today: str) -> bool:
    result = db.execute(sql_text(
        "UPDATE notification_settings SET last_renewal_on = :d "
        "WHERE id = 1 AND (last_renewal_on IS NULL OR last_renewal_on <> :d)"), {"d": today})
    db.commit()
    return result.rowcount == 1


def due(cfg: Optional[NotificationSettings], now_local: datetime) -> bool:
    if cfg is None or not cfg.renewal_enabled or not mailer.configured(cfg):
        return False
    if cfg.last_renewal_on == now_local.date().isoformat():
        return False
    return now_local.strftime("%H:%M") >= (cfg.renewal_time or "09:00")


def run_if_due(now: Optional[datetime] = None) -> None:
    from app.approvals import _session
    now = now or datetime.now(timezone.utc)
    now_local = to_ist(now)
    with _session() as db:
        cfg = db.get(NotificationSettings, 1)
        if not due(cfg, now_local) or not claim_day(db, now_local.date().isoformat()):
            return
        send_due(db, cfg, now_local.date())


def preview(db: Session, today: Optional[date] = None) -> dict[str, Any]:
    today = today or today_ist()
    todo = plan(db, today)

    def brief(e):
        s = e["item"]
        return {"id": s.id, "assetId": s.asset_id, "name": " ".join(x for x in (s.asset_tag, s.version) if x),
                "renewalDate": e["date"], "days": e["days"], "vendor": s.vendor or ""}

    upcoming = []
    for s in watched(db):
        days = _days_left(s, today)
        if days is not None and stage_for(days):
            upcoming.append({**brief({"item": s, "days": days, "date": s.warranty_end}),
                             "stage": stage_for(days)})
    upcoming.sort(key=lambda u: u["days"])
    return {
        "today": today.isoformat(),
        "toSend": {stage: [brief(e) for e in entries] for stage, entries in todo.items()},
        "upcoming": upcoming,
    }

