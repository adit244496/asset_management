import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import crud, registers, roles
from app.assistant import guide
from app.assistant import reports as R
from app.assistant.reports import ToolError  # noqa: F401 -- raised here, caught in run()
from app.masters import MASTERS
from app.models import AssistantProposal

MAX_ROWS = 25
HISTORY_EVENTS = 25
TEXT_CLIP = 200
EXAMPLES = 3

REGISTER_ENUM = R.REGISTER_ENUM
GROUP_BY_ENUM = R.GROUP_BY_ENUM
CATEGORY_ENUM = ["type", "status", "department", "company", "location"]

EDITABLE = {
    "status": "status",
    "location": "location",
    "floor": "floor",
    "department": "department",
    "company": "company",
    "assigned_user": "user",
    "email": "email",
    "sap_id": "sapId",
    "model": "model",
    "description": "description",
    "comments": "comments",
    "po_no": "poNo",
    "warranty_end": "warrantyEnd",
    "insurance_end": "insuranceEnd",
    "date_of_purchase": "dop",
    "assigned_date": "assignedDate",
    "version": "version",
    "quantity": "quantity",
    "price": "price",
    "vendor": "vendor",
    "renewal_date": "warrantyEnd",
}

SOFTWARE_EDITABLE = {"status", "version", "quantity", "price", "vendor", "renewal_date",
                     "warranty_end", "po_no", "comments"}
SOFTWARE_ONLY_EDITABLE = {"version", "quantity", "price", "vendor", "renewal_date"}

MASTERED = {"status": "status", "location": "location",
            "department": "department", "company": "company", "type": "type"}


def _text(description: str) -> dict:
    return {"type": "string", "description": description}


def _strict(name: str, description: str, properties: dict) -> dict:
    return {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        },
    }


_FILTERS = {
    "status": _text("Status, e.g. 'IN STOCK'; empty string for any."),
    "location": _text("Location name; empty string for any."),
    "type": _text("Asset type, e.g. 'LAPTOP'; empty string for any."),
    "make": _text("Manufacturer, e.g. 'DELL'; empty string for any."),
    "department": _text("Department name; empty string for any."),
    "company": _text("Company name; empty string for any."),
    "vendor": _text("Software only: Vendor / Used By (a vendor or the person using it); "
                    "empty string for any."),
}

_RANGE = {
    "date_field": {"type": "string", "enum": R.DATE_FIELD_ENUM,
                   "description": "The date date_from/date_to apply to. 'added' is when the "
                                  "record was entered into this app. 'none' for no date filter."},
    "date_from": _text("yyyy-mm-dd, inclusive; empty string for no lower limit."),
    "date_to": _text("yyyy-mm-dd, inclusive; empty string for no upper limit."),
    "lifecycle": {"type": "string", "enum": R.LIFECYCLE_ENUM,
                  "description": "'new': never handed on (still with its first holder, or never "
                                 "issued). 'replaced': handed on at least once. 'any'."},
}

