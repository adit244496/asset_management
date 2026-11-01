from functools import wraps

from flask import Blueprint, g, jsonify, request

from app import activity, crud, roles
from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, get_password_hash, verify_password
from app.database import get_db

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


INVALID_TOKEN_CODE = "invalid_token"

MUST_CHANGE_PASSWORD_CODE = "must_change_password"

_PASSWORD_CHANGE_ALLOWED = frozenset({"auth.read_me", "auth.change_my_password"})


def _session_expired(detail: str):
    return jsonify({"detail": detail, "code": INVALID_TOKEN_CODE}), 401


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get("Authorization", "")
        parts = auth_header.split(" ")
        if len(parts) == 2 and parts[0] == "Bearer":
            token = parts[1]

        if not token:
            return _session_expired("Not authenticated")

        try:
            payload = decode_access_token(token)
        except Exception:
            return _session_expired("Could not validate credentials")

        user_id = payload.get("sub")
        if not user_id:
            return _session_expired("Could not validate credentials")

        with get_db() as db:
            current_user = crud.get_user(db, user_id)
            if current_user is None or not current_user.is_active:
                return _session_expired("Could not validate credentials")

            if not roles.can_sign_in(current_user.role):
                return _session_expired("Could not validate credentials")

            if getattr(current_user, "must_change_password", False) \
                    and request.endpoint not in _PASSWORD_CHANGE_ALLOWED:
                return jsonify({
                    "detail": "Set your own password before using the app.",
                    "code": MUST_CHANGE_PASSWORD_CODE,
                }), 403

            g.current_user_id = current_user.id
            g.actor_username = current_user.username
            g.actor_role = current_user.role
            return f(current_user, *args, **kwargs)

    return decorated


def _wanted_roles(wanted) -> str:
    return " or ".join(roles.ROLE_LABELS.get(r, r) for r in roles.ALL_ROLES if r in wanted)


def role_required(*wanted):
    def decorator(f):
        @wraps(f)
        def decorated(current_user, *args, **kwargs):
            if current_user.role not in wanted:
                return jsonify({
                    "detail": f"This action requires the {_wanted_roles(wanted)} role.",
                }), 403
            return f(current_user, *args, **kwargs)
        return decorated
    return decorator


require_admin = role_required(roles.SUPERADMIN, roles.ADMIN)

require_write = require_admin

require_superadmin = role_required(roles.SUPERADMIN)

require_verify = role_required(*sorted(roles.VERIFY_ROLES))

require_discard = role_required(*sorted(roles.DISCARD_ROLES))

require_edit = role_required(*sorted(roles.EDIT_ROLES))


@bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    activity.note(actor=username or "(blank)", target=username or "(blank)")

    if not username or not password:
        return jsonify({"detail": "username and password are required"}), 400

    with get_db() as db:
        user = crud.get_user_by_username(db, username)
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            activity.note(summary=f"Sign-in failed for {username!r}")
            return jsonify({"detail": "Invalid username or password"}), 401

        if not roles.can_sign_in(user.role):
            activity.note(actor=user.username, actor_role=user.role,
                          summary=f"Sign-in refused: {user.username} is an assignee")
            return jsonify({
                "detail": "This profile cannot sign in.",
            }), 403

        activity.note(actor=user.username, actor_role=user.role, target=user.username,
                      summary=f"Signed in as {user.username}")
        token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
        return jsonify({
            "accessToken": token,
            "tokenType": "bearer",
            "user": crud.auth_user_dict(user),
        })


@bp.route("/me", methods=["GET"])
@token_required
def read_me(current_user):
    return jsonify(crud.me_dict(current_user))


@bp.route("/me/password", methods=["PATCH"])
@token_required
def change_my_password(current_user):
    data = request.get_json(silent=True) or {}
    current_password = data.get("currentPassword") or ""
    new_password = data.get("newPassword") or ""
    if not new_password:
        return jsonify({"detail": "newPassword is required"}), 400

    with get_db() as db:
        user = crud.get_user(db, current_user.id)
        if user is None or not verify_password(current_password, user.password_hash):
            return jsonify({"detail": "Current password is incorrect"}), 401
        shared = {settings.NEW_USER_DEFAULT_PASSWORD, settings.ADMIN_PASSWORD} - {""}
        if new_password in shared:
            return jsonify({
                "detail": "Choose a password of your own -- that is a shared "
                          "starting password.",
            }), 400
        user.password_hash = get_password_hash(new_password)
        user.must_change_password = False
        db.commit()
        return jsonify({"ok": True})

