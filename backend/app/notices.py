import html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud, mailer, registers, roles
from app.datefmt import DAY_TIME, now_ist
from app.models import User

logger = logging.getLogger(__name__)

TABLE_LIMIT = 200

PLACE_KEYS = ("location", "floor", "user", "email")

_TD = "padding:4px 8px;border-bottom:1px solid #ddd"
_TH = "padding:4px 8px;text-align:left;border-bottom:2px solid #333"


def _settings(db: Session):
    from app.approvals import get_settings
    return get_settings(db)


def _now() -> str:
    return now_ist().strftime(DAY_TIME)


def _same(a: Any, b: Any) -> bool:
    return " ".join(str(a or "").split()).lower() == " ".join(str(b or "").split()).lower()


def where(item) -> dict[str, Any]:
    return {k: getattr(item, k, None) for k in PLACE_KEYS}


def assignee_email(db: Session, item) -> Optional[str]:
    holder = str(getattr(item, "user", None) or "").strip()
    if not holder:
        return None
    own = str(getattr(item, "email", None) or "").strip()
    if own and crud.EMAIL_RE.match(own):
        return own
    from app.joiners import account_for
    account = account_for(db, holder, None)
    return account.email if account is not None and account.email else None


def _place(snap: dict) -> str:
    bits = [snap.get("location") or "no location"]
    if snap.get("floor"):
        bits.append(f"floor {snap['floor']}")
    return ", ".join(bits)


def _deliver(flag: str, subject: str, text: str, body: str, people: Iterable[Any],
             logged: str, target: str) -> None:
    from app.approvals import _log, _session, _wrap, get_settings, recipients
    with _session() as db:
        cfg = get_settings(db)
        if not getattr(cfg, flag) or not cfg.it_head_email or not mailer.configured(cfg):
            return
        to, cc = recipients(cfg, *people)
        try:
            mailer.send(cfg, to, subject, text, _wrap(body), cc=cc)
            _log(db, f"Emailed the IT head: {logged}", target[:200])
        except mailer.MailError as exc:
            _log(db, f"Could not email the IT head that {logged}: {exc}", target[:200], ok=False)


def transferred(db: Session, item, was: dict, actor: str, onto=None) -> bool:
    if not _settings(db).transfer_enabled:
        return False
    now = where(item)
    if all(_same(was.get(k), now.get(k)) for k in ("location", "floor", "user")):
        return False

    reg = registers.of(item)
    holder_item = onto if onto is not None else item
    holder = str(getattr(holder_item, "user", None) or "").strip()
    email = assignee_email(db, holder_item)
    label = " · ".join(str(v) for v in (item.asset_id, item.asset_tag, item.model) if v)

    facts = [(reg.noun.capitalize(), label),
             ("Srl No.", item.srl),
             ("From", _place(was) + (f" — {was['user']}" if was.get("user") else "")),
             ("To", _place(now) + (f" — {now['user']}" if now.get("user") else ""))]
    if onto is not None:
        facts.append(("Now on", " · ".join(str(v) for v in (onto.asset_id, onto.asset_tag) if v)
                      + (f" — {holder}" if holder else "")))
    facts += [("Assignee's email", email), ("Transferred by", actor), ("When", _now())]
    facts = [(k, v) for k, v in facts if v]

    dest = holder or _place(now)
    subject = f"Transferred: {item.asset_id} {item.asset_tag or ''} to {dest}".replace("  ", " ")
    text = (f"{item.asset_id} has been transferred.\n\n"
            + "\n".join(f"{k}: {v}" for k, v in facts))
    body = (f"<p><b>{html.escape(item.asset_id)}</b> has been transferred.</p>"
            "<table style='font-size:13px'>"
            + "".join(f"<tr><td style='padding:2px 12px 2px 0;color:#555'>{html.escape(k)}</td>"
                      f"<td>{html.escape(str(v))}</td></tr>" for k, v in facts)
            + "</table>")
    mailer.run_in_background(_deliver, "transfer_enabled", subject, text, body, [email],
                             f"{actor} transferred {item.asset_id} to {dest}", item.asset_id)
    return True