TOOLS = [
    _strict(
        "app_help",
        "Step-by-step instructions for doing something in IT Asset Engine, for the "
        "asking person's profile. Use for every 'how do I...' question and answer "
        "only from what it returns.",
        {"topic_query": {"type": "string", "description": "What the person wants to do, in a few words."}},
    ),
    _strict(
        "check_attention",
        "What needs attention in the register: warranty or insurance ending soon, or "
        "already ended on items in use; in use with no assigned user; in stock but still "
        "assigned; peripherals in use but linked to no asset; software licences due for "
        "renewal or past their renewal date; and, for profiles that verify, entries "
        "waiting in Verification. The person sees a card listing each finding with its "
        "own download. register 'all' covers softwares too; 'both' is assets and peripherals.",
        {
            "register": {"type": "string", "enum": REGISTER_ENUM},
            "within_days": {"type": "integer", "description": "Days ahead that count as "
                            "'ending soon'. 90 unless the person said otherwise."},
        },
    ),
    _strict(
        "count_records",
        "Count records, optionally grouped by one field or two (e.g. laptops per "
        "location; location by status), or their average age since purchase. For "
        "software, measure 'total_seats' adds up Quantity and 'total_value' adds up Price. "
        "Set show_table true when the person asked for a breakdown or summary: they then "
        "see the table. Scrapped records are left out unless include_scrapped is true.",
        {
            "register": {"type": "string", "enum": REGISTER_ENUM},
            "group_by": {"type": "string", "enum": ["none", *GROUP_BY_ENUM],
                         "description": "Field to group by, or 'none' for a single total. "
                                        "For software: name, version, vendor, status, renewal_year."},
            "then_by": {"type": "string", "enum": ["none", *GROUP_BY_ENUM],
                        "description": "A second field, across the top of the table; 'none' for one."},
            "measure": {"type": "string", "enum": R.MEASURE_ENUM},
            **_FILTERS,
            "assigned_to": _text("Part of the assigned person's name; empty string for anyone."),
            **_RANGE,
            "include_scrapped": {"type": "boolean"},
            "show_table": {"type": "boolean"},
        },
    ),
    _strict(
        "get_history",
        "Every recorded change to one record, newest first: who changed what, from "
        "what, to what, and when. Use for 'who had this before' and 'what happened to' "
        "questions.",
        {"identifier": {"type": "string", "description": "Asset ID, Peripheral ID, Software ID, SAP ID, serial number, service tag, computer name or software name."}},
    ),
    _strict(
        "get_record",
        "One record in full, found by its Asset ID, Peripheral ID, Software ID (SFT...), "
        "SAP ID, serial number, service tag, computer name or software name. Searches "
        "every register.",
        {"identifier": {"type": "string"}},
    ),
    _strict(
        "list_values",
        "The current values of one Master Data list, e.g. every valid status or "
        "location. Only for when the person asks what values exist: filters and "
        "propose_change already report the valid values when a name does not match.",
        {"category": {"type": "string", "enum": CATEGORY_ENUM}},
    ),
    _strict(
        "make_report",
        "Prepare a report of the records matching the filters: the person gets a card "
        "with Excel, CSV and PDF downloads, Open in Report, and QR labels. Use it whenever "
        "they want more than a few records listed, a file, an export, a printout or QR "
        "labels. The rows go to them, not to you. One register per report.",
        {
            "register": {"type": "string", "enum": R.FILE_REGISTER_ENUM},
            "title": _text("Short title for the card and the file, e.g. 'Dell laptops in stock at Patna'."),
            "text": _text("Free text to look for; empty string for none."),
            **_FILTERS,
            "assigned_to": _text("Part of the assigned person's name; empty string for anyone."),
            **_RANGE,
            "check": {"type": "string", "enum": R.CHECK_ENUM,
                      "description": "'none', or one check_attention finding to list."},
            "within_days": {"type": "integer", "description": "For an 'expiring' check, the "
                            "days ahead (usually 90); otherwise 90."},
            "include_scrapped": {"type": "boolean"},
            "columns": {"type": "array", "items": {"type": "string", "enum": list(R.COLUMNS)},
                        "description": "Columns, in order; an empty list for the standard export columns."},
        },
    ),
    _strict(
        "propose_change",
        "Prepare a change to ONE record for the person to confirm. It does not apply "
        "the change: they see a Confirm button, and nothing happens unless they press "
        "it. kind 'update_fields' sets fields; kind 'transfer' moves an asset or "
        "peripheral to a location and optionally a person (or, for a peripheral in use, "
        "onto an asset); kind 'move' is for SOFTWARE only -- assign seats from stock to "
        "a person, or move seats back to stock, some or all of them. List only the "
        "fields being changed; for a transfer or move, leave fields empty. Look the "
        "record up first.",
        {
            "identifier": {"type": "string", "description": "The record, as for get_record."},
            "kind": {"type": "string", "enum": ["update_fields", "transfer", "move"]},
            "reason": {"type": "string", "description": "One short sentence, shown to the person, saying what this does."},
            "fields": {
                "type": "array",
                "description": "For update_fields: one entry per field that changes. Empty list for a transfer.",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string", "enum": list(EDITABLE)},
                        "value": _text("The new value. Empty string clears an optional field."),
                    },
                    "required": ["field", "value"],
                    "additionalProperties": False,
                },
            },
            "transfer": {
                "type": "object",
                "description": "For transfer. When kind is update_fields: empty strings and false.",
                "properties": {
                    "to_location": _text("Destination location (exact Master Data name)."),
                    "to_floor": _text("Destination floor; empty string leaves the floor as it is."),
                    "to_person": _text("Full name or username of the person it goes to (assets only); empty string for nobody."),
                    "onto_asset": _text("For a peripheral IN USE: the asset it is being plugged into; otherwise empty string."),
                    "allow_elsewhere": {"type": "boolean", "description": "True only if the person confirmed the recipient sits somewhere other than the destination."},
                },
                "required": ["to_location", "to_floor", "to_person", "onto_asset", "allow_elsewhere"],
                "additionalProperties": False,
            },
            "move": {
                "type": "object",
                "description": "For kind 'move' (software). Otherwise action 'none', quantity 0, to_person empty.",
                "properties": {
                    "action": {"type": "string", "enum": ["assign", "stock", "none"],
                               "description": "'assign': out of stock to to_person. 'stock': back into stock."},
                    "quantity": {"type": "integer", "description": "How many seats; the whole record if it is all of them."},
                    "to_person": _text("For 'assign': full name or username from the user directory; else empty string."),
                },
                "required": ["action", "quantity", "to_person"],
                "additionalProperties": False,
            },
        },
    ),
    _strict(
        "search_records",
        "Find records matching filters and/or free text (searched across IDs, SAP ID, "
        "serial, name, model, description, assigned user, and software version, vendor "
        "and PO number). Returns at most `limit` "
        "rows plus the total that matched. Scrapped records are left out unless "
        "include_scrapped is true.",
        {
            "register": {"type": "string", "enum": REGISTER_ENUM},
            "text": _text("Free text to look for; empty string for none."),
            **_FILTERS,
            "assigned_to": _text("Part of the assigned person's name; empty string for anyone."),
            "include_scrapped": {"type": "boolean"},
            "limit": {"type": "integer", "description": f"1 to {MAX_ROWS}. 10 is usually enough: "
                      "the total that matched always comes back, and count_records is "
                      "the tool for 'how many'."},
        },
    ),
]


