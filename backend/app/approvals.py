import hashlib
import html
import json
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app import crud, mailer, registers
from app.datefmt import DAY, DAY_TIME, to_ist
from app.models import ApprovalRequest, ApprovalToken, NotificationSettings

logger = logging.getLogger(__name__)

MODES = ("off", "inform", "approve")
SECURITY = ("starttls", "ssl", "none")
TOKEN_DAYS = 7
SCRAP, SALE = "scrap", "sale"
PENDING, APPROVED, REJECTED, WITHDRAWN, FAILED = (
    "pending", "approved", "rejected", "withdrawn", "failed")
KIND_WORD = {SCRAP: "scrap", SALE: "sale"}
SNAPSHOT_FIELDS = ("asset_id", "asset_tag", "model", "srl", "status", "user", "location")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _bound(db: Session, moment: datetime) -> datetime:
    if db.get_bind().dialect.name == "sqlite":
        return moment.astimezone(timezone.utc).replace(tzinfo=None)
    return moment


def _local(value: Optional[datetime]) -> str:
    value = _aware(value)
    return to_ist(value).strftime(DAY_TIME) if value else ""


def is_sold(status: Any) -> bool:
    return "SOLD" in str(status or "").upper()


def get_settings(db: Session) -> NotificationSettings:
    row = db.get(NotificationSettings, 1)
    if row is None:
        row = NotificationSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def current_mode(db: Session) -> str:
    row = db.get(NotificationSettings, 1)
    return row.mode if row and row.mode in MODES else "off"


def _next_export(row) -> Optional[str]:
    from app import data_export
    return data_export.next_due(row)


def settings_dict(row: NotificationSettings) -> dict[str, Any]:
    return {
        "mode": row.mode,
        "itHeadEmail": row.it_head_email or "",
        "ccEmails": row.cc_emails or "",
        "smtpHost": row.smtp_host or "",
        "smtpPort": row.smtp_port or 587,
        "smtpSecurity": row.smtp_security or "starttls",
        "smtpUsername": row.smtp_username or "",
        "passwordSaved": bool(row.smtp_password_enc),
        "fromAddress": row.from_address or "",
        "appBaseUrl": row.app_base_url or "",
        "summaryEnabled": bool(row.summary_enabled),
        "summaryTime": row.summary_time or "18:00",
        "lastSummaryOn": row.last_summary_on,
        "joinerEnabled": bool(row.joiner_enabled),
        "joinerDays": row.joiner_days or 7,
        "transferEnabled": bool(row.transfer_enabled),
        "registrationEnabled": bool(row.registration_enabled),
        "verificationEnabled": bool(row.verification_enabled),
        "renewalEnabled": bool(getattr(row, "renewal_enabled", False)),
        "renewalTime": getattr(row, "renewal_time", None) or "09:00",
        "lastRenewalOn": getattr(row, "last_renewal_on", None),
        "exportEnabled": bool(getattr(row, "export_enabled", False)),
        "exportRecipients": getattr(row, "export_recipients", None) or "",
        "exportIntervalDays": getattr(row, "export_interval_days", None) or 7,
        "exportTime": getattr(row, "export_time", None) or "09:00",
        "lastExportOn": getattr(row, "last_export_on", None),
        "nextExportOn": _next_export(row),
        "exportClearActivity": bool(getattr(row, "export_clear_activity", False)),
        "activityClearedAt": getattr(row, "activity_cleared_at", None),
        "updatedBy": row.updated_by,
        "updatedAt": _aware(row.updated_at).isoformat() if row.updated_at else None,
    }


