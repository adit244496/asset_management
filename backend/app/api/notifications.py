from flask import Blueprint, jsonify, request

from app import activity, approvals, mailer
from app.api.auth import require_superadmin, token_required
from app.database import get_db
from app.models import ApprovalRequest

bp = Blueprint("notifications", __name__)


@bp.route("/api/notifications/settings", methods=["GET"])
@token_required
@require_superadmin
def get_settings(current_user):
    with get_db() as db:
        return jsonify(approvals.settings_dict(approvals.get_settings(db)))


@bp.route("/api/notifications/settings", methods=["PUT"])
@token_required
@require_superadmin
def save_settings(current_user):
    data = request.get_json(silent=True) or {}
    with get_db() as db:
        before = approvals.get_settings(db).mode
        row, errors = approvals.update_settings(db, data, current_user.username)
        if errors:
            activity.note(summary="Refused: notification settings (" + "; ".join(errors)[:300] + ")")
            return jsonify({"detail": errors}), 422
        what = "Saved the email notification settings"
        if row.mode != before:
            what += f" (mode {before} → {row.mode})"
        activity.note(summary=what)
        return jsonify(approvals.settings_dict(row))


@bp.route("/api/notifications/mode", methods=["GET"])
@token_required
def get_mode(current_user):
    with get_db() as db:
        return jsonify({"mode": approvals.current_mode(db)})


@bp.route("/api/notifications/renewals", methods=["GET"])
@token_required
@require_superadmin
def renewal_preview(current_user):
    from app import renewals
    with get_db() as db:
        return jsonify(renewals.preview(db))


@bp.route("/api/notifications/export/download", methods=["POST"])
@token_required
@require_superadmin
def export_download(current_user):
    import io
    from app.datefmt import today_ist

    from flask import send_file

    from app import data_export
    with get_db() as db:
        data, name, counts = data_export.build_zip(db, approvals.get_settings(db), today_ist())
        activity.note(summary=f"Downloaded the data export ({name}: {counts['assets']} assets, "
                              f"{counts['peripherals']} peripherals, {counts['softwares']} softwares, "
                              f"{counts['activity']} activity entries)")
    response = send_file(io.BytesIO(data), mimetype="application/zip", as_attachment=True,
                         download_name=name)
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


@bp.route("/api/notifications/export/send", methods=["POST"])
@token_required
@require_superadmin
def export_send(current_user):
    from app.datefmt import today_ist

    from app import data_export
    with get_db() as db:
        cfg = approvals.get_settings(db)
        to = data_export.recipients_of(cfg)
        activity.note(summary=f"Sent the data export now to {', '.join(to) or '(nobody)'}")
        try:
            sent = data_export.send_and_clear(db, cfg, today_ist(), f"Sent by {current_user.username}")
        except mailer.MailError as exc:
            return jsonify({"detail": [str(exc)]}), 502 if to else 422
        if sent["cleared"] is not None:
            approvals._log(db, data_export.cleared_line(sent))
        return jsonify(sent)


@bp.route("/api/notifications/test", methods=["POST"])
@token_required
@require_superadmin
def send_test(current_user):
    data = request.get_json(silent=True) or {}
    with get_db() as db:
        cfg = approvals.get_settings(db)
        to_list = mailer.split_addresses(data.get("to") or cfg.it_head_email)
        to = ", ".join(to_list)
        activity.note(summary=f"Sent a test email to {to or '(nobody)'}")
        if not to:
            return jsonify({"detail": ["Enter the IT head's email address first (and save)."]}), 422
        try:
            mailer.send(cfg, to_list, "IT Asset Engine: test email",
                        f"This is a test from IT Asset Engine, sent by {current_user.username}.\n"
                        "If you can read it, email notifications are working.",
                        "<p>This is a test from <b>IT Asset Engine</b>, sent by "
                        f"{current_user.username}.</p><p>If you can read it, email notifications "
                        "are working.</p>")
        except mailer.MailError as exc:
            return jsonify({"detail": [str(exc)]}), 502
        return jsonify({"sent": True, "to": to})


@bp.route("/api/approvals", methods=["GET"])
@token_required
@require_superadmin
def list_approvals(current_user):
    with get_db() as db:
        return jsonify({"items": [approvals.request_dict(r) for r in approvals.list_requests(db)]})


def _own_pending(db, request_id):
    req = db.get(ApprovalRequest, request_id)
    if req is None:
        return None, (jsonify({"detail": "Request not found."}), 404)
    if req.status != approvals.PENDING:
        return None, (jsonify({"detail": f"This request was already {req.status}."}), 409)
    return req, None


@bp.route("/api/approvals/<request_id>/withdraw", methods=["POST"])
@token_required
@require_superadmin
def withdraw(current_user, request_id):
    with get_db() as db:
        req, refused = _own_pending(db, request_id)
        if refused:
            return refused
        activity.note(target=req.id[:8], summary=f"Withdrew a request to "
                      f"{approvals._what(req, len(approvals.request_dict(req)['items']))}")
        req = approvals.withdraw(db, req, current_user.username)
        return jsonify(approvals.request_dict(req))


@bp.route("/api/approvals/<request_id>/resend", methods=["POST"])
@token_required
@require_superadmin
def resend(current_user, request_id):
    with get_db() as db:
        req, refused = _own_pending(db, request_id)
        if refused:
            return refused
        activity.note(target=req.id[:8], summary="Re-sent an approval email to the IT head")
        mailer.run_in_background(approvals.send_request_email, req.id, inform=False)
        return jsonify({"queued": True})


@bp.route("/api/approvals/link/<token>", methods=["GET"])
def link_info(token):
    with get_db() as db:
        req, _, problem = approvals.resolve_token(db, token)
        if req is None:
            return jsonify({"detail": problem}), 404
        body = approvals.request_dict(req)
        body["canDecide"] = problem is None
        body["problem"] = problem
        return jsonify(body)


@bp.route("/api/approvals/decide", methods=["POST"])
def link_decide():
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "")
    decision = data.get("decision")
    note = (data.get("note") or "").strip()
    with get_db() as db:
        cfg = approvals.get_settings(db)
        who = approvals.it_head_label(cfg)
        activity.note(actor=who, actor_role="it head")
        if decision not in ("approve", "reject"):
            return jsonify({"detail": "decision must be approve or reject"}), 422
        if decision == "reject" and not note:
            return jsonify({"detail": "Say why it is rejected -- the person who asked will see it."}), 422
        req, tok, problem = approvals.resolve_token(db, token)
        if problem:
            activity.note(summary=f"Refused an approval link: {problem}")
            return jsonify({"detail": problem}), 409 if req is not None else 404
        what = approvals._what(req, len(approvals.request_dict(req)["items"]))
        activity.note(target=req.id[:8],
                      summary=f"IT head {'approved' if decision == 'approve' else 'rejected'}: "
                              f"{req.requested_by} -- {what}")
        req = approvals.decide(db, req, tok, decision, note, who)
        return jsonify(approvals.request_dict(req))