@dataclass
class ToolContext:
    db: Session
    user: Any
    conversation: Any
    mode: str
    proposals: list = field(default_factory=list)
    cards: list = field(default_factory=list)
    _pools: Optional[R.Pools] = None

    @property
    def pools(self) -> R.Pools:
        if self._pools is None:
            self._pools = R.Pools(self.db)
        return self._pools


def _clip(value, n: int = TEXT_CLIP):
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= n else text[: n - 1] + "…"


_same = R.same


def _compact(item) -> dict:
    reg = registers.of(item)
    if reg is registers.SOFTWARES:
        out = {
            "register": reg.key, "softwareId": item.asset_id, "name": item.asset_tag,
            "version": item.version, "status": item.status, "serial": item.srl,
            "seats": item.quantity, "renewalDate": item.warranty_end, "price": item.price,
            "vendorOrUser": item.vendor, "poNumber": item.po_no, "scrapped": bool(item.is_deleted),
        }
        return {k: v for k, v in out.items() if v not in (None, "")}
    out = {
        "register": reg.key,
        "assetId": item.asset_id,
        "sapId": item.sap_id,
        "srl": item.srl,
        "type": item.type,
        "name": item.asset_tag,
        "model": item.model,
        "status": item.status,
        "location": item.location,
        "floor": item.floor,
        "department": item.department,
        "company": item.company,
        "scrapped": bool(item.is_deleted),
    }
    if reg is registers.ASSETS:
        out["assignedTo"] = item.user or None
    return {k: v for k, v in out.items() if v not in (None, "")}