HOW = {
    "entered": "added from Data Entry",
    "uploaded": "uploaded",
    "verified": "accepted from Verification",
    "sap_id": "given a SAP ID, so accepted without verification",
}


def _count(items: list) -> str:
    out = []
    for reg in registers.ALL:
        n = sum(1 for i in items if registers.of(i) is reg)
        if n:
            out.append(f"{n} {reg.noun if n == 1 else reg.plural}")
    return ", ".join(out)


def _registration_mail(items: list, who: str, verb: str) -> tuple[str, str, str, str, str]:
    items = sorted(items, key=lambda i: ((i.po_no or "").strip().lower() or "￿", i.asset_id or ""))
    shown = items[:TABLE_LIMIT]
    cols = ("ID", "Name", "Type", "Model", "Srl No.", "PO No.", "Location", "Assigned to", "Entered by")
    rows = [(i.asset_id, i.asset_tag, i.type, i.model, i.srl, i.po_no, i.location,
             getattr(i, "user", None), i.created_by) for i in shown]
    more = len(items) - len(shown)
    what = _count(items)

    by_po: dict[str, list] = {}
    for i in items:
        by_po.setdefault((i.po_no or "").strip() or "no PO number", []).append(i)
    po_line = ("; ".join(f"{po}: {_count(group)}" for po, group in by_po.items())
               if any((i.po_no or "").strip() for i in items) else "")

    subject = f"New in the register: {what} ({verb} by {who})"
    lines = [" · ".join(str(v) for v in r if v) for r in rows]
    text = (f"{what} {'was' if len(items) == 1 else 'were'} {verb} by {who} ({_now()}).\n"
            + (f"By PO number -- {po_line}\n" if po_line else "") + "\n"
            + "\n".join(f"  - {line}" for line in lines)
            + (f"\n  ... and {more} more -- see the Report page." if more else ""))
    head = "".join(f"<th style='{_TH}'>{h}</th>" for h in cols)
    body_rows = "".join("<tr>" + "".join(f"<td style='{_TD}'>{html.escape(str(v or '—'))}</td>"
                                         for v in r) + "</tr>" for r in rows)
    body = (f"<p><b>{html.escape(what)}</b> {'was' if len(items) == 1 else 'were'} {html.escape(verb)} "
            f"by <b>{html.escape(who)}</b> ({_now()}).</p>"
            + (f"<p style='color:#333'>By PO number — {html.escape(po_line)}</p>" if po_line else "")
            + f"<table style='border-collapse:collapse;font-size:13px'><thead><tr>{head}</tr></thead>"
            f"<tbody>{body_rows}</tbody></table>"
            + (f"<p>… and {more} more — see the Report page.</p>" if more else ""))
    ids = ", ".join(i.asset_id for i in items[:5]) + (" …" if len(items) > 5 else "")
    return subject, text, body, f"{what} {verb} by {who}", ids


def registered(db: Session, items: list, actor: str, how: str) -> bool:
    if not _settings(db).registration_enabled:
        return False
    items = [i for i in items if crud.is_verified(i) and not getattr(i, "is_deleted", False)]
    if not items:
        return False

    if how == "verified":
        from app.models import RegistrationQueue
        for i in items:
            db.add(RegistrationQueue(register=registers.of(i).key, item_id=i.id, actor=actor))
        db.commit()
        return True

    subject, text, body, logged, ids = _registration_mail(items, actor, HOW.get(how, how))
    mailer.run_in_background(_deliver, "registration_enabled", subject, text, body, [], logged, ids)
    return True


DIGEST_QUIET_MINUTES = 10
DIGEST_MAX_HOLD_MINUTES = 60
DIGEST_STALE_CLAIM_MINUTES = 180


