"""Admin controls: the AI assistant's provider, model and API keys.

Superadmin only, on every route. Keys are write-only: they can be pasted,
replaced or removed, but no response ever contains one.
"""
from flask import Blueprint, jsonify, request

from app import activity
from app.api.auth import require_superadmin, token_required
from app.assistant import control, engine
from app.database import get_db

bp = Blueprint("admin_controls", __name__, url_prefix="/api/admin/assistant")


def _body(row) -> dict:
    out = control.public(row)
    out["aiEnabled"] = engine.ai_enabled()
    out["installed"] = {name: p.available() for name, p in engine.PROVIDERS.items()}
    return out


@bp.route("", methods=["GET"])
@token_required
@require_superadmin
def get_settings(current_user):
    with get_db() as db:
        return jsonify(_body(control.get_row(db)))


@bp.route("", methods=["PUT"])
@token_required
@require_superadmin
def save_settings(current_user):
    data = request.get_json(silent=True) or {}
    with get_db() as db:
        row, errors, changed = control.update(db, data, current_user.username)
        if errors:
            activity.note(summary="AI assistant settings not saved (" + "; ".join(errors)[:300] + ")")
            return jsonify({"detail": errors}), 422
        activity.note(summary="Saved the AI assistant settings"
                              + (f": {'; '.join(changed)}" if changed else " (no change)"))
        return jsonify(_body(row))


@bp.route("/keys/<provider>", methods=["DELETE"])
@token_required
@require_superadmin
def remove_key(current_user, provider):
    if provider not in control.PROVIDERS:
        return jsonify({"detail": "Unknown provider."}), 404
    with get_db() as db:
        row, had = control.remove_key(db, provider, current_user.username)
        label = control.PROVIDER_LABELS[provider]
        activity.note(summary=f"Removed the {label} API key" if had
                      else f"Removed the {label} API key (none was saved)")
        return jsonify(_body(row))


@bp.route("/test", methods=["POST"])
@token_required
@require_superadmin
def test_connection(current_user):
    data = request.get_json(silent=True) or {}
    provider = str(data.get("provider") or "").strip().lower()
    key, problem = control.clean_key(data.get("apiKey"))
    if problem:
        return jsonify({"ok": False, "message": problem})
    model_id = str(data.get("model") or "").strip()[:control.MAX_MODEL_CHARS]
    result = engine.test_connection(provider, key, model_id)
    label = control.PROVIDER_LABELS.get(provider, provider or "?")
    activity.note(summary=f"Tested the {label} connection"
                          + (" with an unsaved key" if key else "")
                          + (": OK" if result["ok"] else f": failed ({result['message'][:160]})"))
    return jsonify(result)
