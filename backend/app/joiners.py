import html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud, mailer, registers
from app.datefmt import DAY, DAY_TIME, display_date, now_ist, to_ist
from app.models import AssetEvent, User

logger = logging.getLogger(__name__)

DEFAULT_DAYS = 7


def _norm(value: Any) -> str:
    return " ".join(str(value or "").split()).lower()


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def account_for(db: Session, holder: Any, email: Any) -> Optional[User]:
    users = list(db.execute(select(User)).scalars().all())
    mail = _norm(email)
    if mail:
        by_mail = [u for u in users if _norm(u.email) == mail]
        if len(by_mail) == 1:
            return by_mail[0]
    name = _norm(crud.clean_person_name(holder) or holder)
    by_name = [u for u in users if name and _norm(u.full_name) == name]
    return by_name[0] if len(by_name) == 1 else None


def is_new_joiner(account: Optional[User], handed_at: datetime, days: int) -> bool:
    created = _aware(getattr(account, "created_at", None))
    if account is None or created is None:
        return False
    return handed_at - timedelta(days=days) <= created <= handed_at + timedelta(minutes=5)


def came_by_upload(db: Session, item) -> bool:
    return db.execute(
        select(AssetEvent.id).where(AssetEvent.asset_pk == item.id,
                                    AssetEvent.register == registers.of(item).key,
                                    AssetEvent.action == crud.EVENT_IMPORTED).limit(1)
    ).first() is not None


def handovers(items_before: list[tuple[Any, Any]]) -> list:
    out = []
    for item, before in items_before:
        if registers.of(item) is not registers.ASSETS or not crud.is_verified(item):
            continue
        if crud.is_sold(item.status):
            continue
        holder = str(item.user or "").strip()
        if holder and not crud._same_person(before, holder):
            out.append(item)
    return out


def check(db: Session, items_before: list[tuple[Any, Any]], actor: str,
          *, skip_uploads: bool = False) -> int:
    from app.approvals import get_settings
    cfg = get_settings(db)
    if not cfg.joiner_enabled:
        return 0
    days = cfg.joiner_days or DEFAULT_DAYS
    now = datetime.now(timezone.utc)

    by_person: dict[str, dict] = {}
    for item in handovers(items_before):
        if skip_uploads and came_by_upload(db, item):
            continue
        account = account_for(db, item.user, item.email)
        if not is_new_joiner(account, now, days):
            continue
        entry = by_person.setdefault(account.id, {
            "name": account.full_name, "email": account.email or item.email,
            "location": account.location,
            "username": account.username, "joined": account.date_of_joining,
            "created": _aware(account.created_at).isoformat(), "items": []})
        entry["items"].append({k: getattr(item, k, None) for k in
                               ("asset_id", "asset_tag", "type", "model", "srl", "location", "department")})

    for person in by_person.values():
        mailer.run_in_background(_send, person, actor, days)
    return len(by_person)


def _send(person: dict, actor: str, days: int) -> None:
    from app.approvals import _log, _session, _wrap, get_settings, recipients
    with _session() as db:
        cfg = get_settings(db)
        to, cc = recipients(cfg, person["email"])
        if not cfg.joiner_enabled or not cfg.it_head_email or not mailer.configured(cfg):
            return
        items = person["items"]
        ids = ", ".join(i["asset_id"] or "" for i in items)
        created = to_ist(datetime.fromisoformat(person["created"])).strftime(DAY)
        subject = f"New joiner handed {'an asset' if len(items) == 1 else f'{len(items)} assets'}: " \
                  f"{person['name']} ({ids})"
        facts = [("Name", person["name"]), ("Email", person["email"]), ("Location", person["location"]),
                 ("Date of joining", display_date(person["joined"])), ("Added to the app", created),
                 ("Handed over by", actor),
                 ("When", now_ist().strftime(DAY_TIME))]
        lines = [f"{k}: {v}" for k, v in facts if v]
        rows = "".join(
            "<tr>" + "".join(f"<td style='padding:4px 8px;border-bottom:1px solid #ddd'>{html.escape(str(v or '—'))}</td>"
                             for v in (i["asset_id"], i["asset_tag"], i["type"], i["model"], i["srl"]))
            + "</tr>" for i in items)
        head = "".join(f"<th style='padding:4px 8px;text-align:left;border-bottom:2px solid #333'>{h}</th>"
                       for h in ("ID", "Name", "Type", "Model", "Srl No."))
        text = (f"{person['name']} -- a new joiner -- has been handed "
                f"{'an asset' if len(items) == 1 else f'{len(items)} assets'}.\n\n"
                + "\n".join(lines) + "\n\n"
                + "\n".join(f"  - {i['asset_id']} · {i['asset_tag'] or ''} · {i['model'] or ''}"
                            + (f" · Srl {i['srl']}" if i["srl"] else "") for i in items)
                + f"\n\n(A new joiner here means their record was created within {days} days "
                  "of the hand-over.)")
        body = (f"<p><b>{html.escape(person['name'])}</b> — a new joiner — has been handed "
                f"{'an asset' if len(items) == 1 else f'{len(items)} assets'}.</p>"
                "<table style='font-size:13px;margin-bottom:12px'>"
                + "".join(f"<tr><td style='padding:2px 12px 2px 0;color:#555'>{html.escape(k)}</td>"
                          f"<td>{html.escape(str(v))}</td></tr>" for k, v in facts if v)
                + "</table>"
                f"<table style='border-collapse:collapse;font-size:13px'><thead><tr>{head}</tr></thead>"
                f"<tbody>{rows}</tbody></table>"
                f"<p style='color:#555;font-size:12px'>A new joiner here means their record was "
                f"created within {days} days of the hand-over.</p>")
        try:
            mailer.send(cfg, to, subject, text, _wrap(body), cc=cc)
            _log(db, f"Emailed the IT head: new joiner {person['name']} handed {ids}", ids[:200])
        except mailer.MailError as exc:
            _log(db, f"Could not email the IT head about new joiner {person['name']}: {exc}",
                 ids[:200], ok=False)