def update_settings(db: Session, data: dict, username: str) -> tuple[Optional[NotificationSettings], list[str]]:
    row = get_settings(db)
    errors: list[str] = []

    def text(key, current, limit=255):
        if key not in data:
            return current
        value = str(data.get(key) or "").strip()
        return value[:limit] or None

    mode = data.get("mode", row.mode)
    if mode not in MODES:
        errors.append(f"mode must be one of {', '.join(MODES)}")
    it_head = text("itHeadEmail", row.it_head_email, 4000)
    heads = mailer.split_addresses(it_head)
    for addr in heads:
        if not crud.EMAIL_RE.match(addr):
            errors.append(f"{addr!r} in the IT head's email is not a valid email address.")
    it_head = ", ".join(heads) or None
    if len(it_head or "") > 255:
        errors.append("The IT head's email holds too many addresses (255 characters at most) -- "
                      "use a distribution list for a long one.")
    cc = text("ccEmails", row.cc_emails, 4000)
    host = text("smtpHost", row.smtp_host)
    username_ = text("smtpUsername", row.smtp_username)
    sender = text("fromAddress", row.from_address)
    base = text("appBaseUrl", row.app_base_url, 500)
    security = data.get("smtpSecurity", row.smtp_security) or "starttls"
    if security not in SECURITY:
        errors.append(f"smtpSecurity must be one of {', '.join(SECURITY)}")
    try:
        port = int(data.get("smtpPort", row.smtp_port) or 587)
        if not 1 <= port <= 65535:
            raise ValueError
    except (TypeError, ValueError):
        errors.append("The SMTP port must be a number from 1 to 65535.")
        port = row.smtp_port
    summary_time = str(data.get("summaryTime", row.summary_time) or "18:00").strip()
    try:
        datetime.strptime(summary_time, "%H:%M")
    except ValueError:
        errors.append("The summary time must be HH:MM, e.g. 18:00.")

    renewal_on = bool(data.get("renewalEnabled", row.renewal_enabled))
    renewal_time = str(data.get("renewalTime", row.renewal_time) or "09:00").strip()
    try:
        datetime.strptime(renewal_time, "%H:%M")
    except ValueError:
        errors.append("The renewal reminder time must be HH:MM, e.g. 09:00.")

    export_on = bool(data.get("exportEnabled", row.export_enabled))
    export_to = text("exportRecipients", row.export_recipients, 4000)
    export_time = str(data.get("exportTime", row.export_time) or "09:00").strip()
    try:
        datetime.strptime(export_time, "%H:%M")
    except ValueError:
        errors.append("The data export time must be HH:MM, e.g. 09:00.")
    try:
        raw_days = data.get("exportIntervalDays", row.export_interval_days)
        export_days = int(7 if raw_days in (None, "") else raw_days)
        if not 1 <= export_days <= 365:
            raise ValueError
    except (TypeError, ValueError):
        errors.append("Send the data export every 1 to 365 days.")
        export_days = row.export_interval_days
    for addr in mailer.split_addresses(export_to):
        if not crud.EMAIL_RE.match(addr):
            errors.append(f"{addr!r} in the data export's recipients is not a valid email address.")
    if len(", ".join(mailer.split_addresses(export_to))) > 1000:
        errors.append("The data export has too many recipients (1000 characters at most) -- "
                      "use a distribution list for a long one.")
    if export_on:
        if not mailer.split_addresses(export_to):
            errors.append("Add at least one address to send the data export to.")
        if not host or not (sender or username_):
            errors.append("Enter the mail server and the sender mailbox before turning on "
                          "the data export.")

    joiner_on = bool(data.get("joinerEnabled", row.joiner_enabled))
    transfer_on = bool(data.get("transferEnabled", row.transfer_enabled))
    registration_on = bool(data.get("registrationEnabled", row.registration_enabled))
    verification_on = bool(data.get("verificationEnabled", row.verification_enabled))
    try:
        joiner_days = int(data.get("joinerDays", row.joiner_days) or 7)
        if not 1 <= joiner_days <= 90:
            raise ValueError
    except (TypeError, ValueError):
        errors.append("The new-joiner window must be 1 to 90 days.")
        joiner_days = row.joiner_days
    notices_on = [name for name, on in (("transfer", transfer_on),
                                        ("new registration", registration_on),
                                        ("new joiner", joiner_on),
                                        ("software renewal", renewal_on)) if on]
    if notices_on:
        names = ", ".join(notices_on)
        if not it_head:
            errors.append(f"Enter the IT head's email address to turn on the {names} email.")
        if not host or not (sender or username_):
            errors.append(f"Enter the mail server and the sender mailbox before turning on "
                          f"the {names} email.")
    if verification_on and not notices_on and (not host or not (sender or username_)):
        errors.append("Enter the mail server and the sender mailbox before turning on "
                      "the verification emails.")

    if sender and not crud.EMAIL_RE.match(sender):
        errors.append("Sender address is not a valid email address.")
    for addr in mailer.split_addresses(cc):
        if not crud.EMAIL_RE.match(addr):
            errors.append(f"{addr!r} in Also inform is not a valid email address.")
    if len(", ".join(mailer.split_addresses(cc))) > 1000:
        errors.append("Also inform holds too many addresses (1000 characters at most) -- "
                      "use a distribution list for a long one.")
    if base and not base.lower().startswith(("http://", "https://")):
        errors.append("The app address must start with http:// or https://.")

    if mode in ("inform", "approve"):
        if not it_head:
            errors.append("Enter the IT head's email address before turning this on.")
        if not host or not (sender or username_):
            errors.append("Enter the mail server and the sender mailbox before turning this on.")
    if mode == "approve" and not base:
        errors.append("Enter the address this app is opened at -- the approval links point there.")

    if errors:
        return None, errors

    row.mode = mode
    row.it_head_email, row.cc_emails = it_head, ", ".join(mailer.split_addresses(cc)) or None
    row.smtp_host, row.smtp_port, row.smtp_security = host, port, security
    row.smtp_username, row.from_address = username_, sender
    row.app_base_url = base.rstrip("/") if base else None
    row.summary_enabled = bool(data.get("summaryEnabled", row.summary_enabled))
    row.summary_time = summary_time
    row.joiner_enabled, row.joiner_days = joiner_on, joiner_days
    row.transfer_enabled, row.registration_enabled = transfer_on, registration_on
    row.verification_enabled = verification_on
    row.renewal_enabled, row.renewal_time = renewal_on, renewal_time
    row.export_enabled = export_on
    row.export_recipients = ", ".join(mailer.split_addresses(export_to)) or None
    row.export_interval_days, row.export_time = export_days, export_time
    row.export_clear_activity = bool(data.get("exportClearActivity", row.export_clear_activity))
    if data.get("clearPassword"):
        row.smtp_password_enc = None
    elif str(data.get("smtpPassword") or ""):
        row.smtp_password_enc = mailer.encrypt(str(data["smtpPassword"]))
    row.updated_by = username
    db.commit()
    db.refresh(row)
    return row, []


