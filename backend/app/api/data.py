import io

from flask import Blueprint, jsonify, request, send_file

from app import activity, approvals, crud, data_export, registers
from app.api.auth import require_superadmin, token_required
from app.core.security import verify_password
from app.database import get_db
from app.datefmt import today_ist

bp = Blueprint("data", __name__, url_prefix="/api/data")


@bp.route("", methods=["GET"])
@token_required
@require_superadmin
def data_counts(current_user):
    with get_db() as db:
        return jsonify({"counts": {reg.plural: crud.count_register(db, reg) for reg in registers.ALL}})


@bp.route("", methods=["DELETE"])
@token_required
@require_superadmin
def clear_all_data(current_user):
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if not password:
        return jsonify({"detail": "Your account password is required to clear all data."}), 400

    with get_db() as db:
        user = crud.get_user(db, current_user.id)
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"detail": "Incorrect password. Nothing was deleted."}), 401

        today = today_ist()
        zipped, name, _ = data_export.build_zip(db, approvals.get_settings(db), today,
                                                activity=False, waiting=True,
                                                name="it-asset-backup-before-clear")
        counts = crud.clear_all_registers(db)
        activity.note(
            target="All registers",
            summary="CLEARED ALL DATA: " + ", ".join(f"{n} {plural}" for plural, n in counts.items())
                    + f" deleted permanently; a copy was downloaded ({name})",
        )
    response = send_file(io.BytesIO(zipped), mimetype="application/zip", as_attachment=True,
                         download_name=name)
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    response.headers["X-Cleared"] = ",".join(f"{plural}={n}" for plural, n in counts.items())
    response.headers["Access-Control-Expose-Headers"] += ", X-Cleared"
    return response

