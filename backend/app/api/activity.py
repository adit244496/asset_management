from flask import Blueprint, jsonify, request

from app import crud
from app.api.auth import require_superadmin, token_required
from app.database import get_db

bp = Blueprint("activity", __name__, url_prefix="/api/activity")

MAX_LIMIT = 20000
DEFAULT_LIMIT = 50


@bp.route("", methods=["GET"])
@token_required
@require_superadmin
def list_activity(current_user):
    args = request.args
    try:
        limit = int(args.get("limit", DEFAULT_LIMIT))
        offset = int(args.get("offset", 0))
    except ValueError:
        return jsonify({"detail": ["limit and offset must be whole numbers"]}), 422
    if limit < 1 or offset < 0:
        return jsonify({"detail": ["limit must be 1 or more and offset 0 or more"]}), 422
    limit = min(limit, MAX_LIMIT)

    outcome = (args.get("outcome") or "").strip()
    if outcome and outcome not in crud.ACTIVITY_OUTCOMES:
        return jsonify({
            "detail": [f"outcome must be one of {', '.join(crud.ACTIVITY_OUTCOMES)}"],
        }), 422

    with get_db() as db:
        items, total = crud.list_activity(
            db,
            query=args.get("q") or "",
            actor=args.get("actor") or "",
            category=args.get("category") or "",
            action=args.get("action") or "",
            outcome=outcome,
            date_from=args.get("from") or "",
            date_to=args.get("to") or "",
            limit=limit,
            offset=offset,
        )
        return jsonify({
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "actors": crud.list_activity_actors(db),
            "actions": crud.list_activity_actions(db),
            "categories": crud.ACTIVITY_CATEGORIES,
            "outcomes": crud.ACTIVITY_OUTCOMES,
            "clearedAt": (lambda c: c.isoformat() if c else None)(crud.activity_cleared_at(db)),
        })