def _full(db: Session, item) -> dict:
    reg = registers.of(item)
    if reg is registers.SOFTWARES:
        d = crud.asset_to_dict(item)
        out = {"register": reg.key, "softwareId": d.get("assetId"), "name": d.get("assetTag"),
               "version": d.get("version"), "status": d.get("status"),
               "availability": d.get("availability"), "serial": d.get("srl"),
               "seats": d.get("quantity"), "poNumber": d.get("poNo"),
               "renewalDate": d.get("warrantyEnd"), "price": d.get("price"),
               "vendorOrUser": d.get("vendor"), "comment": _clip(d.get("comments")),
               "isDeleted": d.get("isDeleted"), "updatedBy": d.get("updatedBy"),
               "updatedAt": d.get("updatedAt")}
        return {k: v for k, v in out.items() if v not in (None, "", False)}
    if reg is registers.ASSETS:
        d = crud.asset_to_dict(item, links=crud.linked_peripherals(db, item.id))
    else:
        d = crud.asset_to_dict(item, linked_to=crud.linked_assets(db, item.id),
                               shared=crud.shared_type_names(db))
    keep = ["register", "assetId", "sapId", "srl", "type", "assetTag", "model", "make",
            "description", "status", "availability", "user", "email", "department",
            "location", "site", "floor", "company", "poNo", "dop", "warrantyEnd", "insuranceEnd", "assignedDate",
            "comments", "linkedPeripheralsText", "linkedAssetText", "isDeleted",
            "previousStatus", "updatedBy", "updatedAt"]
    out = {k: d.get(k) for k in keep if d.get(k) not in (None, "")}
    for k in ("description", "comments"):
        if k in out:
            out[k] = _clip(out[k])
    return out


def _resolve_one(db: Session, identifier: str, register=None):
    _, matched_by, found = crud.lookup_assets(db, identifier, register)
    if not found:
        raise ToolError(f"No record matches {identifier!r}. Check the Asset ID, SAP ID or serial.")
    if len(found) > 1:
        options = ", ".join(f"{f.asset_id} ({f.asset_tag})" for f in found[:8])
        raise ToolError(f"{len(found)} records match {identifier!r}: {options}. "
                        "Ask which one, then use its Asset ID.")
    return found[0]


def _master_names(db: Session, category: str) -> list[str]:
    return [row.name for row in crud.list_master(db, MASTERS[category]) if row.is_active]


def _canonical(db: Session, category: str, value: str) -> str:
    names = _master_names(db, category)
    for name in names:
        if _same(name, value):
            return name
    shown = ", ".join(names[:25])
    raise ToolError(f"{value!r} is not a {category} in Master Data. Valid values: {shown}.")


def _rows(ctx: ToolContext, args, *, file: bool = False) -> tuple[dict, list]:
    spec = R.normalize(args, file=file)
    return spec, R.select(ctx.db, spec, pools=ctx.pools)


def _card(ctx: ToolContext, kind: str, **body) -> dict:
    card = {"type": kind, "id": uuid.uuid4().hex[:12], **body}
    ctx.cards.append(card)
    return card


def search_records(ctx: ToolContext, args: dict) -> dict:
    _, found = _rows(ctx, args)
    limit = max(1, min(int(args.get("limit") or 20), MAX_ROWS))
    return {"totalMatching": len(found), "shown": min(limit, len(found)),
            "records": [_compact(i) for i in found[:limit]]}


