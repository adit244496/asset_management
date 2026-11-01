from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud, registers, xlsx
from app.datefmt import DAY_TIME, display_date, now_ist, to_ist
from app.models import AssetEvent
from app.registers import Register

MAX_RECORDS = 20_000
CHUNK = 1000

ACTION_LABELS = {
    "created": "Added", "imported": "Imported", "updated": "Edited", "deleted": "Deleted",
    "restored": "Restored", "purged": "Permanently deleted", "verified": "Verified",
    "rejected": "Sent back", "discarded": "Discarded",
}
EXTRA_FIELD_LABELS = {"linkedPeripherals": "Linked Peripherals", "linkedAssets": "Linked To",
                      "linkedAsset": "Linked To", "verification": "Verification"}
PERIPHERAL_LABELS = {"assetId": "Peripheral ID", "type": "Peripheral Type", "assetTag": "Peripheral Name"}


def _label(key: str, register: Register) -> str:
    if register is registers.PERIPHERALS and key in PERIPHERAL_LABELS:
        return PERIPHERAL_LABELS[key]
    return EXTRA_FIELD_LABELS.get(key) or crud.field_label(key, register)


def _when(moment) -> str:
    return to_ist(moment).strftime(DAY_TIME) if moment else ""


def _value(field: Optional[str], value: Optional[str]) -> str:
    if value and field in crud.DATE_FIELDS:
        return display_date(value) or value
    return value or ""


def _latest(row: dict[str, Any], register: Register) -> str:
    if row["lastAction"] == "updated" and row["lastField"]:
        return _label(row["lastField"], register)
    return ACTION_LABELS.get(row["lastAction"], row["lastAction"] or "")


def _change(ev: AssetEvent, register: Register) -> str:
    action = ACTION_LABELS.get(ev.action, ev.action)
    if not ev.field:
        return action
    if ev.action == "verified" and ev.field == "sapId":
        return f"Verified by SAP ID {ev.new_value}" if ev.new_value else action
    field = _label(ev.field, register)
    old, new = _value(ev.field, ev.old_value), _value(ev.field, ev.new_value)
    if old and new:
        return f"{field}: {old} → {new}"
    if new:
        return f"{field} set to {new}"
    if old:
        return f"{field} cleared (was {old})"
    return f"{action} {field}"


def _events(db: Session, pks: list[str], filters: list[Any], register: Register) -> list[AssetEvent]:
    out: list[AssetEvent] = []
    for start in range(0, len(pks), CHUNK):
        out.extend(db.execute(
            select(AssetEvent)
            .outerjoin(register.model, register.model.id == AssetEvent.asset_pk)
            .where(AssetEvent.asset_pk.in_(pks[start:start + CHUNK]), *filters)
        ).scalars().all())
    return out


def history_workbook(db: Session, register: Register, saved_by: str, applied: list[str],
                     pks: Optional[list[str]] = None, **query: Any) -> tuple[bytes, int, int]:
    if pks is not None:
        query = {}
    items, total = crud.list_history_by_asset(db, register=register, limit=MAX_RECORDS, offset=0,
                                              cap=MAX_RECORDS, pks=pks, **query)
    filter_keys = ("query", "action", "actor", "field", "date_from", "date_to", "search_in", "types", "statuses")
    filters = crud._history_filters(register=register, **{k: query[k] for k in filter_keys if k in query})

    order = {row["assetPk"]: i for i, row in enumerate(items)}
    events = _events(db, list(order), filters, register)
    events.sort(key=lambda e: (order.get(e.asset_pk, 0), e.at, e.id))
    by_pk = {row["assetPk"]: row for row in items}

    software = register is registers.SOFTWARES
    id_label = _label("assetId", register)
    name_label = _label("assetTag", register)
    type_label = _label("type", register)

    def identity(row: dict[str, Any], fallback_id: str = "") -> list[Any]:
        name = row.get("assetTag") if row.get("assetExists") else "(no longer in the register)"
        return [row.get("assetId") or fallback_id, *([] if software else [row.get("type") or ""]),
                name or "", *([] if software else [row.get("model") or ""]), row.get("status") or ""]

    who = [id_label, *([] if software else [type_label]), name_label, *([] if software else ["Model"]),
           "Current status"]
    trail = [[*who, "Change no.", "When", "What happened", "Field", "From", "To", "Change", "By"]]
    numbering: dict[str, int] = {}
    for ev in events:
        n = numbering[ev.asset_pk] = numbering.get(ev.asset_pk, 0) + 1
        trail.append([
            *identity(by_pk.get(ev.asset_pk, {}), ev.asset_number or ""), n, _when(ev.at),
            ACTION_LABELS.get(ev.action, ev.action), _label(ev.field, register) if ev.field else "",
            _value(ev.field, ev.old_value), _value(ev.field, ev.new_value), _change(ev, register),
            ev.actor or "",
        ])

    summary = [[*who, "Changes", "First change", "Latest change", "Latest change on", "Latest by"]]
    firsts: dict[str, Any] = {}
    for ev in events:
        firsts.setdefault(ev.asset_pk, ev.at)
    for row in items:
        last = datetime.fromisoformat(row["lastAt"]) if row["lastAt"] else None
        summary.append([*identity(row), row["changes"], _when(firsts.get(row["assetPk"])),
                        _latest(row, register), _when(last), row["lastActor"] or ""])

    picked = pks is not None
    about = [
        [f"IT Asset Engine — {register.noun.title()} Movement History"],
        ["Saved", now_ist().strftime(DAY_TIME)],
        ["By", saved_by],
        [register.plural.title(), len(items)],
        ["Changes", len(events)],
        ["Covers", f"The {len(items)} selected {register.plural if len(items) != 1 else register.noun}, "
                   "every change on record" if picked
         else ("; ".join(applied) if applied else "Every record with recorded changes")],
    ]
    if total > len(items):
        about.append(["Note", f"Only the {len(items)} most recently changed of {total} are included."])
    about += [[], ["Movement History: one row per change -- what changed, from what, to what, when and by "
                   "whom -- grouped by record, oldest change first. Filter any column in Excel."],
              ["Summary: one row per record with its number of changes."],
              ["Times are Indian Standard Time."]]

    ident_widths = [14, *([] if software else [16]), 24, *([] if software else [28]), 14]
    book = xlsx.workbook([
        ("Movement History", trail, ident_widths + [9, 18, 14, 20, 26, 26, 44, 18], True),
        ("Summary", summary, ident_widths + [9, 18, 20, 18, 18], True),
        ("About", about, [14, 80], False),
    ])
    return book, len(items), len(events)
