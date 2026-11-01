from flask import Blueprint, jsonify, request

from app import activity, crud, roles
from app.api.auth import require_admin, require_superadmin, token_required
from app.core.config import settings
from app.core.security import verify_password
from app.database import get_db

bp = Blueprint("users", __name__, url_prefix="/api/users")


def _joining_error(data) -> str | None:
    value = data.get("dateOfJoining")
    if value is None or not str(value).strip():
        return None
    if not crud.DATE_RE.match(str(value).strip()):
        return "Date of Joining must be a valid date (dd-mm-yyyy)"
    return None


@bp.route("", methods=["GET"])
@token_required
@require_admin
def list_users(current_user):
    with get_db() as db:
        users = crud.list_users(db)
        return jsonify([crud.user_out_dict(u) for u in users])


@bp.route("", methods=["POST"])
@token_required
@require_admin
def create_user(current_user):
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    full_name = (data.get("fullName") or "").strip()
    role = data.get("role") or roles.ASSIGNEE

    activity.note(target=username, summary=f"Created account {username!r} as {role}")

    if not username or not password or not full_name:
        return jsonify({"detail": "username, password, and fullName are required"}), 400
    if not roles.is_valid(role):
        return jsonify({
            "detail": f"role must be one of: {', '.join(roles.ALL_ROLES)}",
        }), 422
    bad_date = _joining_error(data)
    if bad_date:
        return jsonify({"detail": bad_date}), 422
    denied = roles.superadmin_guard_error(current_user.role, requested_role=role)
    if denied:
        return jsonify({"detail": denied}), 403

    with get_db() as db:
        existing = crud.find_user_by_username(db, username)
        if existing is not None:
            return jsonify({
                "detail": f"Username '{existing.username}' already exists.",
            }), 400
        user = crud.create_user(db, username=username, password=password,
                                full_name=full_name, role=role,
                                email=data.get("email"),
                                location=data.get("location"),
                                date_of_joining=data.get("dateOfJoining"))
        return jsonify(crud.user_out_dict(user)), 201


@bp.route("/bulk", methods=["POST"])
@token_required
@require_admin
def bulk_upload_users(current_user):
    data = request.get_json(silent=True) or {}
    rows = data.get("rows")
    if not isinstance(rows, list) or not rows:
        return jsonify({"detail": "rows must be a non-empty list"}), 422
    if len(rows) > crud.USER_UPLOAD_MAX_ROWS:
        return jsonify({"detail": f"At most {crud.USER_UPLOAD_MAX_ROWS} rows at a time."}), 422

    with get_db() as db:
        result = crud.bulk_upsert_users(db, rows, settings.NEW_USER_DEFAULT_PASSWORD)
    activity.note(target="users", summary=(
        f"Bulk-uploaded the user list: {len(result['created'])} created, "
        f"{len(result['updated'])} updated, {result['unchanged']} unchanged, "
        f"{len(result['skipped'])} skipped"))
    return jsonify(result)


@bp.route("/<user_id>", methods=["PATCH"])
@token_required
@require_admin
def update_user(current_user, user_id):
    data = request.get_json(silent=True) or {}
    role = data.get("role")

    with get_db() as db:
        user = crud.get_user(db, user_id)
        if user is None:
            return jsonify({"detail": "User not found"}), 404

        changes = []
        if role and role != user.role:
            changes.append(f"profile {user.role} → {role}")
        if data.get("password"):
            changes.append("password reset")
        if "isActive" in data and bool(data.get("isActive")) != bool(user.is_active):
            changes.append("deactivated" if not data.get("isActive") else "reactivated")
        for key, label in (("fullName", "name"), ("email", "email"), ("location", "location"),
                           ("dateOfJoining", "date of joining")):
            if key in data:
                changes.append(label)
        activity.note(
            target=user.username,
            summary=f"Updated {user.username}: {', '.join(changes)}" if changes
                    else f"Updated {user.username}",
        )

        refusal = roles.role_change_error(user.role, role)
        if refusal:
            return jsonify({"detail": refusal}), 422
        bad_date = _joining_error(data)
        if bad_date:
            return jsonify({"detail": bad_date}), 422

        denied = roles.superadmin_guard_error(current_user.role, user.role, role)
        if denied:
            return jsonify({"detail": denied}), 403

        user = crud.update_user(
            db,
            user,
            full_name=data.get("fullName"),
            role=role,
            is_active=data.get("isActive"),
            password=data.get("password"),
            email=data.get("email"),
            location=data.get("location"),
            date_of_joining=data.get("dateOfJoining"),
        )
        return jsonify(crud.user_out_dict(user))


@bp.route("", methods=["DELETE"])
@token_required
@require_superadmin
def clear_all_users(current_user):
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if not password:
        return jsonify({
            "detail": "Your account password is required to clear the user list.",
        }), 400

    with get_db() as db:
        user = crud.get_user(db, current_user.id)
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"detail": "Incorrect password. No accounts were deleted."}), 401

        deleted = crud.clear_all_users(db, keep_user_id=user.id)
        return jsonify({"deleted": deleted, "kept": crud.count_users(db)})


@bp.route("/<user_id>", methods=["DELETE"])
@token_required
@require_admin
def delete_user(current_user, user_id):
    with get_db() as db:
        user = crud.get_user(db, user_id)
        if user is None:
            return jsonify({"detail": "User not found"}), 404
        activity.note(target=user.username,
                      summary=f"Deactivated account {user.username} ({user.role})")
        denied = roles.superadmin_guard_error(current_user.role, user.role)
        if denied:
            return jsonify({"detail": denied}), 403
        crud.deactivate_user(db, user)
        return "", 204