def count_records(ctx: ToolContext, args: dict) -> dict:
    spec, found = _rows(ctx, args)
    group_by = args.get("group_by") or "none"
    then_by = args.get("then_by") or "none"
    measure = args.get("measure") or "count"
    if measure not in R.MEASURE_ENUM:
        raise ToolError(f"measure must be one of {', '.join(R.MEASURE_ENUM)}.")
    out = R.summarize(found, group_by, then_by, measure)
    result = out["result"]
    if args.get("show_table") and out["table"]:
        title = R.summary_title(spec, group_by, then_by, measure)
        _card(ctx, "table", title=title, description=R.describe(spec), **out["table"])
        result["note"] = ("The person can see this table. Do not repeat it: give the "
                          "one or two points that answer their question.")
    return result


def get_record(ctx: ToolContext, args: dict) -> dict:
    _, matched_by, found = crud.lookup_assets(ctx.db, args.get("identifier") or "")
    if not found:
        raise ToolError(f"No record matches {args.get('identifier')!r}.")
    if len(found) == 1:
        return {"matchedBy": matched_by, "record": _full(ctx.db, found[0])}
    return {"matchedBy": matched_by, "count": len(found),
            "records": [_compact(i) for i in found[:MAX_ROWS]],
            "note": "Several records match; ask which one, or use its Asset ID."}


def get_history(ctx: ToolContext, args: dict) -> dict:
    item = _resolve_one(ctx.db, args.get("identifier") or "")
    events = crud.list_asset_events(ctx.db, item.id, limit=HISTORY_EVENTS, register=registers.of(item))
    return {
        "record": f"{item.asset_id} ({item.asset_tag})",
        "events": [{
            "at": e.at.isoformat() if e.at else None,
            "action": e.action,
            "field": e.field,
            "from": _clip(e.old_value, 120),
            "to": _clip(e.new_value, 120),
            "by": e.actor,
        } for e in events],
    }


def list_values(ctx: ToolContext, args: dict) -> dict:
    category = args.get("category")
    if category not in CATEGORY_ENUM:
        raise ToolError(f"Unknown list {category!r}.")
    return {"category": category, "values": _master_names(ctx.db, category)}


def app_help(ctx: ToolContext, args: dict) -> dict:
    hits = guide.search(ctx.user.role, args.get("topic_query") or "")
    if hits:
        return {"topics": [guide.public(t) for t in hits]}
    return {"topics": [], "note": "No matching topic. Topics available to this profile: "
            + "; ".join(t["title"] for t in guide.topics_for(ctx.user.role))}


def make_report(ctx: ToolContext, args: dict) -> dict:
    spec, found = _rows(ctx, args, file=True)
    columns = R.columns_for(args.get("columns") or [])
    if not found:
        return {"records": 0, "note": "Nothing matches, so no report was made. Say so, "
                "and suggest which filter to loosen."}
    noun = R.REGISTER_NOUNS.get(spec["register"], "records").lower()
    title = _clip((args.get("title") or "").strip(), 120) or f"Report of {noun}"
    _card(ctx, "report", title=title, register=spec["register"], count=len(found),
          columns=columns, spec=spec, description=R.describe(spec))
    return {"records": len(found), "title": title,
            "note": "The person now sees a card with Excel, CSV and PDF downloads, "
                    "Open in Report and QR labels. Do not list the records: say in one "
                    "sentence what the report holds."}


