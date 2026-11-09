from flask import Blueprint, jsonify

from app import live
from app.api.auth import token_required

bp = Blueprint("live", __name__, url_prefix="/api/live")


@bp.route("", methods=["GET"])
@token_required
def versions(current_user):
    """One change counter per topic; the browser re-fetches a page's data when
    its topic's counter moves. See app/live.py."""
    response = jsonify({"versions": live.versions()})
    response.headers["Cache-Control"] = "no-store"
    return response
