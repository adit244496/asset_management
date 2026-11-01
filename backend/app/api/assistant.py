import json
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from sqlalchemy import select

from app import activity, crud, registers, roles
from app.api.auth import token_required
from app.assistant import engine, guide
from app.assistant import reports
from app.database import get_db
from app.models import AssistantConversation, AssistantProposal

bp = Blueprint("assistant", __name__, url_prefix="/api/assistant")

MODE_LABEL = {engine.MODE_ANSWER: "Answer only", engine.MODE_CHANGES: "Can make changes"}
OUTCOMES = ("confirmed", "declined", "failed")

HISTORY_DAYS = 7
HISTORY_LIMIT = 100

REPORT_USES = {
    "excel": "Downloaded as Excel",
    "csv": "Downloaded as CSV",
    "pdf": "Printed / saved as PDF",
    "open": "Opened in Report",
    "qr": "Opened QR labels",
}
REPORT_DOWNLOADS = frozenset({"excel", "csv", "pdf"})


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _iso(value):
    return _aware(value).isoformat() if value else None


def _first_question(c: AssistantConversation) -> str:
    for item in json.loads(c.display or "[]"):
        if item.get("type") == "user":
            text = (item.get("text") or "").strip()
            return text if len(text) <= 90 else text[:89] + "…"
    return "(no question)"


def _conversation_out(c: AssistantConversation) -> dict:
    return {
        "id": c.id,
        "mode": c.mode,
        "turns": c.turns,
        "items": json.loads(c.display or "[]"),
        "limitReached": not engine.usable(c),
    }


def _own_conversation(db, user, conversation_id):
    c = db.get(AssistantConversation, conversation_id)
    if c is None or c.user_id != user.id:
        return None
    return c


@bp.route("/status", methods=["GET"])
@token_required
def status(current_user):
    return jsonify({
        "aiEnabled": engine.ai_enabled(),
        "canMakeChanges": roles.can_write(current_user.role),
        "provider": engine.provider().NAME if engine.ai_enabled() else None,
        "model": engine.model_name() if engine.ai_enabled() else None,
    })


@bp.route("/guide", methods=["GET"])
@token_required
def guide_topics(current_user):
    return jsonify({"topics": [guide.public(t) for t in guide.topics_for(current_user.role)]})


@bp.route("/conversations/latest", methods=["GET"])
@token_required
def latest_conversation(current_user):
    with get_db() as db:
        c = db.execute(
            select(AssistantConversation)
            .where(AssistantConversation.user_id == current_user.id)
            .order_by(AssistantConversation.updated_at.desc())
            .limit(1)
        ).scalars().first()
        if c is None or not engine.usable(c):
            return "", 204
        last = c.updated_at
        if last is not None:
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last > timedelta(minutes=engine.IDLE_MINUTES):
                return "", 204
        return jsonify(_conversation_out(c))


@bp.route("/conversations", methods=["GET"])
@token_required
def list_conversations(current_user):
    since = datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)
    with get_db() as db:
        rows = db.execute(
            select(AssistantConversation)
            .where(AssistantConversation.user_id == current_user.id,
                   AssistantConversation.turns > 0)
            .order_by(AssistantConversation.updated_at.desc())
            .limit(HISTORY_LIMIT * 2)
        ).scalars().all()
        recent = [c for c in rows if (_aware(c.updated_at) or since) >= since][:HISTORY_LIMIT]
        return jsonify({"days": HISTORY_DAYS, "items": [{
            "id": c.id,
            "title": _first_question(c),
            "turns": c.turns,
            "mode": c.mode,
            "startedAt": _iso(c.created_at),
            "updatedAt": _iso(c.updated_at),
        } for c in recent]})


@bp.route("/conversations/<conversation_id>", methods=["GET"])
@token_required
def get_conversation(current_user, conversation_id):
    with get_db() as db:
        c = _own_conversation(db, current_user, conversation_id)
        if c is None:
            return jsonify({"detail": "Conversation not found."}), 404
        return jsonify(_conversation_out(c))


@bp.route("/report-rows", methods=["POST"])
@token_required
def report_rows(current_user):
    data = request.get_json(silent=True) or {}
    use = data.get("use") if data.get("use") in REPORT_USES else "excel"
    title = (str(data.get("title") or "").strip() or "untitled")[:120]
    try:
        spec = reports.normalize(data.get("spec") or {}, file=True)
    except reports.ToolError as exc:
        return jsonify({"detail": str(exc)}), 422

    with get_db() as db:
        items = reports.select(db, spec, strict=False)
        if registers.by_key(spec["register"]) is registers.SOFTWARES:
            rows = [crud.asset_to_dict(s) for s in items]
        elif registers.by_key(spec["register"]) is registers.ASSETS:
            links = crud.linked_peripherals_map(db, [a.id for a in items])
            rows = [crud.asset_to_dict(a, links=links.get(a.id)) for a in items]
        else:
            linked = crud.linked_assets_map(db, items)
            shared = crud.shared_type_names(db)
            rows = [crud.asset_to_dict(p, linked_to=linked.get(p.id), shared=shared) for p in items]

    if use in REPORT_DOWNLOADS:
        activity.note(target=title,
                      summary=f"{REPORT_USES[use]}: assistant report '{title}' ({len(rows)} records)")
    else:
        activity.dont_record()
    return jsonify({"items": rows, "total": len(rows), "register": spec["register"],
                    "description": reports.describe(spec)})