def check_attention(ctx: ToolContext, args: dict) -> dict:
    spec_base = R.normalize({"register": args.get("register") or "both",
                             "within_days": args.get("within_days")})
    days = spec_base["within_days"]
    items, clear = [], []
    for key, check in R.CHECKS.items():
        for reg in R.register_list(spec_base["register"]):
            if reg.key not in check["registers"]:
                continue
            spec = R.normalize({"register": reg.key, "check": key, "within_days": days})
            found = R.select(ctx.db, spec, strict=False, pools=ctx.pools)
            label = R.check_label(key, days)
            if not found:
                clear.append(f"{label} ({reg.plural})")
                continue
            items.append({
                "check": key, "label": label, "register": reg.key, "count": len(found),
                "spec": spec,
                "examples": [{"id": i.id, "assetId": i.asset_id, "name": i.asset_tag}
                             for i in found[:EXAMPLES]],
            })

    waiting = None
    if roles.can_verify(ctx.user.role):
        counts = crud.count_unverified(ctx.db)
        waiting = {"pending": counts.get(crud.PENDING, 0), "rejected": counts.get(crud.REJECTED, 0)}

    _card(ctx, "attention", title="What needs attention", days=days, items=items,
          clear=len(clear), verification=waiting)
    return {
        "found": [{"check": i["label"], "register": i["register"], "count": i["count"]}
                  for i in items],
        "allClear": clear,
        "verification": waiting if waiting is not None else "not shown to this profile",
        "note": "The person sees these as a card, each with Download and Open in Report. "
                "Summarize in a few short lines, most urgent first; do not list records.",
    }


def _gate(ctx: ToolContext):
    if not roles.can_write(ctx.user.role):
        raise ToolError("This person's profile is read-only, so no change can be prepared. "
                        "Explain that an admin can make it, and how, using app_help.")
    if ctx.mode != "changes":
        raise ToolError("The assistant is in Answer-only mode, so changes are switched off. "
                        "Explain how to do it in the app (use app_help), and mention that the "
                        "assistant can be switched to 'Can make changes' at the top of the panel.")


def _diff(key: str, old, new, reg=None) -> dict:
    return {"field": key, "label": crud.field_label(key, reg),
            "from": old if old not in ("", None) else None,
            "to": new if new not in ("", None) else None}


def _store(ctx: ToolContext, item, kind: str, method: str, path: str,
           payload: dict, diff: list, reason: str) -> dict:
    reg = registers.of(item)
    proposal = AssistantProposal(
        conversation_id=ctx.conversation.id,
        user_id=ctx.user.id,
        kind=kind,
        register=reg.key,
        record_pk=item.id,
        record_label=f"{item.asset_id} · {item.asset_tag}",
        method=method,
        path=path,
        payload=json.dumps(payload, sort_keys=True),
        diff=json.dumps(diff),
        reason=(reason or "")[:500],
    )
    ctx.db.add(proposal)
    ctx.db.flush()
    ctx.proposals.append(proposal)
    return {
        "proposalId": proposal.id,
        "status": "awaiting_confirmation",
        "record": proposal.record_label,
        "changes": diff,
        "note": "NOT applied. The person now sees a Confirm button for this change; "
                "tell them briefly what it will do and that it needs their confirmation.",
    }