def send_registration_digest(now: Optional[datetime] = None) -> int:
    import uuid

    from sqlalchemy import delete, or_, update

    from app.approvals import _aware, _bound, _session
    from app.models import RegistrationQueue
    now = now or datetime.now(timezone.utc)
    with _session() as db:
        open_rows = db.execute(select(RegistrationQueue).where(RegistrationQueue.claim.is_(None))
                               ).scalars().all()
        if not open_rows:
            return 0
        newest = max(_aware(r.queued_at) for r in open_rows)
        oldest = min(_aware(r.queued_at) for r in open_rows)
        if (now - newest < timedelta(minutes=DIGEST_QUIET_MINUTES)
                and now - oldest < timedelta(minutes=DIGEST_MAX_HOLD_MINUTES)):
            return 0

        claim = str(uuid.uuid4())
        stale = _bound(db, now - timedelta(minutes=DIGEST_STALE_CLAIM_MINUTES))
        db.execute(update(RegistrationQueue)
                   .where(or_(RegistrationQueue.claim.is_(None), RegistrationQueue.queued_at < stale))
                   .values(claim=claim))
        db.commit()
        mine = db.execute(select(RegistrationQueue).where(RegistrationQueue.claim == claim)
                          .order_by(RegistrationQueue.queued_at)).scalars().all()

        items, seen, actors = [], set(), []
        for row in mine:
            reg = registers.by_key(row.register)
            item = crud.get_asset(db, row.item_id, reg) if reg is not None else None
            if (item is None or item.id in seen or not crud.is_verified(item)
                    or getattr(item, "is_deleted", False)):
                continue
            seen.add(item.id)
            items.append(item)
            if row.actor not in actors:
                actors.append(row.actor)

        sent = 0
        if items and _settings(db).registration_enabled:
            who = actors[0] if len(actors) == 1 else ", ".join(actors[:-1]) + " and " + actors[-1]
            subject, text, body, logged, ids = _registration_mail(items, who, HOW["verified"])
            _deliver("registration_enabled", subject, text, body, [], logged, ids)
            sent = len(items)
        db.execute(delete(RegistrationQueue).where(RegistrationQueue.claim == claim))
        db.commit()
        return sent


WAITING_HOW = {
    "entered": "added from Data Entry",
    "uploaded": "uploaded",
    "resubmitted": "corrected and resubmitted",
}


def _verification_link(cfg) -> str:
    return f"{cfg.app_base_url}/verification" if cfg.app_base_url else ""


def _deliver_to(flag: str, to: list, subject: str, text: str, body: str,
                logged: str, target: str) -> None:
    from app.approvals import _log, _session, _wrap, get_settings
    with _session() as db:
        cfg = get_settings(db)
        if not getattr(cfg, flag) or not mailer.configured(cfg) or not to:
            return
        link = _verification_link(cfg)
        if link:
            text += f"\n\nOpen Verification: {link}"
            body += (f"<p><a href='{html.escape(link)}' style='display:inline-block;padding:8px 16px;"
                     "border-radius:6px;background:#1f6f4a;color:#fff;text-decoration:none;"
                     "font-weight:600'>Open Verification</a></p>")
        try:
            mailer.send(cfg, to, subject, text, _wrap(body))
            _log(db, f"Emailed {', '.join(to)[:150]}: {logged}", target[:200])
        except mailer.MailError as exc:
            _log(db, f"Could not email about {logged}: {exc}", target[:200], ok=False)


def verifier_addresses(db: Session, exclude: set[str]) -> list[str]:
    out: list[str] = []
    for u in db.execute(select(User).where(User.role.in_(sorted(roles.VERIFY_ROLES)))).scalars():
        mail = (u.email or "").strip()
        if (u.is_active and mail and crud.EMAIL_RE.match(mail)
                and u.username.lower() not in exclude
                and mail.lower() not in {a.lower() for a in out}):
            out.append(mail)
    return out