@bp.route("/conversations", methods=["POST"])
@token_required
def start_conversation(current_user):
    data = request.get_json(silent=True) or {}
    mode = engine.effective_mode(current_user, data.get("mode") or engine.MODE_ANSWER)
    activity.note(summary=f"Started an assistant conversation ({MODE_LABEL[mode]})")
    with get_db() as db:
        c = AssistantConversation(user_id=current_user.id, username=current_user.username, mode=mode)
        db.add(c)
        db.commit()
        db.refresh(c)
        activity.note(target=c.id[:8])
        return jsonify(_conversation_out(c)), 201


@bp.route("/conversations/<conversation_id>/messages", methods=["POST"])
@token_required
def ask(current_user, conversation_id):
    if not engine.ai_enabled():
        return jsonify({"detail": "The AI assistant is not set up on this server. "
                                  "The Guide tab still works."}), 503
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()

    shown = text if len(text) <= 160 else text[:159] + "…"
    activity.note(summary=f"Asked the assistant: {shown!r}")

    with get_db() as db:
        c = _own_conversation(db, current_user, conversation_id)
        if c is None:
            return jsonify({"detail": "Conversation not found."}), 404
        activity.note(target=c.id[:8])
        try:
            items = engine.run_turn(db, current_user, c, text)
        except engine.AssistantError as exc:
            db.rollback()
            return jsonify({"detail": str(exc)}), 422
        db.commit()
        return jsonify({"items": items, "turns": c.turns,
                        "limitReached": not engine.usable(c)})


@bp.route("/mode", methods=["POST"])
@token_required
def set_mode(current_user):
    data = request.get_json(silent=True) or {}
    requested = data.get("mode")
    if requested not in engine.MODES:
        return jsonify({"detail": f"mode must be one of {', '.join(engine.MODES)}"}), 422
    if requested == engine.MODE_CHANGES and not roles.can_write(current_user.role):
        activity.note(summary="Tried to switch the assistant to 'Can make changes' (read-only profile)")
        return jsonify({"detail": "Your profile is read-only, so the assistant stays in Answer-only mode."}), 403

    activity.note(summary=f"Switched the assistant to '{MODE_LABEL[requested]}'")
    conversation_id = data.get("conversationId")
    if not conversation_id:
        return jsonify({"mode": requested})

    with get_db() as db:
        c = _own_conversation(db, current_user, conversation_id)
        if c is None:
            return jsonify({"detail": "Conversation not found."}), 404
        if c.mode != requested:
            c.mode = requested
            engine.queue_note(c, f"The person switched the assistant mode. Now: {engine.MODE_TEXT[requested]}")
            db.commit()
        return jsonify({"mode": c.mode})


@bp.route("/proposals/<proposal_id>/outcome", methods=["POST"])
@token_required
def proposal_outcome(current_user, proposal_id):
    data = request.get_json(silent=True) or {}
    outcome = data.get("outcome")
    detail = (data.get("detail") or "").strip()[:500] or None
    if outcome not in OUTCOMES:
        return jsonify({"detail": f"outcome must be one of {', '.join(OUTCOMES)}"}), 422

    with get_db() as db:
        p = db.get(AssistantProposal, proposal_id)
        if p is None or p.user_id != current_user.id:
            return jsonify({"detail": "Proposal not found."}), 404
        activity.note(
            target=p.record_label,
            summary={"confirmed": f"Confirmed an assistant change to {p.record_label}",
                     "declined": f"Declined an assistant change to {p.record_label}",
                     "failed": f"An assistant change to {p.record_label} failed"}[outcome]
                    + (f" ({detail})" if detail and outcome == "failed" else ""),
        )
        if p.status != "pending":
            return jsonify({"detail": f"This change was already {p.status}."}), 409

        p.status = outcome
        p.outcome_detail = detail
        p.decided_at = datetime.now(timezone.utc)

        c = db.get(AssistantConversation, p.conversation_id)
        if c is not None:
            items = json.loads(c.display or "[]")
            for item in items:
                if item.get("type") == "proposal" and item.get("id") == p.id:
                    item["status"] = outcome
                    item["detail"] = detail
            c.display = json.dumps(items)
            engine.queue_note(c, {
                "confirmed": f"The person confirmed the proposed change to {p.record_label}; it was applied.",
                "declined": f"The person declined the proposed change to {p.record_label}; nothing changed.",
                "failed": f"The proposed change to {p.record_label} was refused by the app"
                          + (f": {detail}" if detail else "") + ". Nothing changed.",
            }[outcome])
        db.commit()
        return jsonify({"status": p.status})