def _propose_update(ctx: ToolContext, item, fields: list, reason: str) -> dict:
    reg = registers.of(item)
    current = crud.asset_to_dict(item)
    changes: dict[str, Any] = {}
    seen: set[str] = set()
    for entry in fields or []:
        name, value = (entry or {}).get("field"), (entry or {}).get("value")
        if name not in EDITABLE or value is None:
            continue
        if name in seen:
            raise ToolError(f"{name} is listed twice. Give each field once.")
        seen.add(name)
        key = EDITABLE[name]
        if key in crud.NOT_ON_PERIPHERALS and reg is registers.PERIPHERALS:
            raise ToolError(f"A peripheral has no {crud.field_label(key)} -- it follows the "
                            "asset it is plugged into.")
        if reg is registers.SOFTWARES and name not in SOFTWARE_EDITABLE:
            raise ToolError(f"A software record has no {name}. Its fields are: "
                            f"{', '.join(sorted(SOFTWARE_EDITABLE - {'warranty_end'}))}. "
                            "To give seats to someone or take them back, use kind 'move'.")
        if reg is not registers.SOFTWARES and name in SOFTWARE_ONLY_EDITABLE:
            raise ToolError(f"{name} is a software field; {item.asset_id} is "
                            f"{'an asset' if reg is registers.ASSETS else 'a peripheral'}.")
        value = str(value).strip()
        if key in MASTERED and value:
            value = _canonical(ctx.db, MASTERED[key], value)
        if str(current.get(key) if current.get(key) is not None else "") != value:
            changes[key] = value

    if not changes:
        raise ToolError("Nothing would change -- the record already has these values.")

    problems = crud.validate_asset_fields(changes, partial=True, register=reg,
                                          current_status=item.status, current=item)
    reserved = crud.reserved_status_error(changes.get("status"))
    if reserved:
        problems = [*problems, reserved]
    if problems:
        raise ToolError("That change would be refused: " + "; ".join(problems))

    diff = [_diff(k, current.get(k), v, reg) for k, v in changes.items()]
    if crud.is_in_stock(changes.get("status")) and reg is registers.ASSETS:
        for k in ("user", "email"):
            if current.get(k) and k not in changes:
                diff.append(_diff(k, current.get(k), None))
    return _store(ctx, item, "update_fields", "PATCH", f"/{reg.plural}/{item.id}",
                  changes, diff, reason)


def _find_person(db: Session, who: str):
    wanted = (who or "").strip().lower()
    people = [u for u in crud.list_users(db) if u.is_active]
    exact = [u for u in people if (u.username or "").lower() == wanted
             or (u.full_name or "").strip().lower() == wanted]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        names = ", ".join(f"{u.full_name} ({u.username}, {u.location or 'no location'})" for u in exact[:8])
        raise ToolError(f"Several people are called {who!r}: {names}. Ask which, then use their username.")
    near = [u for u in people if wanted and wanted in (u.full_name or "").lower()][:8]
    hint = (" Did you mean: " + ", ".join(f"{u.full_name} ({u.username})" for u in near) + "?") if near else ""
    raise ToolError(f"No one called {who!r} has a record.{hint}")


def _propose_transfer(ctx: ToolContext, item, transfer: dict, reason: str) -> dict:
    reg = registers.of(item)
    t = transfer or {}
    path = f"/{reg.plural}/{item.id}/transfer"

    if (reg is registers.PERIPHERALS
            and crud.peripheral_transfer_mode(item) == crud.TRANSFER_BY_ASSET):
        if not t.get("onto_asset"):
            raise ToolError("This peripheral is in use, so it moves onto an asset. "
                            "Ask which asset it is being plugged into (onto_asset).")
        onto = _resolve_one(ctx.db, t["onto_asset"], registers.ASSETS)
        linked = ", ".join(a.asset_id for a in crud.linked_assets(ctx.db, item.id)) or None
        diff = [
            {"field": "linkedAsset", "label": "Plugged into", "from": linked, "to": onto.asset_id},
            _diff("location", item.location, onto.location),
        ]
        return _store(ctx, item, "transfer", "POST", path, {"assetId": onto.id}, diff, reason)

    if not t.get("to_location"):
        raise ToolError("A transfer needs a destination location (to_location).")
    location = _canonical(ctx.db, "location", t["to_location"])
    payload: dict[str, Any] = {"location": location}
    diff = [_diff("location", item.location, location)]

    if (t.get("to_floor") or "").strip():
        payload["floor"] = str(t["to_floor"]).strip()
        diff.append(_diff("floor", item.floor, payload["floor"]))

    if t.get("to_person"):
        if reg is registers.PERIPHERALS:
            raise ToolError("A peripheral is not issued to a person; transfer it by location only.")
        holder = _find_person(ctx.db, t["to_person"])
        mismatch = crud.transfer_location_error(holder, location)
        if mismatch and not t.get("allow_elsewhere"):
            raise ToolError(mismatch + " Ask the person whether that is intended; if it is, "
                            "propose again with allow_elsewhere true.")
        payload["userId"] = holder.id
        if mismatch:
            payload["allowElsewhere"] = True
        diff.append(_diff("user", item.user, holder.full_name))
        diff.append(_diff("email", item.email, holder.email))

    return _store(ctx, item, "transfer", "POST", path, payload, diff, reason)


