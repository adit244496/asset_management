from flask import Blueprint, jsonify, request

from app import activity, crud
from app.api.auth import require_admin, require_superadmin, token_required
from app.database import get_db
from app.masters import MASTER_SPECS, MASTERS, get_spec

bp = Blueprint("masters", __name__, url_prefix="/api/masters")

MAX_BULK_ITEMS = 1000


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes")


def _category_404(category: str):
    known = ", ".join(spec.key for spec in MASTER_SPECS)
    return jsonify({"detail": f"Unknown master category '{category}'. Expected one of: {known}"}), 404


@bp.route("", methods=["GET"])
@token_required
def list_all_masters(current_user):
    include_inactive = _truthy(request.args.get("includeInactive"))
    with get_db() as db:
        items = {}
        for spec in MASTER_SPECS:
            rows = crud.list_master(db, spec, include_inactive=include_inactive)
            items[spec.key] = [crud.master_to_dict(r, spec.key) for r in rows]
        return jsonify({"categories": _categories(), "items": items})


def _categories():
    return [
        {"key": spec.key, "label": spec.label, "plural": spec.plural, "field": spec.row_key,
         **({"classification": spec.classification} if spec.classification else {})}
        for spec in MASTER_SPECS
    ]


def _users(db):
    return [crud.user_out_dict(u) for u in crud.list_users(db)]


MAX_IMPORT_ROWS = 10000


@bp.route("/export", methods=["GET"])
@token_required
@require_admin
def export_masters(current_user):
    with get_db() as db:
        return jsonify({"categories": _categories(), "items": crud.all_masters_snapshot(db),
                        "users": _users(db)})


@bp.route("/import", methods=["POST"])
@token_required
@require_admin
def import_masters(current_user):
    data = request.get_json(silent=True) or {}
    lists = data.get("lists")
    if not isinstance(lists, dict) or not any(isinstance(lists.get(k), list) for k in MASTERS):
        return jsonify({"detail": "The file has no Master Data sheets to upload."}), 422
    total = sum(len(v) for k, v in lists.items() if k in MASTERS and isinstance(v, list))
    if total > MAX_IMPORT_ROWS:
        return jsonify({"detail": f"Too many rows at once ({total}). At most {MAX_IMPORT_ROWS}."}), 422

    with get_db() as db:
        report = crud.import_masters(db, lists)
    added = sum(c["added"] for c in report["lists"].values())
    updated = sum(c["updated"] for c in report["lists"].values())
    activity.note(
        target="Master Data",
        summary=f"Uploaded the Master Data workbook: {added} added, {updated} updated, "
                f"{len(report['errors'])} skipped",
    )
    report["categories"] = _categories()
    return jsonify(report)


@bp.route("/<category>", methods=["GET"])
@token_required
def list_master(current_user, category):
    spec = get_spec(category)
    if spec is None:
        return _category_404(category)

    include_inactive = _truthy(request.args.get("includeInactive"))
    with get_db() as db:
        rows = crud.list_master(db, spec, include_inactive=include_inactive)
        usage = crud.master_usage_counts(db, spec)
        items = []
        for row in rows:
            payload = crud.master_to_dict(row, spec.key)
            payload["inUse"] = usage.get(row.name.lower(), 0)
            items.append(payload)
        return jsonify({"items": items, "total": len(items)})


@bp.route("/<category>", methods=["POST"])
@token_required
@require_admin
def create_master(current_user, category):
    spec = get_spec(category)
    if spec is None:
        return _category_404(category)

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    activity.note(target=f"{spec.label}: {name}",
                  summary=f"Added {spec.label} {name!r}")
    if not name:
        return jsonify({"detail": "name is required"}), 400

    with get_db() as db:
        existing = crud.find_master_by_name(db, spec, name)
        if existing is not None:
            return jsonify({"detail": f"{spec.label} '{existing.name}' already exists."}), 409
        row = crud.create_master(
            db,
            spec,
            name=name,
            description=data.get("description"),
            sort_order=data.get("sortOrder"),
            is_active=data.get("isActive", True),
        )
        return jsonify(crud.master_to_dict(row, spec.key)), 201


@bp.route("/<category>/bulk", methods=["POST"])
@token_required
@require_admin
def bulk_create_master(current_user, category):
    spec = get_spec(category)
    if spec is None:
        return _category_404(category)

    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list):
        return jsonify({"detail": "items must be a list of { name, description } objects"}), 422
    if len(items) > MAX_BULK_ITEMS:
        return jsonify({
            "detail": f"Too many values at once ({len(items)}). Please paste at most {MAX_BULK_ITEMS}.",
        }), 422

    with get_db() as db:
        added, skipped, errors, created = crud.bulk_create_masters(db, spec, items)
        return jsonify({
            "added": added,
            "skipped": skipped,
            "errors": errors,
            "items": [crud.master_to_dict(r, spec.key) for r in created],
        })


@bp.route("/<category>/<row_id>", methods=["PATCH"])
@token_required
@require_admin
def update_master(current_user, category, row_id):
    spec = get_spec(category)
    if spec is None:
        return _category_404(category)

    data = request.get_json(silent=True) or {}
    with get_db() as db:
        row = crud.get_master(db, spec, row_id)
        if row is None:
            return jsonify({"detail": f"{spec.label} not found"}), 404

        name = data.get("name")
        if name is not None:
            name = str(name).strip()
            if not name:
                return jsonify({"detail": "name cannot be blank"}), 400
            clash = crud.find_master_by_name(db, spec, name)
            if clash is not None and clash.id != row.id:
                return jsonify({"detail": f"{spec.label} '{clash.name}' already exists."}), 409

        if "isShared" in data and spec.key != "type":
            return jsonify({
                "detail": "isShared applies to Asset Types only -- it says whether a "
                          "peripheral of that type can be linked to several assets at once.",
            }), 422

        renamed = name and name != row.name
        activity.note(
            target=f"{spec.label}: {row.name}",
            summary=(f"Renamed {spec.label} {row.name!r} → {name!r}" if renamed
                     else f"Edited {spec.label} {row.name!r}"),
        )

        row, assets_updated = crud.update_master(
            db,
            spec,
            row,
            name=name,
            description=data.get("description"),
            sort_order=data.get("sortOrder"),
            is_active=data.get("isActive"),
            is_shared=data.get("isShared"),
        )
        payload = crud.master_to_dict(row, spec.key)
        payload["assetsUpdated"] = assets_updated
        return jsonify(payload)


@bp.route("/<category>/<row_id>", methods=["DELETE"])
@token_required
@require_superadmin
def delete_master(current_user, category, row_id):
    spec = get_spec(category)
    if spec is None:
        return _category_404(category)

    with get_db() as db:
        row = crud.get_master(db, spec, row_id)
        if row is None:
            return jsonify({"detail": f"{spec.label} not found"}), 404

        activity.note(target=f"{spec.label}: {row.name}",
                      summary=f"Removed {spec.label} {row.name!r}")

        in_use = crud.count_assets_using(db, spec, row.name)
        if in_use:
            return jsonify({
                "detail": (
                    f"'{row.name}' is used by {in_use} asset(s) and can't be deleted. "
                    "Deactivate it instead to remove it from the dropdowns while "
                    "leaving those assets unchanged."
                ),
                "inUse": in_use,
            }), 409

        crud.delete_master(db, row)
        return "", 204