def _pending(db: Session, register=None) -> list[ApprovalRequest]:
    q = select(ApprovalRequest).where(ApprovalRequest.status == PENDING)
    if register is not None:
        q = q.where(ApprovalRequest.register == register.key)
    return list(db.execute(q).scalars().all())


def pending_map(db: Session, register) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for req in _pending(db, register):
        for item_id in json.loads(req.item_ids or "[]"):
            out[item_id] = {"requestId": req.id, "kind": req.kind,
                            "requestedBy": req.requested_by,
                            "requestedAt": _aware(req.requested_at).isoformat()}
    return out


def frozen_error(db: Session, item) -> Optional[str]:
    for req in _pending(db, registers.of(item)):
        if item.id in json.loads(req.item_ids or "[]"):
            return (f"{item.asset_id} is waiting for the IT head to approve its "
                    f"{KIND_WORD[req.kind]} (asked by {req.requested_by}). It cannot be changed "
                    "until that is approved, rejected or withdrawn.")
    return None


def first_frozen_error(db: Session, items) -> Optional[str]:
    for item in items:
        problem = frozen_error(db, item)
        if problem:
            return problem
    return None


def snapshot(item) -> dict[str, Any]:
    return {"id": item.id, **{k: getattr(item, k, None) for k in SNAPSHOT_FIELDS}}