def awaiting_verification(db: Session, items: list, actor: str, how: str) -> bool:
    if not _settings(db).verification_enabled:
        return False
    items = [i for i in items if getattr(i, "verification", None) == crud.PENDING]
    if not items:
        return False
    entrants = {(i.created_by or "").lower() for i in items} | {(actor or "").lower()}
    to = verifier_addresses(db, entrants)
    if not to:
        return False

    shown = items[:TABLE_LIMIT]
    cols = ("ID", "Name", "Type", "Model", "Srl No.", "Location", "Entered by")
    rows = [(i.asset_id, i.asset_tag, i.type, i.model, i.srl, i.location, i.created_by) for i in shown]
    more = len(items) - len(shown)
    what = _count(items)
    verb = WAITING_HOW.get(how, how)
    resubmitted = how == "resubmitted"
    notes = [i.verification_note for i in items if resubmitted and i.verification_note]

    subject = (f"Waiting for verification: {what} ({verb} by {actor})")
    lines = [" · ".join(str(v) for v in r if v) for r in rows]
    text = (f"{what} {'was' if len(items) == 1 else 'were'} {verb} by {actor} and "
            f"{'is' if len(items) == 1 else 'are'} waiting for verification ({_now()}).\n"
            + (f"It had been sent back: {notes[0]}\n" if notes else "")
            + "\n" + "\n".join(f"  - {line}" for line in lines)
            + (f"\n  ... and {more} more." if more else "")
            + "\n\nSomeone other than the person who entered it has to verify it.")
    head = "".join(f"<th style='{_TH}'>{h}</th>" for h in cols)
    body_rows = "".join("<tr>" + "".join(f"<td style='{_TD}'>{html.escape(str(v or '—'))}</td>"
                                         for v in r) + "</tr>" for r in rows)
    body = (f"<p><b>{html.escape(what)}</b> {'was' if len(items) == 1 else 'were'} {html.escape(verb)} "
            f"by <b>{html.escape(actor)}</b> and {'is' if len(items) == 1 else 'are'} waiting for "
            f"verification ({_now()}).</p>"
            + (f"<p>It had been sent back: <i>{html.escape(notes[0])}</i></p>" if notes else "")
            + f"<table style='border-collapse:collapse;font-size:13px'><thead><tr>{head}</tr></thead>"
            f"<tbody>{body_rows}</tbody></table>"
            + (f"<p>… and {more} more.</p>" if more else "")
            + "<p style='color:#555;font-size:12px'>Someone other than the person who entered it "
              "has to verify it.</p>")
    ids = ", ".join(i.asset_id for i in items[:5]) + (" …" if len(items) > 5 else "")
    mailer.run_in_background(_deliver_to, "verification_enabled", to, subject, text, body,
                             f"{what} waiting for verification", ids)
    return True


def sent_back(db: Session, item, actor: str, reason: str) -> bool:
    if not _settings(db).verification_enabled:
        return False
    entrant = (item.created_by or "").strip()
    account = crud.find_user_by_username(db, entrant) if entrant else None
    mail = (getattr(account, "email", None) or "").strip()
    if not mail or not crud.EMAIL_RE.match(mail):
        from app.approvals import _log
        _log(db, f"Not emailed: {item.asset_id} was sent back, but {entrant or 'whoever entered it'} "
                 "has no email address on file", item.asset_id, ok=False)
        return False

    label = " · ".join(str(v) for v in (item.asset_id, item.asset_tag, item.model) if v)
    subject = f"Sent back for correction: {item.asset_id} {item.asset_tag or ''}".strip()
    text = (f"{actor} sent back {label}, which you entered, for correction.\n\n"
            f"Reason: {reason}\n\n"
            "It stays on hold in Verification until you correct it there (Correct & resubmit); "
            "nobody can verify it until then.")
    body = (f"<p><b>{html.escape(actor)}</b> sent back <b>{html.escape(label)}</b>, which you "
            "entered, for correction.</p>"
            f"<p style='padding:8px 12px;border-left:3px solid #b54708;background:#fffaeb'>"
            f"{html.escape(reason)}</p>"
            "<p>It stays on hold in Verification until you correct it there "
            "(<b>Correct &amp; resubmit</b>); nobody can verify it until then.</p>")
    mailer.run_in_background(_deliver_to, "verification_enabled", [mail], subject, text, body,
                             f"{item.asset_id} sent back to {entrant}", item.asset_id)
    return True