def _propose_move(ctx: ToolContext, item, move: dict, reason: str) -> dict:
    m = move or {}
    action = m.get("action")
    if action not in (crud.MOVE_ASSIGN, crud.MOVE_STOCK):
        raise ToolError("For kind 'move', action must be 'assign' (from stock to a person) or "
                        "'stock' (back into stock).")
    total = item.quantity or 1
    quantity = m.get("quantity") or total
    problem = crud.software_move_error(item, action, quantity)
    if problem:
        raise ToolError(problem)
    quantity = int(quantity)
    payload: dict[str, Any] = {"action": action, "quantity": quantity}
    reg = registers.SOFTWARES
    if action == crud.MOVE_ASSIGN:
        if not (m.get("to_person") or "").strip():
            raise ToolError("Assigning needs a person: ask who it goes to (to_person).")
        holder = _find_person(ctx.db, m["to_person"])
        payload["userId"] = holder.id
        target_status, target_vendor = crud.in_use_status(ctx.db), holder.full_name or holder.username
    else:
        target_status, target_vendor = crud.in_stock_status(ctx.db), None
    seats = f"{quantity} of {total}" if quantity < total else f"all {total}"
    diff = [
        {"field": "quantity", "label": "Seats moved", "from": None, "to": seats},
        _diff("status", item.status, target_status, reg),
        _diff("vendor", item.vendor, target_vendor, reg),
    ]
    if quantity < total:
        diff.append({"field": "split", "label": "Record", "from": None,
                     "to": f"{item.asset_id} keeps {total - quantity}; the {quantity} moved join "
                           f"{(target_vendor + chr(39) + 's') if action == crud.MOVE_ASSIGN else 'the stock'} "
                           f"{item.asset_tag} record, or a new one if there is none"})
    return _store(ctx, item, "move", "POST", f"/{reg.plural}/{item.id}/move", payload, diff, reason)


def propose_change(ctx: ToolContext, args: dict) -> dict:
    _gate(ctx)
    item = _resolve_one(ctx.db, args.get("identifier") or "")
    if item.is_deleted:
        raise ToolError(f"{item.asset_id} is scrapped. Only a superadmin can restore it, "
                        "from its row in Report.")
    kind = args.get("kind")
    is_software = registers.of(item) is registers.SOFTWARES
    if kind == "update_fields":
        return _propose_update(ctx, item, args.get("fields") or [], args.get("reason") or "")
    if kind == "transfer":
        if is_software:
            raise ToolError("Software has no location to transfer to. To give seats to someone, "
                            "or take them back into stock, use kind 'move'.")
        return _propose_transfer(ctx, item, args.get("transfer") or {}, args.get("reason") or "")
    if kind == "move":
        if not is_software:
            raise ToolError("kind 'move' is for software. Assets and peripherals use 'transfer'.")
        return _propose_move(ctx, item, args.get("move") or {}, args.get("reason") or "")
    raise ToolError(f"Unknown kind {kind!r}.")


EXECUTORS = {
    "app_help": app_help,
    "check_attention": check_attention,
    "count_records": count_records,
    "get_history": get_history,
    "get_record": get_record,
    "list_values": list_values,
    "make_report": make_report,
    "propose_change": propose_change,
    "search_records": search_records,
}


def run(ctx: ToolContext, name: str, args: dict) -> tuple[str, bool]:
    fn = EXECUTORS.get(name)
    if fn is None:
        return f"Unknown tool {name!r}.", True
    try:
        return json.dumps(fn(ctx, args or {}), default=str), False
    except ToolError as exc:
        return str(exc), True

