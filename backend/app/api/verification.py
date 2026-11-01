from flask import Blueprint, jsonify, request

from app import activity, crud, joiners, notices, registers
from app.api.auth import require_discard, require_verify, token_required
from app.database import get_db

bp = Blueprint("verification", __name__, url_prefix="/api/verification")

MAX_BATCH = 5000


def _serialize(db, items_by_register, username: str) -> list[dict]:
    out = []
    shared = crud.shared_type_names(db)
    for reg, items in items_by_register:
        if reg is registers.SOFTWARES:
            dicts = [crud.asset_to_dict(s) for s in items]
        elif reg is registers.ASSETS:
            links = crud.linked_peripherals_map(db, [a.id for a in items])
            dicts = [crud.asset_to_dict(a, links=links.get(a.id)) for a in items]
        else:
            on = crud.linked_assets_map(db, items)
            dicts = [crud.asset_to_dict(p, linked_to=on.get(p.id), shared=shared) for p in items]
        for item, body in zip(items, dicts):
            body["enteredByYou"] = crud.entered_by(item, username)
        out.extend(dicts)
    out.sort(key=lambda d: d.get("createdAt") or "")
    return out


def _own_entry_error(item) -> str:
    return (f"You entered {item.asset_id}, so another verifier has to check it. "
            "You can still correct it (Edit) or discard it.")


def _sent_back_error(item) -> str:
    who = item.created_by or "whoever entered it"
    return (f"{item.asset_id} was sent back and is on hold until {who} corrects it. "
            "It can be verified once it has been resubmitted.")


def _find(db, ref) -> tuple:
    if not isinstance(ref, dict):
        return None, None
    reg = registers.by_key(str(ref.get("register") or ""))
    item_id = str(ref.get("id") or "")
    if reg is None or not item_id:
        return None, None
    item = crud.get_asset(db, item_id, reg)
    return (reg, item) if item is not None else (None, None)


@bp.route("", methods=["GET"])
@token_required
@require_verify
def list_waiting(current_user):
    with get_db() as db:
        items = _serialize(db, [(reg, crud.list_unverified(db, reg)) for reg in registers.ALL],
                           current_user.username)
        counts = crud.count_unverified(db)
        return jsonify({"items": items, "total": len(items),
                        "pending": counts[crud.PENDING], "rejected": counts[crud.REJECTED]})


@bp.route("/count", methods=["GET"])
@token_required
@require_verify
def count_waiting(current_user):
    with get_db() as db:
        counts = crud.count_unverified(db)
        waiting = [i for reg in registers.ALL for i in crud.list_unverified(db, reg)]
        for_you = sum(1 for i in waiting
                      if (i.verification == crud.REJECTED) == crud.entered_by(i, current_user.username))
        return jsonify({"pending": counts[crud.PENDING], "rejected": counts[crud.REJECTED],
                        "forYou": for_you})


@bp.route("/verify", methods=["POST"])
@token_required
@require_verify
def verify(current_user):
    data = request.get_json(silent=True) or {}
    refs = data.get("items")
    if not isinstance(refs, list) or not refs:
        return jsonify({"detail": "items must be a non-empty list of {register, id}."}), 422
    if len(refs) > MAX_BATCH:
        return jsonify({"detail": f"At most {MAX_BATCH} entries at a time."}), 422

    with get_db() as db:
        found = [item for _, item in (_find(db, r) for r in refs) if item is not None]
        unverified = [i for i in found if not crud.is_verified(i)]
        sent_back = [i for i in unverified if i.verification == crud.REJECTED]
        pending = [i for i in unverified if i.verification != crud.REJECTED]
        own = [i for i in pending if crud.entered_by(i, current_user.username)]
        waiting = [i for i in pending if not crud.entered_by(i, current_user.username)]
        if not waiting and sent_back:
            problem = (_sent_back_error(sent_back[0]) if len(sent_back) == 1 else
                       f"{len(sent_back)} of these were sent back and are on hold until whoever "
                       "entered them corrects them.")
            activity.note(target=sent_back[0].asset_id,
                          summary=f"Refused: verify a sent-back entry ({problem[:160]})")
            return jsonify({"detail": problem, "code": "sent_back"}), 409
        if own and not waiting:
            problem = (_own_entry_error(own[0]) if len(own) == 1 else
                       f"You entered all {len(own)} of these, so another verifier has to check them.")
            activity.note(target=own[0].asset_id, summary=f"Refused: verify own entry ({problem[:160]})")
            return jsonify({"detail": problem, "code": "own_entry"}), 403
        done = crud.verify_items(db, waiting, current_user.username)
        joiners.check(db, [(i, None) for i in waiting], current_user.username, skip_uploads=True)
        notices.registered(db, waiting, current_user.username, "verified")
        labels = ", ".join(i.asset_id for i in waiting[:5]) + (" …" if len(waiting) > 5 else "")
        activity.note(target=labels or None,
                      summary=f"Verified {done} {'entry' if done == 1 else 'entries'} into the register"
                              + (f": {labels}" if labels else ""))
        return jsonify({
            "verified": done,
            "alreadyVerified": len(found) - len(unverified),
            "notFound": len(refs) - len(found),
            "ownSkipped": len(own),
            "sentBackSkipped": len(sent_back),
        })


@bp.route("/reject", methods=["POST"])
@token_required
@require_verify
def reject(current_user):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()
    if not reason:
        return jsonify({"detail": "Say why it is being sent back, so it can be corrected."}), 422

    with get_db() as db:
        reg, item = _find(db, data)
        if item is None:
            return jsonify({"detail": "Entry not found."}), 404
        if crud.is_verified(item):
            return jsonify({"detail": f"{item.asset_id} is already in the register."}), 409
        if crud.entered_by(item, current_user.username):
            return jsonify({"detail": _own_entry_error(item), "code": "own_entry"}), 403
        crud.reject_item(db, item, current_user.username, reason)
        notices.sent_back(db, item, current_user.username, reason)
        activity.note(target=item.asset_id,
                      summary=f"Sent {item.asset_id} back from Verification: {reason[:160]!r}")
        return jsonify(_serialize(db, [(reg, [item])], current_user.username)[0])


@bp.route("/discard", methods=["POST"])
@token_required
@require_discard
def discard(current_user):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()
    with get_db() as db:
        reg, item = _find(db, data)
        if item is None:
            return jsonify({"detail": "Entry not found."}), 404
        if crud.is_verified(item):
            return jsonify({"detail": f"{item.asset_id} is already in the register, so it "
                                      "cannot be discarded here."}), 409
        was = crud.discard_item(db, item, current_user.username, reason)
        activity.note(target=was, summary=f"Discarded {was} from Verification"
                                          + (f": {reason[:160]!r}" if reason else ""))
        return jsonify({"discarded": was})

