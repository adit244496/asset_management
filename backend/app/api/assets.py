import io

from flask import Blueprint, jsonify, request, send_file

from typing import Any

from app import activity, approvals, crud, history_export, joiners, notices, qrcodes, registers, roles
from app.api.auth import (
    require_admin, require_edit, require_superadmin, require_write, token_required,
)
from app.core.config import settings
from app.core.security import verify_password
from app.database import get_db
from app.datefmt import display_date, today_ist
from app.registers import Register


def make_blueprint(register: Register) -> Blueprint:
    bp = Blueprint(register.plural, __name__, url_prefix=f"/api/{register.plural}")

    Noun = register.noun.capitalize()
    is_assets = register is registers.ASSETS
    is_software = register is registers.SOFTWARES

    def mark_pending(db, bodies):
        waiting = approvals.pending_map(db, register)
        if waiting:
            for body in bodies:
                if body["id"] in waiting:
                    body["pendingApproval"] = waiting[body["id"]]
        return bodies

    def serialize_many(db, items):
        if is_software:
            return mark_pending(db, [crud.asset_to_dict(s) for s in items])
        if is_assets:
            links = crud.linked_peripherals_map(db, [a.id for a in items])
            return mark_pending(db, [crud.asset_to_dict(a, links=links.get(a.id)) for a in items])
        assets = crud.linked_assets_map(db, items)
        shared = crud.shared_type_names(db)
        return mark_pending(db, [crud.asset_to_dict(p, linked_to=assets.get(p.id), shared=shared)
                                 for p in items])

    def frozen(db, items):
        problem = approvals.first_frozen_error(db, items)
        return (jsonify({"detail": [problem], "code": "pending_approval"}), 409) if problem else None

    def selling(asset, status) -> bool:
        return (crud.is_verified(asset) and not asset.is_deleted
                and approvals.is_sold(status) and not approvals.is_sold(asset.status))

    def hidden_from(current_user, item) -> bool:
        return not crud.is_verified(item) and not roles.can_verify(current_user.role)

    def sold_error(item):
        if item.is_deleted or not crud.is_sold(item.status):
            return None
        return jsonify({"detail": [f"{item.asset_id} was sold, so it cannot be scrapped."],
                        "code": "sold"}), 409

    def waiting_error(item):
        if crud.is_verified(item):
            return None
        return jsonify({"detail": f"{item.asset_id} is waiting in Verification. "
                                  "Verify it before transferring, scrapping or restoring it."}), 409

    def serialize_one(db, item):
        if is_software:
            return mark_pending(db, [crud.asset_to_dict(item)])[0]
        if is_assets:
            body = crud.asset_to_dict(item, links=crud.linked_peripherals(db, item.id))
        else:
            body = crud.asset_to_dict(item, linked_to=crud.linked_assets(db, item.id),
                                      shared=crud.shared_type_names(db))
        return mark_pending(db, [body])[0]

    def serialize_lookup_hit(db, item, shared):
        if registers.of(item) is registers.SOFTWARES:
            return crud.asset_to_dict(item)
        if registers.of(item) is registers.ASSETS:
            return crud.asset_to_dict(item, links=crud.linked_peripherals(db, item.id))
        return crud.asset_to_dict(item, linked_to=crud.linked_assets(db, item.id),
                                  shared=shared)

    def read_link_ids(data):
        if "linkedPeripheralIds" not in data:
            return None, None
        if not is_assets:
            return None, ("Peripherals are linked to an asset, not to another "
                          "peripheral. Set this on the asset instead.")
        value = data.get("linkedPeripheralIds")
        if value is None:
            return [], None
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            return None, "linkedPeripheralIds must be a list of peripheral ids"
        seen, ids = set(), []
        for v in value:
            if v and v not in seen:
                seen.add(v)
                ids.append(v)
        return ids, None

    def link_warning(result):
        n = len(result["missing"])
        return (f"{n} scanned code(s) matched no peripheral and were not linked. "
                "They may have been deleted, or belong to another system.")

    def _transfer_onto_asset(db, peripheral, onto_id: str, actor: str):
        if not onto_id:
            return jsonify({"detail": [
                f"This {register.noun} is in use, so it moves onto an asset. "
                "Choose the asset it is being plugged into."
            ]}), 422

        onto = crud.get_asset(db, onto_id, registers.ASSETS)
        if onto is None or not crud.is_verified(onto):
            return jsonify({"detail": ["That asset is no longer in the register."]}), 422

        was = notices.where(peripheral)
        already = [p.id for p in crud.linked_peripherals(db, onto.id)]
        if peripheral.id not in already:
            already.append(peripheral.id)
        crud.link_peripherals(db, onto, already, actor)

        crud.update_asset(db, peripheral, {
            "location": onto.location,
            "floor": onto.floor,
        }, actor)

        db.commit()
        notices.transferred(db, peripheral, was, actor, onto=onto)
        body = serialize_one(db, peripheral)
        body["transferredOnto"] = onto.asset_id
        return jsonify(body)

    @bp.route("", methods=["GET"])
    @token_required
    def list_assets(current_user):
        with get_db() as db:
            items = crud.list_assets(db, register)
            return jsonify({"items": serialize_many(db, items), "total": len(items)})

    @bp.route("", methods=["POST"])
    @token_required
    @require_write
    def create_asset(current_user):
        data = request.get_json(silent=True) or {}
        errors = crud.validate_asset_fields(data, partial=False, register=register)
        reserved = crud.reserved_status_error(data.get("status"))
        if reserved:
            errors = [*errors, reserved]
        with get_db() as db:
            taken = crud.duplicate_srl_error(db, data, register=register)
            if taken:
                errors = [*errors, taken]
            link_ids, link_error = read_link_ids(data)
            if link_error:
                errors = [*errors, link_error]
            if errors:
                return jsonify({"detail": errors}), 422

            asset = crud.create_asset(db, data, current_user.username, register)
            joiners.check(db, [(asset, None)], current_user.username)
            notices.registered(db, [asset], current_user.username, "entered")
            notices.awaiting_verification(db, [asset], current_user.username, "entered")
            links = None
            if link_ids is not None:
                links = crud.link_peripherals(db, asset, link_ids, current_user.username)
                db.commit()
            body = serialize_one(db, asset)
            if links and links["missing"]:
                body["linkWarning"] = link_warning(links)
            body["acceptedBySapId"] = bool(settings.VERIFY_NEW_RECORDS and crud.has_sap_id(asset))
            return jsonify(body), 201

    @bp.route("/<asset_id>", methods=["GET"])
    @token_required
    def get_asset(current_user, asset_id):
        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None or hidden_from(current_user, asset):
                return jsonify({"detail": f"{Noun} not found"}), 404
            return jsonify(serialize_one(db, asset))

    @bp.route("/<asset_id>", methods=["PATCH"])
    @token_required
    @require_edit
    def update_asset(current_user, asset_id):
        data = request.get_json(silent=True) or {}
        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            if (asset.verification == crud.REJECTED and asset.created_by
                    and not crud.entered_by(asset, current_user.username)):
                return jsonify({
                    "detail": [f"{asset.asset_id} was sent back to {asset.created_by} for correction. "
                               f"Only {asset.created_by} can correct and resubmit it."],
                    "code": "sent_back",
                }), 409
            errors = crud.validate_asset_fields(data, partial=True, register=register,
                                                current_status=asset.status, current=asset)
            reserved = crud.reserved_status_error(data.get("status"), asset.status)
            if reserved:
                errors = [*errors, reserved]
            taken = crud.duplicate_srl_error(db, data, asset)
            if taken:
                errors = [*errors, taken]
            link_ids, link_error = read_link_ids(data)
            if link_error:
                errors = [*errors, link_error]
            if errors:
                return jsonify({"detail": errors}), 422
            refused = frozen(db, [asset])
            if refused:
                return refused

            sale = selling(asset, data.get("status"))
            mode = approvals.current_mode(db) if sale else "off"
            if sale and mode == "approve":
                held = {k: v for k, v in data.items()
                        if k in crud.ALL_FIELD_KEYS or k == "linkedPeripheralIds"}
                req = approvals.create_request(
                    db, kind=approvals.SALE, register=register, items=[asset],
                    user=current_user, reason=data.get("approvalReason") or "", changes=held)
                activity.note(target=asset.asset_id,
                              summary=f"Asked the IT head to approve marking {asset.asset_id} "
                                      f"as {data.get('status')}")
                body = serialize_one(db, asset)
                body["approvalRequested"] = approvals.request_dict(req, with_items=False)
                return jsonify(body), 202

            holder_before = asset.user
            was_sent_back = asset.verification == crud.REJECTED
            was_waiting = asset.verification != crud.VERIFIED
            asset = crud.update_asset(db, asset, data, current_user.username)
            accepted_now = was_waiting and asset.verification == crud.VERIFIED
            if accepted_now:
                joiners.check(db, [(asset, None)], current_user.username, skip_uploads=True)
                notices.registered(db, [asset], current_user.username, "sap_id")
            else:
                joiners.check(db, [(asset, holder_before)], current_user.username)
            if was_sent_back and asset.verification == crud.PENDING:
                notices.awaiting_verification(db, [asset], current_user.username, "resubmitted")
            links = None
            if link_ids is not None:
                links = crud.link_peripherals(db, asset, link_ids, current_user.username)
                db.commit()
            if sale and mode == "inform":
                approvals.notify_done(approvals.SALE, register, [asset], current_user.username)
            body = serialize_one(db, asset)
            if links and links["missing"]:
                body["linkWarning"] = link_warning(links)
            body["acceptedBySapId"] = accepted_now
            return jsonify(body)

    @bp.route("/<asset_id>/transfer", methods=["POST"])
    @token_required
    @require_write
    def transfer_asset(current_user, asset_id):
        data = request.get_json(silent=True) or {}
        location = (data.get("location") or "").strip()
        user_id = (data.get("userId") or "").strip()
        onto_id = (data.get("assetId") or "").strip()

        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            refused = waiting_error(asset) or frozen(db, [asset])
            if refused:
                return refused
            if is_software:
                return jsonify({"detail": ["Software has no location or holder to move. "
                                           "Edit the record instead."]}), 422

            if (register is registers.PERIPHERALS
                    and crud.peripheral_transfer_mode(asset) == crud.TRANSFER_BY_ASSET):
                return _transfer_onto_asset(db, asset, onto_id, current_user.username)

            if not location:
                return jsonify({"detail": ["A destination location is required."]}), 422

            changes: dict[str, Any] = {"location": location}
            if "floor" in data:
                changes["floor"] = (data.get("floor") or "") or None

            if user_id and register is registers.ASSETS:
                holder = crud.get_user(db, user_id)
                if holder is None:
                    return jsonify({"detail": ["That person no longer has a record."]}), 422

                mismatch = crud.transfer_location_error(holder, location)
                if mismatch and not data.get("allowElsewhere"):
                    return jsonify({"detail": [mismatch], "code": "location_mismatch"}), 422

                changes["user"] = holder.full_name
                changes["email"] = holder.email or ""

            name = (data.get("assetTag") or "").strip()
            if name and register is registers.ASSETS:
                changes["assetTag"] = name
            if (crud.handing_over_from_stock(asset, changes)
                    and not (changes.get("assetTag") or asset.asset_tag or "").strip()):
                return jsonify({"detail": [f"Give {asset.asset_id} a name as you assign it -- "
                                           "its old one was cleared when it went into stock."],
                                "code": "name_required"}), 422

            errors = crud.validate_asset_fields(changes, partial=True, register=register,
                                                current_status=asset.status, current=asset)
            if errors:
                return jsonify({"detail": errors}), 422

            holder_before, was = asset.user, notices.where(asset)
            asset = crud.update_asset(db, asset, changes, current_user.username)
            joiners.check(db, [(asset, holder_before)], current_user.username)
            notices.transferred(db, asset, was, current_user.username)
            return jsonify(serialize_one(db, asset))

    @bp.route("/<asset_id>/move", methods=["POST"])
    @token_required
    @require_write
    def move_software(current_user, asset_id):
        if not is_software:
            return jsonify({"detail": [f"Only software is moved this way; use Transfer for {register.plural}."]}), 404
        data = request.get_json(silent=True) or {}
        action = str(data.get("action") or "").strip().lower()
        with get_db() as db:
            item = crud.get_asset(db, asset_id, register)
            if item is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            refused = waiting_error(item) or frozen(db, [item])
            if refused:
                return refused
            problem = crud.software_move_error(item, action, data.get("quantity"))
            if problem:
                return jsonify({"detail": [problem]}), 422
            quantity = int(str(data.get("quantity")).strip())
            holder = None
            if action == crud.MOVE_ASSIGN:
                person = crud.get_user(db, str(data.get("userId") or "").strip())
                if person is None or not person.is_active:
                    return jsonify({"detail": ["Choose who it is assigned to, from the user directory."]}), 422
                holder = person.full_name or person.username
            result = crud.move_software(db, item, action, quantity, holder, current_user.username)
            dest, source = result["record"], result["source"]
            what = f"{quantity} of {item.asset_tag}"
            summary = (f"Assigned {what} to {holder}" if action == crud.MOVE_ASSIGN
                       else f"Moved {what} to stock")
            activity.note(target=source.asset_id,
                          summary=summary + (f" ({dest.asset_id})" if result["split"] else ""))
            return jsonify({
                "record": serialize_one(db, dest),
                "source": serialize_one(db, source),
                "split": result["split"],
                "merged": result["merged"],
            })

    def history_query(args):
        actions = [a.strip() for a in args.getlist("action") if a.strip()]
        if any(a not in crud.EVENT_ACTIONS for a in actions):
            return None, f"action must be one of {', '.join(crud.EVENT_ACTIONS)}"
        search_in = (args.get("in") or "").strip()
        if search_in and search_in not in crud.HISTORY_SEARCH_IN:
            return None, f"in must be one of {', '.join(crud.HISTORY_SEARCH_IN)}"
        try:
            min_changes = int(args.get("minChanges") or 0)
        except ValueError:
            return None, "minChanges must be a whole number"
        if min_changes < 0:
            return None, "minChanges cannot be negative"
        return {
            "query": args.get("q") or "",
            "action": actions,
            "actor": args.getlist("actor"),
            "field": args.get("field") or "",
            "date_from": args.get("from") or "",
            "date_to": args.get("to") or "",
            "search_in": search_in,
            "types": args.getlist("type"),
            "statuses": args.getlist("status"),
            "min_changes": min_changes,
        }, None

    def history_filters_applied(query):
        out = []
        if query["min_changes"] > 1:
            out.append(f"{query['min_changes']} or more changes")
        if query["query"]:
            out.append(f"search {query['query']!r}" + (f" in {query['search_in']}" if query["search_in"] else ""))
        for key, label in (("types", "type"), ("statuses", "status"), ("action", "what happened"),
                           ("actor", "changed by")):
            if query[key]:
                out.append(f"{label}: {', '.join(query[key])}")
        start, end = display_date(query["date_from"]), display_date(query["date_to"])
        if start and end:
            out.append(f"changed {start} to {end}")
        elif start or end:
            out.append(f"changed from {start}" if start else f"changed until {end}")
        return out

    @bp.route("/history", methods=["GET"])
    @token_required
    def register_history(current_user):
        args = request.args
        try:
            limit = int(args.get("limit", 50))
            offset = int(args.get("offset", 0))
        except ValueError:
            return jsonify({"detail": ["limit and offset must be whole numbers"]}), 422
        query, problem = history_query(args)
        if problem:
            return jsonify({"detail": [problem]}), 422

        with get_db() as db:
            items, total = crud.list_history_by_asset(
                db, limit=limit, offset=offset, register=register, **query,
            )
            return jsonify({
                "items": items,
                "total": total,
                "limit": limit,
                "offset": offset,
                "actors": crud.list_event_actors(db, register),
                "actions": crud.EVENT_ACTIONS,
            })

    @bp.route("/history/export", methods=["GET", "POST"])
    @token_required
    def register_history_export(current_user):
        pks = None
        if request.method == "POST":
            activity.dont_record()
            ids = (request.get_json(silent=True) or {}).get("ids")
            if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids):
                return jsonify({"detail": [f"Choose at least one {register.noun}."]}), 422
            if len(ids) > history_export.MAX_RECORDS:
                return jsonify({"detail": [f"At most {history_export.MAX_RECORDS} at once."]}), 422
            pks = list(dict.fromkeys(ids))
        query, problem = history_query(request.args)
        if problem:
            return jsonify({"detail": [problem]}), 422
        applied = history_filters_applied(query)
        with get_db() as db:
            book, _, _ = history_export.history_workbook(
                db, register, current_user.username, applied, pks=pks, **query)
        name = f"{register.plural}-movement-history-{today_ist().strftime('%d-%m-%Y')}.xlsx"
        response = send_file(io.BytesIO(book), as_attachment=True, download_name=name,
                             mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response

    @bp.route("/<asset_id>/history", methods=["GET"])
    @token_required
    def asset_history(current_user, asset_id):
        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None or hidden_from(current_user, asset):
                return jsonify({"detail": f"{Noun} not found"}), 404
            events = crud.list_asset_events(db, asset.id, register=register)
            return jsonify({
                "items": [crud.event_to_dict(e) for e in events],
                "total": len(events),
                "asset": serialize_one(db, asset),
            })

    @bp.route("/bulk", methods=["PATCH"])
    @token_required
    @require_write
    def bulk_update(current_user):
        data = request.get_json(silent=True) or {}
        ids = data.get("ids")
        raw_changes = data.get("changes")

        if not isinstance(ids, list) or not ids:
            return jsonify({"detail": [f"ids must be a non-empty list of {register.noun} ids"]}), 422
        if not isinstance(raw_changes, dict):
            return jsonify({"detail": ["changes must be an object of field -> value"]}), 422

        changes = {
            key: value for key, value in raw_changes.items()
            if key in crud.fields_for(register)
            and key not in crud.SERVER_ASSIGNED_KEYS
            and str(value or "").strip()
        }
        if not changes:
            return jsonify({"detail": ["No fields to change."]}), 422
        if "srl" in changes:
            return jsonify({
                "detail": ["Srl No. identifies one device and cannot be set on several "
                           f"{register.plural} at once. Use Scan serial numbers instead."],
            }), 422
        if "sapId" in changes:
            return jsonify({
                "detail": [f"SAP ID identifies one {register.noun} in SAP and cannot be set on "
                           f"several {register.plural} at once. Edit each record instead."],
            }), 422

        errors = crud.validate_asset_fields(changes, partial=True, register=register)
        reserved = crud.reserved_status_error(changes.get("status"))
        if reserved:
            errors = [*errors, reserved]
        if errors:
            return jsonify({"detail": errors}), 422

        with get_db() as db:
            assets = [a for a in (crud.get_asset(db, i, register) for i in ids)
                      if a is not None and crud.is_verified(a)]
            missing = len(ids) - len(assets)
            live = [a for a in assets if not a.is_deleted]
            skipped_deleted = len(assets) - len(live)
            if not live:
                return jsonify({
                    "detail": [f"None of the selected {register.plural} can be edited."],
                }), 422
            refused = frozen(db, live)
            if refused:
                return refused

            sold_now = [a for a in live if selling(a, changes.get("status"))]
            mode = approvals.current_mode(db) if sold_now else "off"
            if sold_now and mode == "approve":
                req = approvals.create_request(
                    db, kind=approvals.SALE, register=register, items=live, user=current_user,
                    reason=data.get("approvalReason") or "", changes=changes)
                activity.note(target=register.plural,
                              summary=f"Asked the IT head to approve marking {len(live)} "
                                      f"{register.plural} as {changes.get('status')}")
                return jsonify({
                    "updated": 0, "unchanged": 0, "skippedDeleted": skipped_deleted,
                    "notFound": missing, "fields": sorted(changes),
                    "approvalRequested": approvals.request_dict(req, with_items=False),
                }), 202

            holders_before = [(a, a.user) for a in live]
            changed = crud.update_assets(db, live, changes, current_user.username)
            joiners.check(db, holders_before, current_user.username)
            if sold_now and mode == "inform":
                approvals.notify_done(approvals.SALE, register, sold_now, current_user.username)
            activity.note(
                target=register.plural,
                summary=(f"Bulk-edited {changed} {register.plural}: "
                         f"set {', '.join(sorted(changes))}"),
            )
            return jsonify({
                "updated": changed,
                "unchanged": len(live) - changed,
                "skippedDeleted": skipped_deleted,
                "notFound": missing,
                "fields": sorted(changes),
            })

    @bp.route("/bulk-delete", methods=["POST"])
    @token_required
    @require_admin
    def bulk_delete(current_user):
        data = request.get_json(silent=True) or {}
        ids = data.get("ids")

        if not isinstance(ids, list) or not ids:
            return jsonify({"detail": [f"ids must be a non-empty list of {register.noun} ids"]}), 422

        with get_db() as db:
            found = [a for a in (crud.get_asset(db, i, register) for i in ids)
                     if a is not None and crud.is_verified(a)]
            missing = len(ids) - len(found)
            live = [a for a in found if not a.is_deleted]
            already = len(found) - len(live)
            sold = [a for a in live if crud.is_sold(a.status)]
            live = [a for a in live if not crud.is_sold(a.status)]

            if not live:
                if sold:
                    return jsonify({
                        "detail": [f"The selected {register.plural} were sold, so they cannot "
                                   "be scrapped."],
                        "code": "sold",
                    }), 409
                return jsonify({
                    "detail": [f"None of the selected {register.plural} can be deleted."],
                }), 422
            refused = frozen(db, live)
            if refused:
                return refused

            reason = (data.get("reason") or "").strip()
            mode = approvals.current_mode(db)
            if mode == "approve":
                req = approvals.create_request(db, kind=approvals.SCRAP, register=register,
                                               items=live, user=current_user, reason=reason)
                activity.note(target=register.plural,
                              summary=f"Asked the IT head to approve scrapping {len(live)} "
                                      f"{register.plural}")
                return jsonify({
                    "deleted": 0,
                    "alreadyDeleted": already,
                    "notFound": missing,
                    "skippedSold": len(sold),
                    "approvalRequested": approvals.request_dict(req, with_items=False),
                }), 202

            for asset in live:
                crud.delete_asset(db, asset, current_user.username)
            if mode == "inform":
                approvals.notify_done(approvals.SCRAP, register, live, current_user.username, reason)

            activity.note(
                target=register.plural,
                summary=f"Scrapped {len(live)} {register.plural} at once",
            )
            return jsonify({
                "deleted": len(live),
                "alreadyDeleted": already,
                "notFound": missing,
                "skippedSold": len(sold),
            })

    @bp.route("/lookup", methods=["GET"])
    @token_required
    def lookup_asset(current_user):
        raw = request.args.get("q", "")
        scope = (request.args.get("scope") or "").strip().lower()

        with get_db() as db:
            query, matched_by, assets = crud.lookup_assets(
                db, raw, register if scope == "this" else None
            )
            return jsonify({
                "query": query,
                "matchedBy": matched_by,
                "items": [serialize_lookup_hit(db, a, crud.shared_type_names(db))
                          for a in assets],
                "total": len(assets),
            })

    @bp.route("/qr", methods=["POST"])
    @token_required
    def asset_qr_codes(current_user):
        data = request.get_json(silent=True) or {}
        ids = data.get("ids")

        if not isinstance(ids, list) or not ids:
            return jsonify({"detail": [f"ids must be a non-empty list of {register.noun} ids"]}), 422
        if len(ids) > qrcodes.MAX_CODES:
            return jsonify({
                "detail": [f"Up to {qrcodes.MAX_CODES} labels at a time. "
                           f"{len(ids)} were selected -- print them in batches."],
            }), 422

        with get_db() as db:
            found = {}
            for asset_id in ids:
                asset = crud.get_asset(db, asset_id, register)
                if asset is not None and crud.is_verified(asset):
                    found[asset_id] = asset
            items = [qrcodes.asset_qr_dict(found[i]) for i in ids if i in found]
            return jsonify({
                "items": items,
                "total": len(items),
                "notFound": len(ids) - len(items),
            })

    @bp.route("/<asset_id>/restore", methods=["POST"])
    @token_required
    @require_superadmin
    def restore_asset(current_user, asset_id):
        data = request.get_json(silent=True) or {}
        status = (data.get("status") or "").strip() or None

        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            refused = waiting_error(asset)
            if refused:
                return refused

            problem = crud.restore_status_error(asset, status, db=db)
            if problem:
                return jsonify({"detail": [problem]}), 422

            asset = crud.restore_asset(db, asset, current_user.username, status)
            return jsonify(serialize_one(db, asset))

    @bp.route("/<asset_id>", methods=["DELETE"])
    @token_required
    @require_admin
    def delete_asset(current_user, asset_id):
        with get_db() as db:
            asset = crud.get_asset(db, asset_id, register)
            if asset is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            refused = waiting_error(asset) or sold_error(asset) or frozen(db, [asset])
            if refused:
                return refused
            mode = approvals.current_mode(db) if not asset.is_deleted else "off"
            if mode == "approve":
                data = request.get_json(silent=True) or {}
                req = approvals.create_request(db, kind=approvals.SCRAP, register=register,
                                               items=[asset], user=current_user,
                                               reason=data.get("reason") or "")
                activity.note(target=asset.asset_id,
                              summary=f"Asked the IT head to approve scrapping {asset.asset_id}")
                return jsonify({"approvalRequested": approvals.request_dict(req, with_items=False)}), 202
            was_live = not asset.is_deleted
            crud.delete_asset(db, asset, current_user.username)
            if mode == "inform" and was_live:
                approvals.notify_done(approvals.SCRAP, register, [asset], current_user.username)
            return "", 204

    @bp.route("/<asset_id>/permanent", methods=["DELETE"])
    @token_required
    @require_superadmin
    def purge_asset(current_user, asset_id):
        data = request.get_json(silent=True) or {}
        password = data.get("password") or ""
        if not password:
            return jsonify({
                "detail": f"Your account password is required to permanently delete a {register.noun}.",
            }), 400

        with get_db() as db:
            user = crud.get_user(db, current_user.id)
            if user is None or not verify_password(password, user.password_hash):
                return jsonify({"detail": "Incorrect password. Nothing was deleted."}), 401

            asset = crud.get_asset(db, asset_id, register)
            if asset is None:
                return jsonify({"detail": f"{Noun} not found"}), 404
            refused = waiting_error(asset) or frozen(db, [asset])
            if refused:
                return refused
            was = crud.purge_asset(db, asset, current_user.username)
            return jsonify({
                "deleted": was,
                "detail": f"{Noun} {was} was permanently deleted. Its history was kept.",
            })

    @bp.route("", methods=["DELETE"])
    @token_required
    @require_superadmin
    def clear_all_assets(current_user):
        data = request.get_json(silent=True) or {}
        password = data.get("password") or ""
        if not password:
            return jsonify({
                "detail": "Your account password is required to clear the register.",
            }), 400

        with get_db() as db:
            user = crud.get_user(db, current_user.id)
            if user is None or not verify_password(password, user.password_hash):
                return jsonify({"detail": "Incorrect password. Nothing was deleted."}), 401

            going = crud.count_register(db, register)
            activity.note(
                target=register.plural,
                summary=f"CLEARED ALL DATA: {going} {register.plural} deleted permanently",
            )

            crud.clear_all_assets(db, register)
            return "", 204

    @bp.route("/bulk", methods=["POST"])
    @token_required
    @require_admin
    def bulk_import(current_user):
        data = request.get_json(silent=True) or {}
        rows = data.get("rows")
        dedupe_key = data.get("dedupeKey")
        unknown_masters = data.get("unknownMasters") or crud.UNKNOWN_INCLUDE

        if not isinstance(rows, list):
            return jsonify({"detail": ["rows must be a list"]}), 422
        if unknown_masters not in crud.UNKNOWN_MODES:
            return jsonify({
                "detail": [
                    'unknownMasters must be "include" (register values the master '
                    'lists do not have) or "reject" (skip those rows)',
                ],
            }), 422
        if (dedupe_key is not None and dedupe_key != crud.DEDUPE_OFF
                and dedupe_key not in crud.fields_for(register)):
            return jsonify({
                "detail": [
                    'dedupeKey must be null (automatic duplicate check), "none" (import everything), '
                    "or a field key such as assetTag, srl or poNo",
                ],
            }), 422

        with get_db() as db:
            accepted: list = []
            added, skipped, errors, warnings, unknown, normalised = crud.bulk_import_assets(
                db, rows, dedupe_key, current_user.username, register,
                unknown_masters=unknown_masters, accepted_out=accepted,
            )
            notices.registered(db, accepted, current_user.username, "uploaded")
            notices.awaiting_verification(db, accepted, current_user.username, "uploaded")

            accounts = None
            if data.get("createUsers") and not is_software:
                created, user_skipped = crud.create_users_from_names(
                    db,
                    [str(r.get("user") or "") for r in rows if isinstance(r, dict)],
                    settings.NEW_USER_DEFAULT_PASSWORD,
                    emails=crud.emails_by_person(rows),
                    locations=crud.locations_by_person(rows),
                    joining=crud.joining_dates_by_person(rows),
                )
                joined_filled = crud.fill_joining_dates(db, crud.joining_dates_by_person(rows))
                accounts = {
                    "created": created,
                    "skipped": user_skipped,
                    "joiningDatesFilled": joined_filled,
                    "defaultPassword": settings.NEW_USER_DEFAULT_PASSWORD,
                }

            total = len(crud.list_assets(db, register))
            made_accounts = len((accounts or {}).get("created") or [])
            activity.note(
                target=register.plural,
                summary=(
                    f"Imported {added} {register.plural} ({skipped} skipped)"
                    + (f", created {made_accounts} accounts" if made_accounts else "")
                ),
            )
            return jsonify({
                "added": added,
                "skipped": skipped,
                "total": total,
                "awaitingVerification": any(a.verification == crud.PENDING for a in accepted),
                "acceptedBySapId": (sum(1 for a in accepted if crud.has_sap_id(a))
                                    if settings.VERIFY_NEW_RECORDS else 0),
                "accounts": accounts,
                "errors": errors,
                "warnings": warnings,
                "unknownMasters": unknown,
                "unknownMastersMode": unknown_masters,
                "normalised": normalised,
            })

    return bp


bp = make_blueprint(registers.ASSETS)
peripherals_bp = make_blueprint(registers.PERIPHERALS)
softwares_bp = make_blueprint(registers.SOFTWARES)

BLUEPRINTS = (bp, peripherals_bp, softwares_bp)