def create_request(db: Session, *, kind: str, register, items: list, user,
                   reason: str = "", changes: Optional[dict] = None) -> ApprovalRequest:
    req = ApprovalRequest(
        kind=kind,
        register=register.key,
        item_ids=json.dumps([i.id for i in items]),
        items=json.dumps([snapshot(i) for i in items], default=str),
        changes=json.dumps(changes or {}, default=str),
        reason=(reason or "").strip()[:500] or None,
        requested_by=user.username,
        requested_by_email=getattr(user, "email", None),
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    mailer.run_in_background(send_request_email, req.id)
    return req


def request_dict(req: ApprovalRequest, with_items: bool = True) -> dict[str, Any]:
    items = json.loads(req.items or "[]")
    out = {
        "id": req.id,
        "kind": req.kind,
        "register": req.register,
        "count": len(items),
        "reason": req.reason,
        "requestedBy": req.requested_by,
        "requestedAt": _aware(req.requested_at).isoformat() if req.requested_at else None,
        "status": req.status,
        "decidedAt": _aware(req.decided_at).isoformat() if req.decided_at else None,
        "decidedBy": req.decided_by,
        "decisionNote": req.decision_note,
        "outcome": req.outcome,
        "changes": json.loads(req.changes or "{}"),
    }
    if with_items:
        out["items"] = [{"id": i.get("id"), "assetId": i.get("asset_id"), "name": i.get("asset_tag"),
                         "model": i.get("model"), "srl": i.get("srl"), "status": i.get("status"),
                         "user": i.get("user"), "location": i.get("location")} for i in items]
    return out


def list_requests(db: Session, limit: int = 100) -> list[ApprovalRequest]:
    pending = _pending(db)
    recent = db.execute(
        select(ApprovalRequest).where(ApprovalRequest.status != PENDING)
        .order_by(ApprovalRequest.requested_at.desc()).limit(limit)
    ).scalars().all()
    pending.sort(key=lambda r: _aware(r.requested_at), reverse=True)
    return pending + list(recent)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(db: Session, req: ApprovalRequest) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(ApprovalToken(request_id=req.id, token_hash=_hash(raw),
                         expires_at=_utcnow() + timedelta(days=TOKEN_DAYS)))
    db.commit()
    return raw


def resolve_token(db: Session, raw: str) -> tuple[Optional[ApprovalRequest], Optional[ApprovalToken], Optional[str]]:
    token = db.execute(select(ApprovalToken).where(ApprovalToken.token_hash == _hash(raw or ""))
                       ).scalars().first() if raw else None
    if token is None:
        return None, None, "This link is not valid. Use the link in the most recent email."
    req = db.get(ApprovalRequest, token.request_id)
    if req is None:
        return None, token, "This request no longer exists."
    if req.status != PENDING:
        return req, token, f"This request was already {req.status}."
    if token.used_at is not None:
        return req, token, "This link has already been used."
    if _aware(token.expires_at) < _utcnow():
        return req, token, ("This link has expired. The request is still waiting -- "
                            "the next daily summary carries a new link.")
    return req, token, None


def _kill_tokens(db: Session, req: ApprovalRequest) -> None:
    now = _utcnow()
    for t in db.execute(select(ApprovalToken).where(ApprovalToken.request_id == req.id,
                                                    ApprovalToken.used_at.is_(None))).scalars():
        t.used_at = now


def _apply(db: Session, req: ApprovalRequest) -> tuple[str, str]:
    reg = registers.by_key(req.register)
    actor = f"{req.requested_by} (approved by IT head)"[:150]
    changes = json.loads(req.changes or "{}")
    link_ids = changes.pop("linkedPeripheralIds", None)
    done, skipped = [], []
    labels = {i["id"]: i.get("asset_id") or i["id"] for i in json.loads(req.items or "[]")}

    for item_id in json.loads(req.item_ids or "[]"):
        label = labels.get(item_id, item_id)
        item = crud.get_asset(db, item_id, reg)
        if item is None:
            skipped.append(f"{label}: no longer in the register")
            continue
        if req.kind == SCRAP:
            if item.is_deleted:
                skipped.append(f"{label}: already scrapped")
                continue
            if is_sold(item.status):
                skipped.append(f"{label}: it was sold, so it is not scrapped")
                continue
            crud.delete_asset(db, item, actor)
        else:
            errors = crud.validate_asset_fields(dict(changes), partial=True, register=reg,
                                                current_status=item.status, current=item)
            if errors:
                skipped.append(f"{label}: {'; '.join(errors)}")
                continue
            crud.update_asset(db, item, dict(changes), actor)
            if link_ids is not None and reg is registers.ASSETS:
                crud.link_peripherals(db, item, link_ids, actor)
                db.commit()
        done.append(label)

    verb = "Scrapped" if req.kind == SCRAP else "Marked sold"
    parts = [f"{verb}: {', '.join(done)}." if done else f"Nothing could be {verb.lower()}."]
    if skipped:
        parts.append("Not changed: " + "; ".join(skipped) + ".")
    return (APPROVED if done else FAILED), " ".join(parts)


def decide(db: Session, req: ApprovalRequest, token: Optional[ApprovalToken],
           decision: str, note: str, decided_by: str) -> ApprovalRequest:
    note = (note or "").strip()[:500] or None
    if token is not None:
        token.used_at = _utcnow()
    _kill_tokens(db, req)
    req.decided_at = _utcnow()
    req.decided_by = decided_by
    req.decision_note = note
    req.status = REJECTED if decision == "reject" else APPROVED
    db.commit()
    if decision != "reject":
        status, outcome = _apply(db, req)
        req.status, req.outcome = status, outcome
    else:
        req.outcome = "Rejected -- nothing was changed."
    db.commit()
    db.refresh(req)
    mailer.run_in_background(send_outcome_email, req.id)
    return req


def withdraw(db: Session, req: ApprovalRequest, username: str) -> ApprovalRequest:
    _kill_tokens(db, req)
    req.status = WITHDRAWN
    req.decided_at = _utcnow()
    req.decided_by = username
    req.outcome = f"Withdrawn by {username} -- nothing was changed."
    db.commit()
    db.refresh(req)
    return req


def _log(db: Session, summary: str, target: str = "", ok: bool = True) -> None:
    try:
        crud.record_activity(db, actor="system", actor_role=None, action="notifications.email",
                             category="notifications", summary=summary[:400], target=target[:200],
                             outcome="ok" if ok else "failed", status_code=200 if ok else 500)
    except Exception:  # noqa: BLE001 -- the log must never be why an email job dies
        logger.exception("Could not record a notification in the Activity Log")


def _session():
    from app.database import SessionLocal
    return SessionLocal()


def inform_list(cfg: NotificationSettings) -> list[str]:
    return mailer.split_addresses(cfg.cc_emails)


def it_heads(cfg: Optional[NotificationSettings]) -> list[str]:
    return mailer.split_addresses(getattr(cfg, "it_head_email", None))


def it_head_label(cfg: Optional[NotificationSettings]) -> str:
    heads = it_heads(cfg)
    if not heads:
        return "IT head"
    return heads[0] if len(heads) == 1 else f"IT head ({', '.join(heads)})"[:150]


def recipients(cfg: NotificationSettings, *people: Any) -> tuple[list[str], list[str]]:
    to: list[str] = []
    for addr in (*it_heads(cfg), *people):
        addr = str(addr or "").strip()
        if addr and crud.EMAIL_RE.match(addr) and addr.lower() not in {a.lower() for a in to}:
            to.append(addr)
    taken = {a.lower() for a in to}
    return to, [a for a in inform_list(cfg) if a.lower() not in taken]


def _items_table(items: list[dict]) -> tuple[str, str]:
    lines, rows = [], []
    for i in items:
        bits = [i.get("asset_id") or "", i.get("asset_tag") or "", i.get("model") or ""]
        extra = [f"Srl {i['srl']}" if i.get("srl") else "", i.get("status") or "",
                 i.get("user") or "", i.get("location") or ""]
        lines.append(" · ".join(b for b in bits + extra if b))
        rows.append("<tr>" + "".join(
            f"<td style='padding:4px 8px;border-bottom:1px solid #ddd'>{html.escape(str(v or '—'))}</td>"
            for v in (i.get("asset_id"), i.get("asset_tag"), i.get("model"), i.get("srl"),
                      i.get("status"), i.get("user"), i.get("location"))) + "</tr>")
    head = "".join(f"<th style='padding:4px 8px;text-align:left;border-bottom:2px solid #333'>{h}</th>"
                   for h in ("ID", "Name", "Model", "Srl No.", "Status", "Assigned to", "Location"))
    table = (f"<table style='border-collapse:collapse;font-size:13px'><thead><tr>{head}</tr></thead>"
             f"<tbody>{''.join(rows)}</tbody></table>")
    return "\n".join(f"  - {line}" for line in lines), table


def _what(req: ApprovalRequest, n: int) -> str:
    noun = registers.by_key(req.register)
    word = noun.noun if n == 1 else noun.plural
    if req.kind == SCRAP:
        return f"scrap {n} {word}"
    target = json.loads(req.changes or "{}").get("status") or "SOLD"
    return f"mark {n} {word} as {target}"


def _wrap(body: str) -> str:
    return (f"<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111'>{body}"
            "<p style='color:#777;font-size:12px;margin-top:24px'>Sent by IT Asset Engine.</p></div>")


def send_request_email(request_id: str, inform: bool = True) -> None:
    with _session() as db:
        cfg = get_settings(db)
        req = db.get(ApprovalRequest, request_id)
        if req is None or req.status != PENDING:
            return
        items = json.loads(req.items or "[]")
        token = issue_token(db, req)
        url = f"{cfg.app_base_url}/approve/{token}"
        what = _what(req, len(items))
        text_items, table = _items_table(items)
        held = {k: v for k, v in json.loads(req.changes or "{}").items()
                if k != "linkedPeripheralIds" and str(v or "").strip()}
        change_lines = [f"{crud.field_label(k)} → {v}" for k, v in held.items()]
        subject = f"Approval needed: {what} ({req.requested_by})"
        text = (f"{req.requested_by} has asked to {what}.\n"
                + (f"Reason: {req.reason}\n" if req.reason else "")
                + ("Changes: " + "; ".join(change_lines) + "\n" if change_lines else "")
                + f"\n{text_items}\n\nNothing has been changed yet. Approve or reject:\n"
                f"  Approve: {url}?decision=approve\n  Reject:  {url}?decision=reject\n\n"
                f"These links work once and expire in {TOKEN_DAYS} days.")
        btn = ("display:inline-block;padding:9px 18px;margin-right:8px;border-radius:6px;"
               "color:#fff;text-decoration:none;font-weight:600")
        body = (f"<p><b>{html.escape(req.requested_by)}</b> has asked to <b>{html.escape(what)}</b>.</p>"
                + (f"<p>Reason: {html.escape(req.reason)}</p>" if req.reason else "")
                + ("<p>Changes: " + html.escape("; ".join(change_lines)) + "</p>" if change_lines else "")
                + table
                + "<p style='margin-top:16px'>Nothing has been changed yet.</p><p>"
                f"<a href='{html.escape(url)}?decision=approve' style='{btn};background:#1f6f4a'>Approve</a>"
                f"<a href='{html.escape(url)}?decision=reject' style='{btn};background:#b42318'>Reject</a></p>"
                f"<p style='color:#555;font-size:12px'>Each link opens a page where you confirm. "
                f"Links work once and expire in {TOKEN_DAYS} days.</p>")
        try:
            mailer.send(cfg, it_heads(cfg), subject, text, _wrap(body))
            _log(db, f"Emailed the IT head for approval to {what}", req.id[:8])
        except mailer.MailError as exc:
            _log(db, f"Could not email the IT head for approval to {what}: {exc}", req.id[:8], ok=False)

        heads = {a.lower() for a in it_heads(cfg)}
        others = [a for a in inform_list(cfg) if a.lower() not in heads]
        if not inform or not others:
            return
        info_subject = f"Waiting for the IT head's approval: {what} ({req.requested_by})"
        info_text = (f"{req.requested_by} has asked to {what}. It waits for the IT head's approval.\n"
                     + (f"Reason: {req.reason}\n" if req.reason else "")
                     + ("Changes: " + "; ".join(change_lines) + "\n" if change_lines else "")
                     + f"\n{text_items}\n\nNothing has been changed yet. You will be told the outcome.")
        info_body = (f"<p><b>{html.escape(req.requested_by)}</b> has asked to <b>{html.escape(what)}</b>. "
                     "It waits for the IT head's approval.</p>"
                     + (f"<p>Reason: {html.escape(req.reason)}</p>" if req.reason else "")
                     + ("<p>Changes: " + html.escape("; ".join(change_lines)) + "</p>" if change_lines else "")
                     + table
                     + "<p style='margin-top:16px'>Nothing has been changed yet. You will be told the outcome.</p>")
        try:
            mailer.send(cfg, others, info_subject, info_text, _wrap(info_body))
            _log(db, f"Emailed the inform list: {req.requested_by} asked to {what}", req.id[:8])
        except mailer.MailError as exc:
            _log(db, f"Could not email the inform list about a request to {what}: {exc}",
                 req.id[:8], ok=False)


def send_outcome_email(request_id: str) -> None:
    with _session() as db:
        cfg = get_settings(db)
        req = db.get(ApprovalRequest, request_id)
        if req is None or not mailer.configured(cfg):
            return
        to = [req.requested_by_email] if req.requested_by_email else []
        cc = [a for a in mailer.split_addresses(cfg.cc_emails) if a not in to]
        if not to and not cc:
            return
        what = _what(req, len(json.loads(req.items or "[]")))
        word = {APPROVED: "approved", REJECTED: "rejected", FAILED: "approved, but could not be applied"
                }.get(req.status, req.status)
        subject = f"IT head {word}: {what}"
        text = (f"The request by {req.requested_by} to {what} was {word}.\n"
                + (f"Note from the IT head: {req.decision_note}\n" if req.decision_note else "")
                + f"\n{req.outcome or ''}")
        body = (f"<p>The request by <b>{html.escape(req.requested_by)}</b> to {html.escape(what)} "
                f"was <b>{html.escape(word)}</b>.</p>"
                + (f"<p>Note from the IT head: {html.escape(req.decision_note)}</p>" if req.decision_note else "")
                + f"<p>{html.escape(req.outcome or '')}</p>")
        try:
            mailer.send(cfg, to or cc, subject, text, _wrap(body), cc=cc if to else None)
            _log(db, f"Emailed the outcome ({word}) of a request to {what}", req.id[:8])
        except mailer.MailError as exc:
            _log(db, f"Could not email the outcome of a request to {what}: {exc}", req.id[:8], ok=False)


def notify_done(kind: str, register, items: list, username: str, reason: str = "") -> None:
    snaps = [snapshot(i) for i in items]
    mailer.run_in_background(_send_done_email, kind, register.key, snaps, username, reason)


def _send_done_email(kind: str, register_key: str, items: list[dict], username: str, reason: str) -> None:
    with _session() as db:
        cfg = get_settings(db)
        if cfg.mode != "inform" or not cfg.it_head_email:
            return
        reg = registers.by_key(register_key)
        n = len(items)
        word = reg.noun if n == 1 else reg.plural
        what = f"scrapped {n} {word}" if kind == SCRAP else f"marked {n} {word} as sold"
        text_items, table = _items_table(items)
        subject = f"{username} {what}"
        text = f"{username} {what}.\n" + (f"Reason: {reason}\n" if reason else "") + f"\n{text_items}"
        body = (f"<p><b>{html.escape(username)}</b> {html.escape(what)}.</p>"
                + (f"<p>Reason: {html.escape(reason)}</p>" if reason else "") + table)
        to, cc = recipients(cfg)
        try:
            mailer.send(cfg, to, subject, text, _wrap(body), cc=cc)
            _log(db, f"Emailed the IT head: {username} {what}")
        except mailer.MailError as exc:
            _log(db, f"Could not email the IT head that {username} {what}: {exc}", ok=False)


def _scrapped_and_sold_since(db: Session, since: datetime) -> list[dict]:
    from app.models import AssetEvent
    rows = db.execute(
        select(AssetEvent).where(AssetEvent.at >= _bound(db, since), AssetEvent.field == "status")
        .order_by(AssetEvent.at)
    ).scalars().all()
    out = []
    for e in rows:
        if e.action == crud.EVENT_DELETED:
            out.append({"what": "Scrapped", "id": e.asset_number, "by": e.actor, "at": e.at})
        elif is_sold(e.new_value) and not is_sold(e.old_value):
            out.append({"what": "Sold", "id": e.asset_number, "by": e.actor, "at": e.at})
    return out


def send_summary(db: Session, cfg: NotificationSettings, now: datetime) -> bool:
    since = now - timedelta(hours=24)
    pending = _pending(db) if cfg.mode == "approve" else []
    decided = [r for r in db.execute(select(ApprovalRequest).where(
        ApprovalRequest.decided_at >= _bound(db, since))).scalars().all()]
    changes = _scrapped_and_sold_since(db, since)
    if not pending and not decided and not changes:
        return False

    text, body = [], []
    if pending:
        text.append(f"WAITING FOR YOUR APPROVAL ({len(pending)})")
        body.append(f"<h3>Waiting for your approval ({len(pending)})</h3><ul>")
        for req in pending:
            url = f"{cfg.app_base_url}/approve/{issue_token(db, req)}"
            what = _what(req, len(json.loads(req.items or "[]")))
            text.append(f"  - {req.requested_by}: {what} (asked {_local(req.requested_at)}) -> {url}")
            body.append(f"<li>{html.escape(req.requested_by)}: {html.escape(what)} "
                        f"(asked {_local(req.requested_at)}) — <a href='{html.escape(url)}'>review</a></li>")
        body.append("</ul>")
    if decided:
        text.append(f"\nDECIDED IN THE LAST 24 HOURS ({len(decided)})")
        body.append(f"<h3>Decided in the last 24 hours ({len(decided)})</h3><ul>")
        for req in decided:
            what = _what(req, len(json.loads(req.items or "[]")))
            text.append(f"  - {req.status}: {req.requested_by} -- {what}")
            body.append(f"<li><b>{html.escape(req.status)}</b>: {html.escape(req.requested_by)} — "
                        f"{html.escape(what)}</li>")
        body.append("</ul>")
    if changes:
        text.append(f"\nSCRAPPED OR SOLD IN THE LAST 24 HOURS ({len(changes)})")
        body.append(f"<h3>Scrapped or sold in the last 24 hours ({len(changes)})</h3><ul>")
        for c in changes:
            text.append(f"  - {c['what']} {c['id']} by {c['by']} ({_local(c['at'])})")
            body.append(f"<li>{c['what']} <b>{html.escape(c['id'] or '')}</b> by "
                        f"{html.escape(c['by'] or '')} ({_local(c['at'])})</li>")
        body.append("</ul>")

    subject = f"IT assets: daily summary for {to_ist(now).strftime(DAY)}"
    mailer.send(cfg, it_heads(cfg), subject, "\n".join(text), _wrap("".join(body)))
    heads = {a.lower() for a in it_heads(cfg)}
    cc = [a for a in mailer.split_addresses(cfg.cc_emails) if a.lower() not in heads]
    if cc:
        no_links = [b for b in body if "review</a>" not in b]
        mailer.send(cfg, cc, subject, "\n".join(t for t in text if "/approve/" not in t),
                    _wrap("".join(no_links)))
    return True


def claim_summary_day(db: Session, today: str) -> bool:
    result = db.execute(sql_text(
        "UPDATE notification_settings SET last_summary_on = :d "
        "WHERE id = 1 AND (last_summary_on IS NULL OR last_summary_on <> :d)"), {"d": today})
    db.commit()
    return result.rowcount == 1


def summary_due(cfg: NotificationSettings, now_local: datetime) -> bool:
    if cfg is None or cfg.mode == "off" or not cfg.summary_enabled or not cfg.it_head_email:
        return False
    if not mailer.configured(cfg):
        return False
    if cfg.last_summary_on == now_local.date().isoformat():
        return False
    return now_local.strftime("%H:%M") >= (cfg.summary_time or "18:00")


def run_summary_if_due(now: Optional[datetime] = None) -> None:
    now = now or _utcnow()
    now_local = to_ist(now)
    with _session() as db:
        cfg = db.get(NotificationSettings, 1)
        if not summary_due(cfg, now_local):
            return
        if not claim_summary_day(db, now_local.date().isoformat()):
            return
        try:
            sent = send_summary(db, cfg, now)
            if sent:
                _log(db, "Emailed the daily summary to the IT head")
        except mailer.MailError as exc:
            _log(db, f"Could not email the daily summary: {exc}", ok=False)


_scheduler_started = False


def start_scheduler(interval_seconds: int = 60) -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        from app import data_export, notices, renewals
        while True:
            try:
                run_summary_if_due()
            except Exception:  # noqa: BLE001 -- keep checking tomorrow whatever happened today
                logger.exception("Daily summary check failed")
            try:
                renewals.run_if_due()
            except Exception:  # noqa: BLE001
                logger.exception("Software renewal check failed")
            try:
                data_export.run_if_due()
            except Exception:  # noqa: BLE001
                logger.exception("Scheduled data export check failed")
            try:
                notices.send_registration_digest()
            except Exception:  # noqa: BLE001
                logger.exception("Verified-entries email check failed")
            time.sleep(interval_seconds)

    threading.Thread(target=loop, name="daily-summary", daemon=True).start()

