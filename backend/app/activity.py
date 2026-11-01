import logging

from flask import g, request

from app import crud, registers
from app.database import get_db

logger = logging.getLogger(__name__)

RECORDED_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})

NOT_RECORDED = frozenset({
    "auth.login",
    "assets.asset_qr_codes",
    "peripherals.asset_qr_codes",
    "assistant.ask",
    "assistant.start_conversation",
    "assistant.set_mode",
})

OK = "ok"
REFUSED = "refused"
FAILED = "failed"

CATEGORY_ALIASES = {"assets": "asset", "peripherals": "peripheral", "softwares": "software"}

REGISTER_SKIP = frozenset({
    "create_asset", "update_asset", "delete_asset", "restore_asset",
    "purge_asset", "transfer_asset",
})

ACTION_WORDING = {
    "auth.login": "Signed in",
    "auth.change_my_password": "Changed their own password",
    "users.create_user": "Created account",
    "users.update_user": "Updated account",
    "users.delete_user": "Deactivated account",
    "users.clear_all_users": "Cleared all user accounts",
    "masters.create_master": "Added master value",
    "masters.bulk_create_master": "Added master values",
    "masters.update_master": "Edited master value",
    "masters.delete_master": "Removed master value",
    "data.clear_all_data": "CLEARED ALL DATA",
}

REGISTER_WORDING = {
    "bulk_import": "Imported into",
    "bulk_update": "Bulk-edited",
    "bulk_delete": "Bulk-scrapped",
    "clear_all_assets": "CLEARED ALL DATA in",
}

SINGLE_ITEM_WORDING = {
    "create_asset": "Create",
    "update_asset": "Edit",
    "delete_asset": "Scrap",
    "restore_asset": "Restore",
    "purge_asset": "Permanently delete",
    "transfer_asset": "Transfer",
}

OUTCOME_PREFIX = {REFUSED: "Refused: ", FAILED: "Failed: "}


def note(target=None, summary=None, actor=None, actor_role=None):
    current = getattr(g, "activity_note", None) or {}
    if target is not None:
        current["target"] = str(target)[:200]
    if summary is not None:
        current["summary"] = str(summary)[:400]
    if actor is not None:
        current["actor"] = str(actor)[:150]
    if actor_role is not None:
        current["actor_role"] = str(actor_role)[:20]
    g.activity_note = current


def dont_record():
    g.activity_skip = True


def _humanise(view_name: str) -> str:
    return view_name.replace("_", " ").capitalize()


def _outcome(status_code: int) -> str:
    if status_code < 300:
        return OK
    return REFUSED if status_code in (401, 403) else FAILED


def _should_record(endpoint: str, method: str, outcome: str) -> bool:
    if method not in RECORDED_METHODS:
        return False
    if not endpoint:
        return False
    if endpoint in NOT_RECORDED or getattr(g, "activity_skip", False):
        return False
    if outcome == REFUSED:
        return False
    blueprint, _, view = endpoint.rpartition(".")
    if blueprint in ("assets", "peripherals") and view in REGISTER_SKIP and outcome == OK:
        return False
    return True


def _register_item_label(db, blueprint: str):
    item_id = (request.view_args or {}).get("asset_id")
    if not item_id:
        return None
    register = registers.by_key(blueprint)
    if register is None:
        return None
    item = crud.get_asset(db, item_id, register)
    return item.asset_id if item is not None else None


def record_response(response):
    try:
        endpoint = request.endpoint or ""
        outcome = _outcome(response.status_code)
        if not _should_record(endpoint, request.method, outcome):
            return response

        blueprint, _, view = endpoint.rpartition(".")
        noted = getattr(g, "activity_note", None) or {}
        is_register = blueprint in CATEGORY_ALIASES

        wording = ACTION_WORDING.get(endpoint)
        if wording is None and is_register and view in SINGLE_ITEM_WORDING:
            wording = f"{SINGLE_ITEM_WORDING[view]} {CATEGORY_ALIASES[blueprint]}"
        if wording is None and view in REGISTER_WORDING:
            wording = f"{REGISTER_WORDING[view]} {blueprint}"
        if wording is None:
            wording = _humanise(view)

        with get_db() as db:
            target = noted.get("target")
            if target is None and is_register:
                target = _register_item_label(db, blueprint)

            summary = noted.get("summary") or (
                f"{wording} {target}" if target else wording
            )
            summary = OUTCOME_PREFIX.get(outcome, "") + summary

            crud.record_activity(
                db,
                actor=noted.get("actor") or getattr(g, "actor_username", None),
                actor_role=noted.get("actor_role") or getattr(g, "actor_role", None),
                action=endpoint,
                category=CATEGORY_ALIASES.get(blueprint, blueprint or "app"),
                summary=summary,
                target=target,
                outcome=outcome,
                status_code=response.status_code,
                method=request.method,
                path=request.path,
                ip=request.remote_addr,
            )
    except Exception:  # noqa: BLE001 -- see the docstring
        logger.exception("Could not record activity for %s %s",
                         request.method, request.path)
    return response


def install(app):
    app.after_request(record_response)

