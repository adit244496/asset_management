import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import String, func, literal, or_, select, union_all
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, aliased

from app import registers, roles
from app.datefmt import ist_day_start_utc, to_ist, today_ist
from app.masters import MASTER_SPECS, MASTERS, MasterSpec, specs_for
from app.models import (
    ActivityLog, Asset, AssetEvent, AssetType, Counter, Make, Peripheral,
    PeripheralLink, User,
)
from app.registers import ASSETS, Register
from app.core.config import settings
from app.core.security import get_password_hash

VERIFIED = "verified"
PENDING = "pending"
REJECTED = "rejected"
VERIFICATION_STATES = (VERIFIED, PENDING, REJECTED)
VERIFICATION_NOTE_MAX = 500


def is_verified(item) -> bool:
    return (getattr(item, "verification", None) or VERIFIED) == VERIFIED


def entered_by(item, username: Optional[str]) -> bool:
    who = (getattr(item, "created_by", None) or "").strip().lower()
    return bool(who) and who == (username or "").strip().lower()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

REQUIRED_ASSET_FIELDS = [
    "type",
    "assetTag",
    "model",
    "description",
    "status",
    "user",
    "location",
    "company",
]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DATE_FIELDS = ("dop", "warrantyEnd", "insuranceEnd", "assignedDate")

FIELD_LABELS = {
    "srl": "Srl No.",
    "assetId": "Asset ID",
    "sapId": "SAP ID",
    "type": "Asset Type",
    "assetTag": "Computer / Asset Name",
    "model": "Model",
    "make": "Make",
    "description": "Description",
    "status": "Status",
    "user": "Assigned User",
    "email": "Email ID",
    "department": "Department",
    "location": "Location",
    "site": "Site",
    "floor": "Floor",
    "company": "Company",
    "poNo": "PO No.",
    "dop": "Date of Purchase (DOP)",
    "warrantyEnd": "Warranty / AMC End",
    "insuranceEnd": "Insurance Expiry",
    "assignedDate": "Assigned Date",
    "comments": "Comments",
    "availability": "Availability",
    "version": "Version",
    "quantity": "Quantity",
    "price": "Price",
    "vendor": "Vendor / Used By",
    "movedFrom": "Moved from",
}

SOFTWARE_LABELS = {
    "assetId": "Software ID",
    "assetTag": "Software Name",
    "srl": "Serial Number",
    "poNo": "PO Number",
    "warrantyEnd": "Renewal Date",
    "comments": "Comment",
}


def field_label(key: str, register: Optional[Register] = None) -> str:
    if register is registers.SOFTWARES and key in SOFTWARE_LABELS:
        return SOFTWARE_LABELS[key]
    return FIELD_LABELS.get(key, key)

ASSET_KEYS = [
    "srl", "assetId", "sapId", "type", "assetTag", "model", "make", "description",
    "status", "availability",
    "user", "email", "department",
    "location", "site", "floor",
    "company", "poNo", "dop", "warrantyEnd", "insuranceEnd", "assignedDate",
    "comments",
]

SERVER_ASSIGNED_KEYS = {
    "assetId", "availability", "serviceTag", "previousStatus", "site",
}

NOT_ON_PERIPHERALS = {"user", "email"}

SOFTWARE_KEYS = [
    "assetTag", "version", "status", "srl", "quantity", "poNo",
    "warrantyEnd", "price", "vendor", "comments",
]
SOFTWARE_ONLY_KEYS = ["version", "quantity", "price", "vendor"]

ALL_FIELD_KEYS = ASSET_KEYS + SOFTWARE_ONLY_KEYS


def fields_for(register: Register = ASSETS) -> list[str]:
    if register is ASSETS:
        return list(ASSET_KEYS)
    if register is registers.SOFTWARES:
        return ["assetId", *SOFTWARE_KEYS, "availability"]
    return [k for k in ASSET_KEYS if k not in NOT_ON_PERIPHERALS]

_KEY_TO_ATTR = {
    "srl": "srl",
    "assetId": "asset_id",
    "sapId": "sap_id",
    "type": "type",
    "assetTag": "asset_tag",
    "model": "model",
    "make": "make",
    "description": "description",
    "serviceTag": "service_tag",
    "status": "status",
    "availability": "availability",
    "user": "user",
    "email": "email",
    "department": "department",
    "location": "location",
    "site": "site",
    "floor": "floor",
    "company": "company",
    "poNo": "po_no",
    "dop": "dop",
    "warrantyEnd": "warranty_end",
    "insuranceEnd": "insurance_end",
    "assignedDate": "assigned_date",
    "comments": "comments",
    "previousStatus": "previous_status",
    "version": "version",
    "quantity": "quantity",
    "price": "price",
    "vendor": "vendor",
}

_ATTRS_BY_MODEL: dict[type, dict[str, str]] = {}


def attrs_of(item_or_model) -> dict[str, str]:
    model = item_or_model if isinstance(item_or_model, type) else type(item_or_model)
    found = _ATTRS_BY_MODEL.get(model)
    if found is None:
        columns = set(model.__table__.columns.keys())
        found = {k: a for k, a in _KEY_TO_ATTR.items() if a in columns}
        _ATTRS_BY_MODEL[model] = found
    return found


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


AVAILABLE = "ACTIVE"
UNAVAILABLE = "INACTIVE"

SCRAP_STATUS = "SCRAP"
RESERVED_STATUSES = {SCRAP_STATUS}


def reserved_status_error(new_status: Any, current_status: Any = None) -> Optional[str]:
    incoming = str(new_status or "").strip().upper()
    if incoming not in RESERVED_STATUSES:
        return None
    if incoming == str(current_status or "").strip().upper():
        return None
    return (
        f"status '{incoming}' is set automatically when an asset is deleted "
        "and cannot be chosen"
    )


_SERVICE_TAG_RE = re.compile(r"\[([^\]]+)\]")


def derive_service_tag(description: Any) -> Optional[str]:
    match = _SERVICE_TAG_RE.search(str(description or ""))
    if not match:
        return None
    tag = match.group(1).strip().upper()
    return tag or None


def derive_site(location: Any, current: Any = None) -> Optional[str]:
    text = "" if location is None else str(location).strip()
    if text:
        return text
    kept = "" if current is None else str(current).strip()
    return kept or None


_IN_STOCK = re.compile(r"^in[\s_-]*stock$", re.IGNORECASE)


def is_in_stock(status: Any) -> bool:
    return bool(_IN_STOCK.match(str(status or "").strip()))


def derive_availability(status: Any, is_deleted: bool = False) -> str:
    if is_deleted:
        return UNAVAILABLE
    return UNAVAILABLE if is_sold(status) else AVAILABLE


def is_sold(status: Any) -> bool:
    return "SOLD" in str(status or "").upper()


_SOLD_TO_PREFIX = re.compile(r"^\s*sold(?:\s+to\b|\s*[-:])\s*[-:]?\s*", re.IGNORECASE)


def buyer_name(holder: Any) -> Any:
    text = str(holder or "")
    rest = _SOLD_TO_PREFIX.sub("", text, count=1).strip()
    return rest if rest and rest != text.strip() else holder


def normalize_srl(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def srl_scope(register: Register = ASSETS) -> tuple[Register, ...]:
    return registers.HARDWARE if register in registers.HARDWARE else (register,)


def find_item_by_srl(db: Session, srl: Any, exclude_id: Optional[str] = None,
                     register: Register = ASSETS):
    key = normalize_srl(srl)
    if not key:
        return None
    for reg in srl_scope(register):
        model = reg.model
        stmt = select(model).where(func.lower(func.trim(model.srl)) == key)
        if exclude_id is not None:
            stmt = stmt.where(model.id != exclude_id)
        holder = db.execute(stmt.order_by(model.asset_id)).scalars().first()
        if holder is not None:
            return holder
    return None


def srl_taken_message(holder, value: Any) -> str:
    reg = registers.of(holder)
    who = holder.asset_id or f"another {reg.noun}"
    name = holder.asset_tag or holder.model
    if name:
        who = f"{who} ({name})"
    tail = (
        f" That {reg.noun} is deleted, but it still holds the serial -- clear it there"
        " first if this is the same device."
        if holder.is_deleted else ""
    )
    if not is_verified(holder):
        tail = (f" That {reg.noun} is waiting in Verification -- verify, correct or "
                "discard it there.")
    if reg is registers.SOFTWARES:
        return (
            f"Serial Number '{str(value).strip()}' already belongs to {reg.noun} {who}. "
            f"A licence serial identifies one licence, so it cannot be used twice.{tail}"
        )
    return (
        f"Srl No. '{str(value).strip()}' already belongs to {reg.noun} {who}. "
        f"A serial number identifies one device, so it cannot be used twice.{tail}"
    )


def duplicate_srl_error(
    db: Session, data: dict[str, Any], asset=None, register: Optional[Register] = None,
) -> Optional[str]:
    if "srl" not in data or not normalize_srl(data.get("srl")):
        return None
    reg = registers.of(asset) if asset is not None else (register or ASSETS)
    holder = find_item_by_srl(db, data["srl"], exclude_id=asset.id if asset is not None else None,
                              register=reg)
    return srl_taken_message(holder, data["srl"]) if holder is not None else None


SAP_ID_RE = re.compile(r"^\d{12}$")
PO_NO_RE = re.compile(r"^\d{10}$")
ID_FORMATS = (("sapId", "sap_id", SAP_ID_RE, "exactly 12 digits"),
              ("poNo", "po_no", PO_NO_RE, "exactly 10 digits"))


SRL_RE = re.compile(r"^[A-Za-z0-9-]+$")


def clean_srl(value: Any) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    return text.upper() or None


def srl_format_error(data: dict[str, Any], register: Register = ASSETS, current: Any = None) -> Optional[str]:
    if "srl" not in data or _blank(data.get("srl")):
        return None
    value = str(data["srl"]).strip()
    if current is not None and value.upper() == str(getattr(current, "srl", None) or "").strip().upper():
        return None
    if not SRL_RE.match(value):
        return (f"{field_label('srl', register)} may contain only letters, numbers and hyphens "
                f"(got {value!r})")
    if "--" in value:
        return f"{field_label('srl', register)} cannot have two hyphens in a row (got {value!r})"
    return None


def id_format_errors(data: dict[str, Any], register: Register = ASSETS, current: Any = None) -> list[str]:
    errors = []
    srl_error = srl_format_error(data, register, current)
    if srl_error:
        errors.append(srl_error)
    for key, attr, pattern, rule in ID_FORMATS:
        if key not in data or _blank(data.get(key)):
            continue
        value = str(data[key]).strip()
        if current is not None and value == str(getattr(current, attr, None) or "").strip():
            continue
        if not pattern.match(value):
            errors.append(f"{field_label(key, register)} must be {rule} (got {value!r})")
    return errors


def validate_asset_fields(
    data: dict[str, Any], partial: bool = False, register: Register = ASSETS,
    current_status: Any = None, current: Any = None,
) -> list[str]:
    errors: list[str] = []
    required = [f for f in REQUIRED_ASSET_FIELDS if f in fields_for(register)]
    effective_status = data.get("status") if "status" in data else current_status
    if is_in_stock(effective_status) and register is not registers.SOFTWARES:
        required = [f for f in required if f not in ("user", "email", "assetTag")]
    for field in required:
        if partial and field not in data:
            continue
        if _blank(data.get(field)):
            errors.append(f"{field_label(field, register)} is required")

    if "email" in data and not _blank(data.get("email")):
        if not EMAIL_RE.match(str(data["email"]).strip()):
            errors.append(f"{field_label('email')} must be a valid email address")

    for field in DATE_FIELDS:
        if field in data and not _blank(data.get(field)):
            if not DATE_RE.match(str(data[field]).strip()):
                errors.append(f"{field_label(field, register)} must be a valid date (dd-mm-yyyy)")

    if register is registers.SOFTWARES:
        errors.extend(software_format_errors(data))

    errors.extend(id_format_errors(data, register, current))
    return errors


_QUANTITY_RE = re.compile(r"^\d+(\.0+)?$")
_PRICE_RE = re.compile(r"^\d+(\.\d{1,2})?$")
PRICE_MAX = 50


def clean_price(value: Any) -> Optional[str]:
    text = re.sub(r"[\s,₹$€£]|(?i:rs\.?|inr)", "", str(value or ""))
    return text if text and _PRICE_RE.match(text) else None


def software_format_errors(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if "quantity" in data and not _blank(data.get("quantity")):
        if not _QUANTITY_RE.match(str(data["quantity"]).strip()):
            errors.append(f"{field_label('quantity')} must be a whole number, like 5")
    if "price" in data and not _blank(data.get("price")):
        if clean_price(data["price"]) is None or len(str(data["price"]).strip()) > PRICE_MAX:
            errors.append(f"{field_label('price')} must be an amount, like 12500 or 12500.50")
    return errors


def sanitize_optional_formats(data: dict[str, Any], register: Register = ASSETS) -> list[str]:
    notes: list[str] = []

    value = data.get("email")
    if not _blank(value) and not EMAIL_RE.match(str(value).strip()):
        notes.append(f'{field_label("email")} "{str(value).strip()}" is not a valid address'
                     f' - imported with that cell left blank')
        data["email"] = ""

    for field in DATE_FIELDS:
        value = data.get(field)
        if not _blank(value) and not DATE_RE.match(str(value).strip()):
            notes.append(f'{field_label(field, register)} "{str(value).strip()}" is not a date (dd-mm-yyyy)'
                         f' - imported with that date left blank')
            data[field] = ""

    if register is registers.SOFTWARES:
        for field in ("quantity", "price"):
            value = data.get(field)
            if not _blank(value) and software_format_errors({field: value}):
                notes.append(f'{field_label(field)} "{str(value).strip()}" is not a number'
                             f' - imported with that cell left blank')
                data[field] = ""

    return notes


ASSET_ID_DIGITS = 6

_ID_RES = {reg.prefix: re.compile(rf"^{reg.prefix}(\d+)$", re.IGNORECASE) for reg in registers.ALL}


def format_asset_id(number: int, register: Register = ASSETS) -> str:
    return f"{register.prefix}{number:0{ASSET_ID_DIGITS}d}"


def parse_asset_id(value: Any, register: Register = ASSETS) -> Optional[int]:
    match = _ID_RES[register.prefix].match(str(value or "").strip())
    return int(match.group(1)) if match else None


def next_asset_id(db: Session, register: Register = ASSETS) -> str:
    row = db.execute(
        select(Counter).where(Counter.name == register.counter).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        row = Counter(name=register.counter, next_value=1)
        db.add(row)
        db.flush()

    number = row.next_value
    row.next_value = number + 1
    db.flush()
    return format_asset_id(number, register)


def _set_counter(db: Session, value: int, register: Register = ASSETS) -> None:
    row = db.get(Counter, register.counter)
    if row is None:
        db.add(Counter(name=register.counter, next_value=value))
    else:
        row.next_value = value
    db.commit()


def compact_asset_ids(db: Session, register: Register = ASSETS) -> int:
    model = register.model
    items = list(db.execute(select(model)).scalars().all())
    ordered = sorted(items, key=lambda a: (parse_asset_id(a.asset_id, register) or 0, a.id))

    moves = [
        (item, format_asset_id(position, register))
        for position, item in enumerate(ordered, start=1)
        if item.asset_id != format_asset_id(position, register)
    ]
    if not moves:
        _set_counter(db, len(ordered) + 1, register)
        return 0

    for item, _ in moves:
        item.asset_id = "TMP-" + item.id[:12]
    db.flush()
    for item, final in moves:
        item.asset_id = final
    db.commit()

    _set_counter(db, len(ordered) + 1, register)
    return len(moves)


def reset_asset_id_counter(db: Session, register: Register = ASSETS) -> None:
    row = db.get(Counter, register.counter)
    if row is None:
        db.add(Counter(name=register.counter, next_value=1))
    else:
        row.next_value = 1
    db.commit()


def ensure_asset_id_counter(db: Session, register: Register = ASSETS) -> None:
    model = register.model
    highest = 0
    for value in db.execute(select(model.asset_id)).scalars().all():
        number = parse_asset_id(value, register)
        if number and number > highest:
            highest = number

    row = db.get(Counter, register.counter)
    if row is None:
        db.add(Counter(name=register.counter, next_value=highest + 1))
    elif row.next_value <= highest:
        row.next_value = highest + 1
    db.commit()


def backfill_derived_fields(db: Session, register: Register = ASSETS) -> int:
    stmt = select(register.model).where(register.model.availability.is_(None))
    stale = list(db.execute(stmt).scalars().all())
    if not stale:
        return 0

    for item in stale:
        item.availability = derive_availability(item.status)
        item.service_tag = derive_service_tag(item.description)
    db.commit()
    return len(stale)


def strip_sold_to_prefixes(db: Session, register: Register = ASSETS) -> int:
    if register is not ASSETS:
        return 0
    m = register.model
    rows = db.execute(select(m).where(m.status.ilike("%sold%"), m.user.ilike("sold%"))).scalars().all()
    changed = 0
    for item in rows:
        name = buyer_name(item.user)
        if name == item.user:
            continue
        record_event(db, item, EVENT_UPDATED, "system", field="user",
                     old_value=item.user, new_value=name)
        item.user = name
        changed += 1
    if changed:
        db.commit()
    return changed


def backfill_service_tags(db: Session, register: Register = ASSETS) -> int:
    stmt = select(register.model).where(
        register.model.service_tag.is_(None), register.model.description.like("%[%")
    )
    stale = list(db.execute(stmt).scalars().all())
    filled = 0
    for item in stale:
        tag = derive_service_tag(item.description)
        if tag:
            item.service_tag = tag
            filled += 1
    if filled:
        db.commit()
    return filled


def backfill_asset_ids(db: Session, register: Register = ASSETS) -> int:
    model = register.model
    missing = list(db.execute(select(model).where(model.asset_id.is_(None))).scalars().all())
    if not missing:
        return 0

    def order_key(item):
        srl = (item.srl or "").strip()
        return (item.created_at, int(srl) if srl.isdigit() else 10**9, item.id)

    for item in sorted(missing, key=order_key):
        item.asset_id = next_asset_id(db, register)
    db.commit()
    return len(missing)


def _apply_asset_fields(asset, data: dict[str, Any]) -> None:
    is_asset = registers.of(asset) is ASSETS
    is_software = registers.of(asset) is registers.SOFTWARES
    skip = SERVER_ASSIGNED_KEYS if is_asset else (
        SERVER_ASSIGNED_KEYS | NOT_ON_PERIPHERALS
    )
    if is_software:
        skip = SERVER_ASSIGNED_KEYS | (set(_KEY_TO_ATTR) - set(SOFTWARE_KEYS))
    user_before = asset.user
    date_before = getattr(asset, "assigned_date", None)
    status_before = asset.status
    for key, attr in attrs_of(asset).items():
        if key in skip or key not in data:
            continue
        value = data[key]
        if isinstance(value, str):
            value = value.strip()
        if value in ("", None):
            value = None
        elif key == "quantity":
            value = int(str(value).strip().split(".")[0])
        elif key == "price":
            value = clean_price(value)
        elif key == "srl":
            value = clean_srl(value)
        setattr(asset, attr, value)

    for column in type(asset).__table__.columns:
        if (not column.nullable and column.default is None
                and isinstance(column.type, String)
                and getattr(asset, column.name, None) is None):
            setattr(asset, column.name, "")

    asset.availability = derive_availability(asset.status, bool(asset.is_deleted))
    asset.service_tag = derive_service_tag(asset.description)
    asset.site = derive_site(asset.location, asset.site)
    if is_software and asset.site is None:
        asset.site = ""

    if is_in_stock(asset.status):
        asset.user = ""
        asset.email = None

    if (is_asset and is_in_stock(asset.status)
            and status_before is not None and not is_in_stock(status_before)):
        asset.asset_tag = ""

    if is_asset and is_sold(asset.status):
        asset.user = buyer_name(asset.user)

    if is_asset:
        note_assignment(asset, user_before)
        note_assigned_date(asset, user_before, date_before, data)


def in_use_status(db: Session) -> str:
    for row in list_master(db, MASTERS["status"]):
        if row.is_active and is_in_use(row.name):
            return row.name
    return "IN USE"


def handing_over_from_stock(asset, data: dict[str, Any]) -> bool:
    if registers.of(asset) is not ASSETS or not is_in_stock(asset.status):
        return False
    holder = str(data.get("user") or "").strip()
    if not holder:
        return False
    asked = str(data.get("status") or "").strip()
    return not asked or _same_person(asked, asset.status)


def today_iso() -> str:
    return today_ist().isoformat()


def note_assigned_date(asset, user_before: Any, date_before: Any, data: dict[str, Any]) -> None:
    holder = str(asset.user or "").strip()
    if not holder:
        asset.assigned_date = None
        return
    if _same_person(user_before, holder):
        return
    given = str(data.get("assignedDate") or "").strip()
    if given and given != str(date_before or "").strip():
        return
    asset.assigned_date = today_iso()


EVENT_CREATED = "created"
EVENT_IMPORTED = "imported"
EVENT_UPDATED = "updated"
EVENT_DELETED = "deleted"
EVENT_RESTORED = "restored"
EVENT_PURGED = "purged"
EVENT_VERIFIED = "verified"
EVENT_REJECTED = "rejected"
EVENT_DISCARDED = "discarded"

_HISTORY_SKIP_KEYS = {"assetId", "availability", "serviceTag", "previousStatus"}
HISTORY_KEYS = [k for k in _KEY_TO_ATTR if k not in _HISTORY_SKIP_KEYS]


def _history_snapshot(asset: Asset) -> dict[str, Any]:
    attrs = attrs_of(asset)
    return {key: getattr(asset, attrs[key], None) for key in HISTORY_KEYS if key in attrs}


def _as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text if text.strip() else None


def record_event(
    db: Session,
    asset,
    action: str,
    actor: Optional[str] = None,
    field: Optional[str] = None,
    old_value: Any = None,
    new_value: Any = None,
) -> AssetEvent:
    event = AssetEvent(
        register=registers.of(asset).key,
        asset_pk=asset.id,
        asset_number=asset.asset_id,
        action=action,
        field=field,
        old_value=_as_text(old_value),
        new_value=_as_text(new_value),
        actor=actor,
    )
    db.add(event)
    return event


def record_field_changes(
    db: Session, asset: Asset, before: dict[str, Any], actor: Optional[str] = None
) -> int:
    written = 0
    attrs = attrs_of(asset)
    for key in HISTORY_KEYS:
        if key not in attrs:
            continue
        old = before.get(key)
        new = getattr(asset, attrs[key], None)
        if _as_text(old) == _as_text(new):
            continue
        record_event(db, asset, EVENT_UPDATED, actor, field=key, old_value=old, new_value=new)
        written += 1
    return written


def list_asset_events(
    db: Session, asset_pk: str, limit: int = 500, register: Register = ASSETS
) -> list[AssetEvent]:
    return list(
        db.execute(
            select(AssetEvent)
            .where(AssetEvent.asset_pk == asset_pk, AssetEvent.register == register.key)
            .order_by(AssetEvent.at.desc(), AssetEvent.id.desc())
            .limit(limit)
        ).scalars().all()
    )


EVENT_ACTIONS = [EVENT_CREATED, EVENT_IMPORTED, EVENT_UPDATED, EVENT_DELETED,
                 EVENT_RESTORED, EVENT_PURGED, EVENT_VERIFIED, EVENT_REJECTED,
                 EVENT_DISCARDED]


ACTIVITY_OUTCOMES = ["ok", "failed"]

ACTIVITY_CATEGORIES = ["auth", "users", "masters", "asset", "peripheral", "software",
                       "verification", "assistant", "notifications"]


def record_activity(
    db: Session,
    *,
    actor: Optional[str],
    actor_role: Optional[str],
    action: str,
    category: str,
    summary: str = "",
    target: Optional[str] = None,
    outcome: str = "ok",
    status_code: int = 200,
    method: str = "",
    path: str = "",
    ip: Optional[str] = None,
) -> ActivityLog:
    row = ActivityLog(
        actor=actor,
        actor_role=actor_role,
        action=action,
        category=category,
        summary=summary[:400],
        target=target[:200] if target else None,
        outcome=outcome,
        status_code=status_code,
        method=method[:10],
        path=path[:300],
        ip=ip[:45] if ip else None,
    )
    db.add(row)
    db.commit()
    return row


def _activity_union():
    from_activity = select(
        ActivityLog.at.label("at"),
        ActivityLog.actor.label("actor"),
        ActivityLog.actor_role.label("actor_role"),
        ActivityLog.category.label("category"),
        ActivityLog.action.label("action"),
        ActivityLog.summary.label("summary"),
        ActivityLog.target.label("target"),
        literal(None).label("field"),
        literal(None).label("old_value"),
        literal(None).label("new_value"),
        ActivityLog.outcome.label("outcome"),
        ActivityLog.ip.label("ip"),
        literal("activity").label("source"),
    )

    from_events = select(
        AssetEvent.at.label("at"),
        AssetEvent.actor.label("actor"),
        literal(None).label("actor_role"),
        AssetEvent.register.label("category"),
        AssetEvent.action.label("action"),
        literal(None).label("summary"),
        AssetEvent.asset_number.label("target"),
        AssetEvent.field.label("field"),
        AssetEvent.old_value.label("old_value"),
        AssetEvent.new_value.label("new_value"),
        literal("ok").label("outcome"),
        literal(None).label("ip"),
        literal("register").label("source"),
    )

    return union_all(from_activity, from_events).subquery("activity_feed")


def _ist_day_filters(column, date_from: str = "", date_to: str = "") -> list[Any]:
    """From the start of `date_from` to the end of `date_to`, both whole IST days."""
    out: list[Any] = []
    start = ist_day_start_utc(date_from) if date_from else None
    if start is not None:
        out.append(column >= start)
    end = ist_day_start_utc(date_to) if date_to else None
    if end is not None:
        out.append(column < end + timedelta(days=1))
    return out


def _activity_filters(feed, *, query="", actor="", category="", action="",
                      outcome="", date_from="", date_to="") -> list[Any]:
    filters: list[Any] = []

    if actor:
        filters.append(func.lower(feed.c.actor) == actor.strip().lower())
    if category:
        filters.append(feed.c.category == category.strip())
    if action:
        filters.append(feed.c.action == action.strip())
    if outcome:
        filters.append(feed.c.outcome == outcome.strip())
    filters.extend(_ist_day_filters(feed.c.at, date_from, date_to))

    if query:
        like = f"%{query.strip().lower()}%"
        filters.append(or_(
            func.lower(feed.c.actor).like(like),
            func.lower(feed.c.summary).like(like),
            func.lower(feed.c.target).like(like),
            func.lower(feed.c.action).like(like),
            func.lower(feed.c.field).like(like),
            func.lower(feed.c.old_value).like(like),
            func.lower(feed.c.new_value).like(like),
        ))

    return filters


def activity_row_dict(row, roles_by_actor: dict[str, str]) -> dict[str, Any]:
    summary = row.summary
    if not summary:
        if row.field:
            old = row.old_value or "—"
            new = row.new_value or "—"
            summary = f"{row.field}: {old} → {new}"
        else:
            summary = f"{str(row.action).capitalize()} {row.target or ''}".strip()

    return {
        "at": row.at.isoformat() if row.at else None,
        "actor": row.actor,
        "actorRole": row.actor_role or roles_by_actor.get((row.actor or "").lower()),
        "actorRoleIsCurrent": row.actor_role is None,
        "category": row.category,
        "action": row.action,
        "summary": summary,
        "target": row.target,
        "field": row.field,
        "oldValue": row.old_value,
        "newValue": row.new_value,
        "outcome": row.outcome,
        "ip": row.ip,
        "source": row.source,
    }


def activity_cleared_at(db: Session) -> Optional[datetime]:
    from app.models import NotificationSettings
    row = db.get(NotificationSettings, 1)
    raw = getattr(row, "activity_cleared_at", None) if row is not None else None
    if not raw:
        return None
    try:
        at = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _since_cleared(db: Session, feed) -> list[Any]:
    cleared = activity_cleared_at(db)
    return [feed.c.at > cleared] if cleared else []


def list_activity(
    db: Session,
    *,
    query: str = "",
    actor: str = "",
    category: str = "",
    action: str = "",
    outcome: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    feed = _activity_union()
    filters = _activity_filters(
        feed, query=query, actor=actor, category=category, action=action,
        outcome=outcome, date_from=date_from, date_to=date_to,
    ) + _since_cleared(db, feed)

    total = db.execute(
        select(func.count()).select_from(feed).where(*filters)
    ).scalar_one()

    rows = db.execute(
        select(feed)
        .where(*filters)
        .order_by(feed.c.at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    roles_by_actor = {
        (u.username or "").lower(): u.role
        for u in db.execute(select(User.username, User.role)).all()
    }
    return [activity_row_dict(r, roles_by_actor) for r in rows], total


def list_activity_actors(db: Session) -> list[str]:
    feed = _activity_union()
    names = db.execute(
        select(feed.c.actor).where(feed.c.actor.isnot(None), *_since_cleared(db, feed)).distinct()
    ).scalars().all()
    return sorted({n for n in names if n}, key=str.lower)


def list_activity_actions(db: Session) -> list[str]:
    feed = _activity_union()
    actions = db.execute(select(feed.c.action).where(*_since_cleared(db, feed)).distinct()).scalars().all()
    return sorted({a for a in actions if a}, key=str.lower)


def _as_list(value: Any) -> list[str]:
    items = value if isinstance(value, (list, tuple, set)) else [value]
    return [str(v).strip() for v in items if str(v or "").strip()]


def _history_search_columns(model) -> dict[str, list]:
    return {
        "assetId": [model.asset_id, AssetEvent.asset_number],
        "type": [model.type],
        "assetTag": [model.asset_tag],
        "model": [model.model],
        "srl": [model.srl],
        "status": [model.status],
        "value": [AssetEvent.old_value, AssetEvent.new_value],
        "actor": [AssetEvent.actor],
    }


HISTORY_SEARCH_IN = ("assetId", "type", "assetTag", "model", "srl", "status", "value", "actor")


def _history_filters(
    query: str = "",
    action: Any = "",
    actor: Any = "",
    field: str = "",
    date_from: str = "",
    date_to: str = "",
    register: Register = ASSETS,
    search_in: str = "",
    types: Any = None,
    statuses: Any = None,
) -> list[Any]:
    model = register.model
    filters: list[Any] = [
        AssetEvent.register == register.key,
        or_(model.id.is_(None), model.verification == VERIFIED),
    ]

    actions = _as_list(action)
    if actions:
        filters.append(AssetEvent.action.in_(actions))
    actors = [a.lower() for a in _as_list(actor)]
    if actors:
        filters.append(func.lower(AssetEvent.actor).in_(actors))
    wanted_types = [t.lower() for t in _as_list(types)]
    if wanted_types:
        filters.append(func.lower(model.type).in_(wanted_types))
    wanted_statuses = [s.lower() for s in _as_list(statuses)]
    if wanted_statuses:
        filters.append(func.lower(model.status).in_(wanted_statuses))
    if field:
        filters.append(AssetEvent.field == field)
    filters.extend(_ist_day_filters(AssetEvent.at, date_from, date_to))

    if query and search_in:
        like = f"%{query.strip().lower()}%"
        columns = _history_search_columns(model)[search_in]
        filters.append(or_(*(func.lower(col).like(like) for col in columns)))
    elif query:
        like = f"%{query.strip().lower()}%"
        filters.append(or_(
            func.lower(AssetEvent.asset_number).like(like),
            func.lower(AssetEvent.old_value).like(like),
            func.lower(AssetEvent.new_value).like(like),
            func.lower(AssetEvent.actor).like(like),
            func.lower(AssetEvent.field).like(like),
            func.lower(model.asset_id).like(like),
            func.lower(model.asset_tag).like(like),
            func.lower(model.model).like(like),
            func.lower(model.srl).like(like),
            func.lower(model.type).like(like),
        ))

    return filters


def list_history_by_asset(
    db: Session,
    *,
    query: str = "",
    action: Any = "",
    actor: Any = "",
    field: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 50,
    offset: int = 0,
    register: Register = ASSETS,
    search_in: str = "",
    types: Any = None,
    statuses: Any = None,
    min_changes: int = 0,
    cap: int = 500,
    pks: Optional[list[str]] = None,
) -> tuple[list[dict[str, Any]], int]:
    model = register.model
    filters = _history_filters(query, action, actor, field, date_from, date_to, register,
                               search_in=search_in, types=types, statuses=statuses)
    if pks is not None:
        filters.append(AssetEvent.asset_pk.in_(pks))
    capped = max(1, min(limit, cap))

    if min_changes > 1:
        busy = (
            select(AssetEvent.asset_pk)
            .select_from(AssetEvent)
            .outerjoin(model, model.id == AssetEvent.asset_pk)
            .where(*filters)
            .group_by(AssetEvent.asset_pk)
            .having(func.count() >= min_changes)
        )
        filters = [*filters, AssetEvent.asset_pk.in_(busy)]

    total = db.execute(
        select(func.count(func.distinct(AssetEvent.asset_pk)))
        .select_from(AssetEvent)
        .outerjoin(model, model.id == AssetEvent.asset_pk)
        .where(*filters)
    ).scalar_one()

    ranked = (
        select(
            AssetEvent,
            func.row_number().over(
                partition_by=AssetEvent.asset_pk,
                order_by=(AssetEvent.at.desc(), AssetEvent.id.desc()),
            ).label("rn"),
        )
        .outerjoin(model, model.id == AssetEvent.asset_pk)
        .where(*filters)
        .subquery()
    )
    event = aliased(AssetEvent, ranked)

    rows = db.execute(
        select(event, model)
        .select_from(ranked)
        .outerjoin(model, model.id == ranked.c.asset_pk)
        .where(ranked.c.rn == 1)
        .order_by(ranked.c.at.desc(), ranked.c.id.desc())
        .limit(capped)
        .offset(max(0, offset))
    ).all()

    page_pks = [r[0].asset_pk for r in rows]
    counts: dict[str, int] = {}
    if page_pks:
        counts = dict(db.execute(
            select(AssetEvent.asset_pk, func.count())
            .select_from(AssetEvent)
            .outerjoin(model, model.id == AssetEvent.asset_pk)
            .where(AssetEvent.asset_pk.in_(page_pks), *filters)
            .group_by(AssetEvent.asset_pk)
        ).all())

    return (
        [history_row_to_dict(ev, asset, counts.get(ev.asset_pk, 0)) for ev, asset in rows],
        total,
    )


def history_row_to_dict(
    event: AssetEvent, asset, changes: int
) -> dict[str, Any]:
    return {
        "assetPk": event.asset_pk,
        "assetId": asset.asset_id if asset else event.asset_number,
        "recordedAssetId": event.asset_number,
        "assetTag": asset.asset_tag if asset else None,
        "type": asset.type if asset else None,
        "model": asset.model if asset else None,
        "status": asset.status if asset else None,
        "isDeleted": bool(asset.is_deleted) if asset else False,
        "assetExists": asset is not None,
        "changes": changes,
        "lastAction": event.action,
        "lastField": event.field,
        "lastOldValue": event.old_value,
        "lastNewValue": event.new_value,
        "lastActor": event.actor,
        "lastAt": event.at.isoformat() if event.at else None,
    }


def list_event_actors(db: Session, register: Register = ASSETS) -> list[str]:
    values = db.execute(
        select(AssetEvent.actor)
        .where(AssetEvent.actor.is_not(None), AssetEvent.register == register.key)
        .distinct()
    ).scalars().all()
    return sorted({v for v in values if v})


def event_to_dict(event: AssetEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "assetId": event.asset_number,
        "action": event.action,
        "field": event.field,
        "oldValue": event.old_value,
        "newValue": event.new_value,
        "actor": event.actor,
        "at": event.at.isoformat() if event.at else None,
    }


LOOKUP_KEYS = ("assetId", "srl", "serviceTag", "assetTag")

_ASSET_ID_LOOSE = re.compile(
    rf"^({'|'.join(reg.prefix for reg in registers.ALL)})\d+$", re.IGNORECASE
)


def parse_lookup_query(raw: Any) -> str:
    text = ("" if raw is None else str(raw)).strip()
    if not text:
        return ""

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) <= 1:
        return text

    if _ASSET_ID_LOOSE.match(lines[0]):
        return lines[0]

    for prefix in ("Srl:", "Tag:"):
        for line in lines:
            if line.lower().startswith(prefix.lower()):
                value = line[len(prefix):].strip()
                if value:
                    return value

    return lines[0]


def lookup_assets(
    db: Session, raw_query: Any, register: Optional[Register] = None
) -> tuple[str, Optional[str], list]:
    query = parse_lookup_query(raw_query)
    if not query:
        return "", None, []

    needle = query.strip().lower()
    searched = registers.ALL if register is None else (register,)

    def exact(model, column):
        return list(db.execute(
            select(model).where(func.lower(func.trim(column)) == needle,
                                model.verification == VERIFIED)
            .order_by(model.asset_id)
        ).scalars().all())

    for key in ("assetId", "sapId", "srl", "serviceTag", "assetTag"):
        found = []
        for reg in searched:
            column = {
                "assetId": reg.model.asset_id,
                "sapId": reg.model.sap_id,
                "srl": reg.model.srl,
                "serviceTag": reg.model.service_tag,
                "assetTag": reg.model.asset_tag,
            }[key]
            found.extend(exact(reg.model, column))
        if found:
            return query, key, found

    partial = []
    for reg in searched:
        partial.extend(db.execute(
            select(reg.model).where(func.lower(reg.model.asset_tag).like(f"%{needle}%"),
                                    reg.model.verification == VERIFIED)
            .order_by(reg.model.asset_id).limit(25)
        ).scalars().all())
    if partial:
        return query, "assetTagPartial", partial[:25]

    return query, None, []


def get_asset(db: Session, asset_id: str, register: Register = ASSETS):
    return db.get(register.model, asset_id)


def list_assets(db: Session, register: Register = ASSETS) -> list:
    model = register.model
    return list(db.execute(
        select(model).where(model.verification == VERIFIED).order_by(model.created_at)
    ).scalars().all())


def list_unverified(db: Session, register: Register = ASSETS) -> list:
    model = register.model
    return list(db.execute(
        select(model).where(model.verification != VERIFIED).order_by(model.created_at)
    ).scalars().all())


def count_unverified(db: Session) -> dict[str, int]:
    out = {PENDING: 0, REJECTED: 0}
    for reg in registers.ALL:
        rows = db.execute(
            select(reg.model.verification, func.count())
            .where(reg.model.verification != VERIFIED)
            .group_by(reg.model.verification)
        ).all()
        for state, n in rows:
            out[state] = out.get(state, 0) + n
    return out


def has_sap_id(item) -> bool:
    return bool(str(getattr(item, "sap_id", None) or "").strip())


def starting_verification(item) -> str:
    if not settings.VERIFY_NEW_RECORDS or has_sap_id(item):
        return VERIFIED
    return PENDING


def accept_by_sap_id(db: Session, item, username: str, was: str = PENDING) -> None:
    item.verification = VERIFIED
    item.verified_by = None
    item.verified_at = _utcnow()
    item.verification_note = None
    record_event(db, item, EVENT_VERIFIED, username,
                 field="sapId", old_value=was, new_value=item.sap_id)


def create_asset(db: Session, data: dict[str, Any], username: str, register: Register = ASSETS):
    asset = register.model()
    canonicalise_master_values(data, master_value_index(db), register)
    _apply_asset_fields(asset, data)
    asset.asset_id = next_asset_id(db, register)
    asset.created_by = username
    asset.updated_by = username
    by_sap_id = settings.VERIFY_NEW_RECORDS and has_sap_id(asset)
    asset.verification = starting_verification(asset)
    db.add(asset)
    db.flush()
    record_event(db, asset, EVENT_CREATED, username)
    if by_sap_id:
        accept_by_sap_id(db, asset, username)
    sync_masters_from_values(db, data, register)
    db.commit()
    db.refresh(asset)
    return asset


def update_asset(db: Session, asset, data: dict[str, Any], username: str):
    before = _history_snapshot(asset)
    if handing_over_from_stock(asset, data):
        data = {**data, "status": in_use_status(db)}
    register = registers.of(asset)
    canonicalise_master_values(data, master_value_index(db), register)
    _apply_asset_fields(asset, data)
    asset.updated_by = username
    was = asset.verification
    if asset.verification == REJECTED:
        asset.verification = PENDING
    record_field_changes(db, asset, before, username)
    if was in (PENDING, REJECTED) and has_sap_id(asset):
        accept_by_sap_id(db, asset, username, was=was)
    sync_masters_from_values(db, data, register)
    db.commit()
    db.refresh(asset)
    return asset


MOVE_ASSIGN = "assign"
MOVE_STOCK = "stock"
MOVE_ACTIONS = (MOVE_ASSIGN, MOVE_STOCK)


def in_stock_status(db: Session) -> str:
    for row in list_master(db, MASTERS["status"]):
        if row.is_active and is_in_stock(row.name):
            return row.name
    return "IN STOCK"


def software_move_error(item, action: str, quantity: Any) -> Optional[str]:
    if action not in MOVE_ACTIONS:
        return 'action must be "assign" or "stock"'
    if item.is_deleted:
        return f"{item.asset_id} is scrapped, so it cannot be moved. Restore it first."
    if is_sold(item.status):
        return f"{item.asset_id} was sold, so it cannot be moved."
    if action == MOVE_ASSIGN and not is_in_stock(item.status):
        return f"{item.asset_id} is not in stock, so there is nothing to assign from it."
    if action == MOVE_STOCK and is_in_stock(item.status):
        return f"{item.asset_id} is already in stock."
    try:
        n = int(str(quantity).strip())
    except (TypeError, ValueError):
        return "Quantity must be a whole number."
    total = item.quantity or 1
    if n < 1 or n > total:
        return f"Quantity must be between 1 and {total}: that is how many {item.asset_id} holds."
    return None


def _money(d) -> str:
    from decimal import Decimal
    text = format(Decimal(d).quantize(Decimal("0.01")), "f")
    return text[:-3] if text.endswith(".00") else text


def _split_price(price: Optional[str], part: int, total: int) -> tuple[Optional[str], Optional[str]]:
    from decimal import ROUND_HALF_UP, Decimal
    if not price:
        return None, None
    whole = Decimal(price)
    moved = (whole * part / total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return _money(moved), _money(whole - moved)


def move_software(db: Session, item, action: str, quantity: int, holder: Optional[str],
                  username: str) -> dict[str, Any]:
    register = registers.SOFTWARES
    total = item.quantity or 1
    target_status = in_use_status(db) if action == MOVE_ASSIGN else in_stock_status(db)
    target_vendor = (holder or "").strip() if action == MOVE_ASSIGN else ""

    def write(rec, data):
        before = _history_snapshot(rec)
        _apply_asset_fields(rec, data)
        rec.updated_by = username
        record_field_changes(db, rec, before, username)

    if quantity >= total:
        write(item, {"status": target_status, "vendor": target_vendor})
        db.commit()
        db.refresh(item)
        return {"record": item, "source": item, "split": False, "merged": False}

    moved_price, kept_price = _split_price(item.price, quantity, total)
    model = register.model
    same = lambda col, v: func.lower(func.coalesce(col, "")) == (v or "").strip().lower()  # noqa: E731
    match = db.execute(
        select(model).where(
            model.id != item.id, model.is_deleted.is_(False), model.verification == VERIFIED,
            same(model.asset_tag, item.asset_tag), same(model.version, item.version),
            same(model.status, target_status), same(model.vendor, target_vendor),
        ).order_by(model.asset_id)
    ).scalars().first()

    if match is not None:
        add = None
        if moved_price is not None or match.price:
            from decimal import Decimal
            add = _money(Decimal(match.price or "0") + Decimal(moved_price or "0"))
        write(match, {"quantity": (match.quantity or 0) + quantity,
                      **({"price": add} if add is not None else {})})
        dest, merged = match, True
    else:
        dest = model()
        _apply_asset_fields(dest, {
            "assetTag": item.asset_tag, "version": item.version, "status": target_status,
            "quantity": quantity, "poNo": item.po_no, "warrantyEnd": item.warranty_end,
            "price": moved_price, "vendor": target_vendor, "comments": item.comments,
        })
        dest.asset_id = next_asset_id(db, register)
        dest.created_by = username
        dest.updated_by = username
        dest.verification = VERIFIED
        db.add(dest)
        db.flush()
        record_event(db, dest, EVENT_CREATED, username, field="movedFrom",
                     old_value=item.asset_id, new_value=f"{quantity} of {total}")
        merged = False

    write(item, {"quantity": total - quantity,
                 **({"price": kept_price} if kept_price is not None else {})})
    db.commit()
    db.refresh(dest)
    db.refresh(item)
    return {"record": dest, "source": item, "split": True, "merged": merged}


def delete_asset(db: Session, asset, username: Optional[str] = None):
    if not asset.is_deleted:
        was = asset.status
        asset.is_deleted = True
        asset.previous_status = was
        asset.status = SCRAP_STATUS
        asset.availability = derive_availability(asset.status, True)
        if username:
            asset.updated_by = username
        record_event(db, asset, EVENT_DELETED, username,
                     field="status", old_value=was, new_value=SCRAP_STATUS)
        db.commit()
        db.refresh(asset)
    return asset


def restore_asset(
    db: Session, asset, username: Optional[str] = None, status: Optional[str] = None
):
    if not asset.is_deleted:
        return asset

    master = active_status_master(db, status) if status else None
    restored_to = (master.name if master is not None
                   else (status or asset.previous_status or "")).strip()
    was = asset.status
    asset.is_deleted = False
    asset.status = restored_to
    asset.previous_status = None
    asset.availability = derive_availability(asset.status, False)
    if username:
        asset.updated_by = username
    record_event(db, asset, EVENT_RESTORED, username,
                 field="status", old_value=was, new_value=restored_to)

    if is_in_stock(restored_to):
        for attr, key, empty in (("user", "user", ""), ("email", "email", None)):
            old = getattr(asset, attr)
            if _as_text(old) is not None:
                setattr(asset, attr, empty)
                record_event(db, asset, EVENT_UPDATED, username,
                             field=key, old_value=old, new_value=empty)
    sync_masters_from_values(db, {"status": restored_to})
    db.commit()
    db.refresh(asset)
    return asset


def purge_asset(db: Session, asset, username: Optional[str] = None) -> str:
    was = asset.asset_id
    on_it = linked_peripherals(db, asset.id) if registers.of(asset) is ASSETS else []
    db.query(PeripheralLink).filter(
        (PeripheralLink.asset_id == asset.id) | (PeripheralLink.peripheral_id == asset.id)
    ).delete(synchronize_session=False)
    _release_unlinked(db, on_it)

    record_event(db, asset, EVENT_PURGED, username,
                 field="assetId", old_value=was, new_value=None)
    db.delete(asset)
    db.commit()
    return was


def _release_unlinked(db: Session, peripherals: list) -> None:
    for peripheral in peripherals:
        if not linked_assets(db, peripheral.id):
            peripheral.assigned_date = None


def verify_items(db: Session, items: list, username: str) -> int:
    now = _utcnow()
    done = 0
    for item in items:
        if item.verification == VERIFIED:
            continue
        was = item.verification
        item.verification = VERIFIED
        item.verified_by = username
        item.verified_at = now
        item.verification_note = None
        item.updated_by = username
        record_event(db, item, EVENT_VERIFIED, username,
                     field="verification", old_value=was, new_value=VERIFIED)
        done += 1
    db.commit()
    return done


def reject_item(db: Session, item, username: str, reason: str):
    reason = (reason or "").strip()[:VERIFICATION_NOTE_MAX]
    item.verification = REJECTED
    item.verification_note = reason
    item.verified_by = username
    item.verified_at = _utcnow()
    item.updated_by = username
    record_event(db, item, EVENT_REJECTED, username,
                 field="verification", old_value=PENDING, new_value=reason)
    db.commit()
    db.refresh(item)
    return item


def discard_item(db: Session, item, username: str, reason: str = "") -> str:
    was = item.asset_id
    on_it = linked_peripherals(db, item.id) if registers.of(item) is ASSETS else []
    db.query(PeripheralLink).filter(
        (PeripheralLink.asset_id == item.id) | (PeripheralLink.peripheral_id == item.id)
    ).delete(synchronize_session=False)
    _release_unlinked(db, on_it)
    record_event(db, item, EVENT_DISCARDED, username, field="verification",
                 old_value=item.verification, new_value=(reason or "").strip()[:VERIFICATION_NOTE_MAX] or None)
    db.delete(item)
    db.commit()
    return was


def active_status_master(db: Session, name: Optional[str]):
    clean = (name or "").strip()
    if not clean:
        return None
    row = find_master_by_name(db, MASTERS["status"], clean)
    return row if row is not None and row.is_active else None


def restore_status_error(asset, status: Optional[str] = None, *, db: Optional[Session] = None
                         ) -> Optional[str]:
    noun = registers.of(asset).noun
    if not asset.is_deleted:
        return f"This {noun} is not deleted."
    chosen = (status or asset.previous_status or "").strip()
    if not chosen:
        return (
            f"This {noun} was deleted before its previous status was recorded, "
            "so there is nothing to restore it to. Choose a status to restore it as."
        )
    if chosen.strip().upper() in RESERVED_STATUSES:
        return f"{SCRAP_STATUS} is the deleted state -- restore the {noun} as a real status."
    if status and status.strip() and db is not None and active_status_master(db, status) is None:
        return (
            f"'{status.strip()}' is not a status in Master Data. "
            f"Choose one of the listed statuses to restore the {noun} as."
        )
    return None


SHARED_TYPE_SEEDS = ("PRINTER", "SCANNER", "PROJECTOR")


def shared_type_names(db: Session) -> set[str]:
    names = db.execute(
        select(AssetType.name).where(AssetType.is_shared.is_(True))
    ).scalars().all()
    return {str(n).strip().lower() for n in names if n}


def is_shared_peripheral(peripheral, shared: set[str]) -> bool:
    return (peripheral.type or "").strip().lower() in shared


def linked_peripherals(db: Session, asset_id: str) -> list:
    if not asset_id:
        return []
    return list(db.execute(
        select(Peripheral)
        .join(PeripheralLink, PeripheralLink.peripheral_id == Peripheral.id)
        .where(PeripheralLink.asset_id == asset_id)
        .order_by(Peripheral.asset_id)
    ).scalars().all())


def linked_peripherals_map(db: Session, asset_ids: list[str]) -> dict[str, list]:
    ids = [a for a in asset_ids if a]
    if not ids:
        return {}
    out: dict[str, list] = {}
    rows = db.execute(
        select(PeripheralLink.asset_id, Peripheral)
        .join(Peripheral, Peripheral.id == PeripheralLink.peripheral_id)
        .where(PeripheralLink.asset_id.in_(ids))
        .order_by(Peripheral.asset_id)
    ).all()
    for asset_id, peripheral in rows:
        out.setdefault(asset_id, []).append(peripheral)
    return out


def linked_assets(db: Session, peripheral_id: str) -> list:
    if not peripheral_id:
        return []
    return list(db.execute(
        select(Asset)
        .join(PeripheralLink, PeripheralLink.asset_id == Asset.id)
        .where(PeripheralLink.peripheral_id == peripheral_id, Asset.verification == VERIFIED)
        .order_by(Asset.asset_id)
    ).scalars().all())


def linked_assets_map(db: Session, peripherals: list) -> dict[str, list]:
    ids = [p.id for p in peripherals if p is not None]
    if not ids:
        return {}
    out: dict[str, list] = {}
    rows = db.execute(
        select(PeripheralLink.peripheral_id, Asset)
        .join(Asset, Asset.id == PeripheralLink.asset_id)
        .where(PeripheralLink.peripheral_id.in_(ids))
        .order_by(Asset.asset_id)
    ).all()
    for peripheral_id, asset in rows:
        out.setdefault(peripheral_id, []).append(asset)
    return out


def peripheral_label(peripheral) -> str:
    return (peripheral.srl or "").strip() or (peripheral.asset_id or "")


def take_out_of_stock(db: Session, peripheral, asset, username: Optional[str], status: str) -> bool:
    if not is_in_stock(peripheral.status):
        return False
    for attr, value in (("status", status), ("location", asset.location), ("floor", asset.floor)):
        old = getattr(peripheral, attr)
        if value and old != value:
            record_event(db, peripheral, EVENT_UPDATED, username, field=attr, old_value=old, new_value=value)
            setattr(peripheral, attr, value)
    peripheral.site = derive_site(peripheral.location, peripheral.site)
    peripheral.availability = derive_availability(peripheral.status, bool(peripheral.is_deleted))
    peripheral.updated_by = username
    return True


def link_peripherals(
    db: Session, asset, peripheral_ids: list[str], username: Optional[str] = None
) -> dict[str, Any]:
    wanted = [str(i) for i in (peripheral_ids or []) if str(i or "").strip()]
    found = {}
    if wanted:
        rows = db.execute(
            select(Peripheral).where(Peripheral.id.in_(wanted))
        ).scalars().all()
        found = {row.id: row for row in rows}

    missing = [i for i in wanted if i not in found]

    shared = shared_type_names(db)
    current = {p.id: p for p in linked_peripherals(db, asset.id)}
    linked, unlinked, moved, from_stock = [], [], [], []
    in_use = None

    for pid, peripheral in current.items():
        if pid in found:
            continue
        db.query(PeripheralLink).filter(
            PeripheralLink.peripheral_id == pid,
            PeripheralLink.asset_id == asset.id,
        ).delete(synchronize_session=False)
        record_event(db, peripheral, EVENT_UPDATED, username,
                     field="linkedAsset", old_value=asset.asset_id, new_value=None)
        if not linked_assets(db, pid):
            peripheral.assigned_date = None
        unlinked.append(peripheral)

    for pid in wanted:
        peripheral = found.get(pid)
        if peripheral is None or pid in current:
            continue

        was_on = linked_assets(db, pid)

        if not is_shared_peripheral(peripheral, shared):
            for previous in was_on:
                db.query(PeripheralLink).filter(
                    PeripheralLink.peripheral_id == pid,
                    PeripheralLink.asset_id == previous.id,
                ).delete(synchronize_session=False)
                moved.append((peripheral, previous))
                record_event(db, previous, EVENT_UPDATED, username,
                             field="linkedPeripherals",
                             old_value=peripheral_label(peripheral),
                             new_value=f"moved to {asset.asset_id}")

        db.add(PeripheralLink(peripheral_id=pid, asset_id=asset.id, created_by=username))
        peripheral.assign_count = (peripheral.assign_count or 0) + 1
        peripheral.assigned_date = today_iso()

        kept = was_on if is_shared_peripheral(peripheral, shared) else []
        now_on = sorted({*(a.asset_id or "" for a in kept), asset.asset_id or ""})
        record_event(
            db, peripheral, EVENT_UPDATED, username, field="linkedAsset",
            old_value=", ".join(sorted(a.asset_id or "" for a in was_on)) or None,
            new_value=", ".join(now_on) or None,
        )
        in_use = in_use or in_use_status(db)
        if take_out_of_stock(db, peripheral, asset, username, in_use):
            from_stock.append(peripheral)
        linked.append(peripheral)

    def summary(rows):
        ordered = sorted(rows, key=lambda p: p.asset_id or "")
        return ", ".join(peripheral_label(p) for p in ordered) or None

    if linked or unlinked:
        record_event(
            db, asset, EVENT_UPDATED, username, field="linkedPeripherals",
            old_value=summary(current.values()),
            new_value=summary(found.values()),
        )

    return {"linked": linked, "unlinked": unlinked, "moved": moved, "missing": missing,
            "fromStock": from_stock}


def ensure_shared_types(db: Session, names) -> list[str]:
    already = db.execute(
        select(func.count()).select_from(AssetType).where(AssetType.is_shared.is_(True))
    ).scalar_one()
    if already:
        return []

    wanted = {str(n).strip().lower() for n in names if str(n or "").strip()}
    rows = [
        row for row in db.execute(select(AssetType)).scalars().all()
        if (row.name or "").strip().lower() in wanted
    ]
    if not rows:
        return []
    for row in rows:
        row.is_shared = True
    db.commit()
    return [row.name for row in rows]


def clear_all_assets(db: Session, register: Register = ASSETS) -> None:
    db.query(PeripheralLink).delete()

    db.query(AssetEvent).filter(AssetEvent.register == register.key).delete()
    db.query(register.model).delete()
    db.commit()
    reset_asset_id_counter(db, register)


def clear_all_registers(db: Session) -> dict[str, int]:
    from app.models import ApprovalRequest, RenewalNotice
    counts = {reg.plural: count_register(db, reg) for reg in registers.ALL}
    db.query(PeripheralLink).delete()
    db.query(RenewalNotice).delete()
    now = datetime.now(timezone.utc)
    for req in db.query(ApprovalRequest).filter(ApprovalRequest.status == "pending").all():
        req.status = "withdrawn"
        req.decided_at = now
        req.decision_note = "Withdrawn: every record was deleted by Clear all data."
    for reg in registers.ALL:
        db.query(AssetEvent).filter(AssetEvent.register == reg.key).delete()
        db.query(reg.model).delete()
    db.commit()
    for reg in registers.ALL:
        reset_asset_id_counter(db, reg)
    return counts


def update_assets(
    db: Session, assets: list, changes: dict[str, Any], username: str
) -> int:
    register = registers.of(assets[0]) if assets else ASSETS
    canonicalise_master_values(changes, master_value_index(db), register)

    changed = 0
    in_use = None
    for asset in assets:
        before = _history_snapshot(asset)
        if handing_over_from_stock(asset, changes):
            in_use = in_use or in_use_status(db)
            _apply_asset_fields(asset, {**changes, "status": in_use})
        else:
            _apply_asset_fields(asset, changes)
        if record_field_changes(db, asset, before, username):
            asset.updated_by = username
            changed += 1
    sync_masters_from_values(db, changes, register)
    db.commit()
    return changed


DEDUPE_OFF = "none"

UNKNOWN_INCLUDE = "include"
UNKNOWN_REJECT = "reject"
UNKNOWN_MODES = (UNKNOWN_INCLUDE, UNKNOWN_REJECT)

_FINGERPRINT_KEYS = [k for k in ASSET_KEYS
                     if k not in SERVER_ASSIGNED_KEYS and k not in ("assignedDate", "make")]
_SOFTWARE_FINGERPRINT_KEYS = list(SOFTWARE_KEYS)


def _norm_cell(value: Any) -> str:
    return str(value or "").strip().lower()


def content_fingerprint(source: Any, register: Register = ASSETS) -> str:
    keys = _SOFTWARE_FINGERPRINT_KEYS if register is registers.SOFTWARES else _FINGERPRINT_KEYS
    if isinstance(source, dict):
        values = [_norm_cell(source.get(key)) for key in keys]
        if register is registers.SOFTWARES:
            at = keys.index("price")
            values[at] = _norm_cell(clean_price(source.get("price")) or source.get("price"))
            at = keys.index("quantity")
            q = str(source.get("quantity") or "").strip()
            values[at] = _norm_cell(q.split(".")[0] if _QUANTITY_RE.match(q) else q)
    else:
        attrs = attrs_of(source)
        values = [_norm_cell(getattr(source, attrs[key], None)) if key in attrs else ""
                  for key in keys]
    return "␟".join(values)


class DuplicateIndex:
    def __init__(self, assets: list, register: Register = ASSETS) -> None:
        self.register = register
        self.by_tag: dict[str, str] = {}
        self.by_content: dict[str, str] = {}
        for asset in assets:
            label = asset.asset_id or asset.asset_tag or asset.id
            if asset.service_tag:
                self.by_tag.setdefault(asset.service_tag.upper(), label)
            self.by_content.setdefault(content_fingerprint(asset, register), label)

    def find(self, row: dict[str, Any]) -> Optional[str]:
        tag = derive_service_tag(row.get("description"))
        if tag and tag in self.by_tag:
            return self.by_tag[tag]
        return self.by_content.get(content_fingerprint(row, self.register))

    def add(self, row: dict[str, Any], label: str) -> None:
        tag = derive_service_tag(row.get("description"))
        if tag:
            self.by_tag.setdefault(tag, label)
        self.by_content.setdefault(content_fingerprint(row, self.register), label)


def _dedupe_value(row: dict[str, Any], dedupe_key: str) -> Optional[str]:
    v = row.get(dedupe_key)
    if v is None:
        return None
    v = str(v).strip()
    return v.lower() if v else None


def bulk_import_assets(
    db: Session, rows: list[dict[str, Any]], dedupe_key: Optional[str], username: str,
    register: Register = ASSETS, unknown_masters: str = UNKNOWN_INCLUDE,
    accepted_out: Optional[list] = None,
) -> tuple[
    int, int, list[dict[str, Any]], list[dict[str, Any]],
    dict[str, list[str]], dict[str, list[dict[str, str]]],
]:
    added = 0
    skipped = 0
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    imported: list[dict[str, Any]] = []
    accepted: list = []

    existing_assets = list(db.execute(select(register.model)).scalars().all())

    automatic = dedupe_key is None
    duplicates = DuplicateIndex(existing_assets, register) if automatic else None

    srl_holders: dict = {}
    for existing in existing_assets:
        key = normalize_srl(existing.srl)
        if key and key not in srl_holders:
            srl_holders[key] = existing
    for other in srl_scope(register):
        if other is register:
            continue
        for held in db.execute(
            select(other.model).where(other.model.srl.is_not(None))
        ).scalars().all():
            key = normalize_srl(held.srl)
            if key and key not in srl_holders:
                srl_holders[key] = held
    srl_from_row: dict[str, int] = {}

    known_masters = master_value_index(db)
    unknown = unknown_master_values(
        [r for r in rows if isinstance(r, dict)], known_masters, register,
    )
    normalised: dict[str, dict[str, str]] = {}

    column_key = dedupe_key if dedupe_key not in (None, DEDUPE_OFF) else None
    seen_keys: set[str] = set()
    existing_keys: set[str] = set()
    if column_key:
        attr = attrs_of(register.model).get(column_key)
        if attr is not None:
            for v in db.execute(select(getattr(register.model, attr))).scalars().all():
                if v is not None and str(v).strip():
                    existing_keys.add(str(v).strip().lower())

    for index, raw_row in enumerate(rows):
        row = dict(raw_row)
        notes = sanitize_optional_formats(row, register)

        row_errors = validate_asset_fields(row, partial=False, register=register)
        reserved = reserved_status_error(row.get("status"))
        if reserved:
            row_errors = [*row_errors, reserved]
        if row_errors:
            skipped += 1
            errors.append({"row": index, "reason": "; ".join(row_errors)})
            continue

        if unknown_masters == UNKNOWN_REJECT:
            missing = _row_unknowns(row, known_masters, register)
            if missing:
                skipped += 1
                errors.append({
                    "row": index,
                    "reason": f"not in the master data: {', '.join(missing)}",
                })
                continue

        for field, was, now in canonicalise_master_values(row, known_masters, register):
            normalised.setdefault(field, {})[was] = now

        if duplicates is not None:
            match = duplicates.find(row)
            if match is not None:
                skipped += 1
                tag = derive_service_tag(row.get("description"))
                errors.append({
                    "row": index,
                    "reason": (f"already in the register as {match} (service tag {tag})"
                               if tag else f"already in the register as {match} (identical record)"),
                })
                continue

        if column_key:
            key_value = _dedupe_value(row, column_key)
            if key_value:
                if key_value in existing_keys or key_value in seen_keys:
                    skipped += 1
                    errors.append(
                        {"row": index,
                         "reason": f"duplicate {field_label(column_key)} "
                                   f"({row.get(column_key)}) -- another row or an existing "
                                   f"{register.noun} already has this value"}
                    )
                    continue
                seen_keys.add(key_value)

        srl_key = normalize_srl(row.get("srl"))
        if srl_key:
            if srl_key in srl_from_row:
                skipped += 1
                errors.append({
                    "row": index,
                    "reason": (f"{field_label('srl', register)} '{str(row.get('srl')).strip()}' "
                               f"is already used by row {srl_from_row[srl_key] + 1} of this file. "
                               f"A serial number identifies one "
                               f"{'licence' if register is registers.SOFTWARES else 'device'}, "
                               f"so it cannot be used twice."),
                })
                continue
            holder = srl_holders.get(srl_key)
            if holder is not None:
                skipped += 1
                errors.append({"row": index, "reason": srl_taken_message(holder, row.get("srl"))})
                continue

        asset = register.model()
        _apply_asset_fields(asset, row)
        asset.asset_id = next_asset_id(db, register)
        if duplicates is not None:
            duplicates.add(row, asset.asset_id)
        if srl_key:
            srl_from_row[srl_key] = index
        asset.created_by = username
        asset.updated_by = username
        asset.verification = starting_verification(asset)
        db.add(asset)
        accepted.append(asset)
        imported.append(row)
        added += 1
        if notes:
            warnings.append({"row": index, "reason": "; ".join(notes)})

    if imported:
        sync_masters_from_rows(db, imported, register)

    if accepted:
        db.flush()
        for asset in accepted:
            record_event(db, asset, EVENT_IMPORTED, username)
            if settings.VERIFY_NEW_RECORDS and has_sap_id(asset):
                accept_by_sap_id(db, asset, username)

    db.commit()
    if accepted_out is not None:
        accepted_out.extend(accepted)
    return added, skipped, errors, warnings, unknown, {
        field: [{"from": was, "to": now} for was, now in sorted(pairs.items())]
        for field, pairs in normalised.items()
    }


def _spec_registers(spec: MasterSpec) -> tuple[Register, ...]:
    if spec.classification is None:
        return registers.ALL
    return (registers.BY_KEY[spec.classification],)


def _master_names(db: Session, spec: MasterSpec) -> list[str]:
    return list(db.execute(select(spec.model.name).where(*spec.scope())).scalars().all())


def list_master(db: Session, spec: MasterSpec, include_inactive: bool = False) -> list[Any]:
    stmt = select(spec.model).where(*spec.scope())
    if not include_inactive:
        stmt = stmt.where(spec.model.is_active.is_(True))
    stmt = stmt.order_by(spec.model.sort_order, spec.model.name)
    return list(db.execute(stmt).scalars().all())


def get_master(db: Session, spec: MasterSpec, row_id: str) -> Optional[Any]:
    row = db.get(spec.model, row_id)
    if row is not None and spec.classification is not None and row.classification != spec.classification:
        return None
    return row


def find_master_by_name(db: Session, spec: MasterSpec, name: str) -> Optional[Any]:
    clean = (name or "").strip()
    if not clean:
        return None
    stmt = select(spec.model).where(
        func.lower(func.trim(spec.model.name)) == clean.lower(), *spec.scope()
    )
    return db.execute(stmt).scalars().first()


def _next_sort_order(db: Session, spec: MasterSpec) -> int:
    current = db.execute(select(func.max(spec.model.sort_order)).where(*spec.scope())).scalar()
    return int(current) + 1 if current is not None else 0


def count_assets_using(db: Session, spec: MasterSpec, name: str) -> int:
    clean = (name or "").strip()
    if not clean:
        return 0
    total = 0
    for reg in _spec_registers(spec):
        column = getattr(reg.model, spec.asset_attr)
        stmt = (
            select(func.count()).select_from(reg.model)
            .where(func.lower(column) == clean.lower())
        )
        total += int(db.execute(stmt).scalar_one())
    return total


def master_usage_counts(db: Session, spec: MasterSpec) -> dict[str, int]:
    counts: dict[str, int] = {}
    for reg in _spec_registers(spec):
        column = getattr(reg.model, spec.asset_attr)
        stmt = (
            select(func.lower(column), func.count())
            .where(column.is_not(None)).group_by(func.lower(column))
        )
        for value, count in db.execute(stmt).all():
            if value:
                counts[str(value)] = counts.get(str(value), 0) + int(count)
    return counts


def create_master(
    db: Session,
    spec: MasterSpec,
    *,
    name: str,
    description: Optional[str] = None,
    sort_order: Optional[int] = None,
    is_active: bool = True,
) -> Any:
    row = spec.new_row(
        name=name.strip(),
        description=(description or "").strip() or None,
        sort_order=_next_sort_order(db, spec) if sort_order is None else int(sort_order),
        is_active=bool(is_active),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


MASTER_NAME_MAX = 150
MASTER_DESCRIPTION_MAX = 255


def bulk_create_masters(
    db: Session, spec: MasterSpec, items: list[dict[str, Any]]
) -> tuple[int, int, list[dict[str, Any]], list[Any]]:
    added = 0
    skipped = 0
    errors: list[dict[str, Any]] = []
    created: list[Any] = []

    known = {n.lower(): n for n in _master_names(db, spec)}
    seen: dict[str, str] = {}
    next_order = _next_sort_order(db, spec)

    for index, item in enumerate(items):
        name = str((item or {}).get("name") or "").strip()
        description = str((item or {}).get("description") or "").strip()

        if not name:
            skipped += 1
            errors.append({"row": index, "reason": "the value is blank"})
            continue
        if len(name) > MASTER_NAME_MAX:
            skipped += 1
            errors.append({"row": index, "reason": f"longer than {MASTER_NAME_MAX} characters"})
            continue
        if len(description) > MASTER_DESCRIPTION_MAX:
            skipped += 1
            errors.append({
                "row": index,
                "reason": f"its description is longer than {MASTER_DESCRIPTION_MAX} characters",
            })
            continue

        lowered = name.lower()
        if lowered in known:
            skipped += 1
            errors.append({"row": index, "reason": f'"{known[lowered]}" is already in this list'})
            continue
        if lowered in seen:
            skipped += 1
            errors.append({"row": index, "reason": f'"{seen[lowered]}" appears more than once in what you pasted'})
            continue

        seen[lowered] = name
        row = spec.new_row(
            name=name,
            description=description or None,
            sort_order=next_order,
            is_active=True,
        )
        next_order += 1
        db.add(row)
        created.append(row)
        added += 1

    db.commit()
    for row in created:
        db.refresh(row)
    return added, skipped, errors, created


def update_master(
    db: Session,
    spec: MasterSpec,
    row: Any,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    sort_order: Optional[int] = None,
    is_active: Optional[bool] = None,
    is_shared: Optional[bool] = None,
) -> tuple[Any, int]:
    renamed = 0
    if name is not None:
        clean = name.strip()
        if clean and clean != row.name:
            old_name = row.name
            row.name = clean
            renamed = rename_asset_values(db, spec, old_name, clean)
    if description is not None:
        row.description = description.strip() or None
    if sort_order is not None:
        row.sort_order = int(sort_order)
    if is_active is not None:
        row.is_active = bool(is_active)
    if is_shared is not None and isinstance(row, AssetType):
        row.is_shared = bool(is_shared)
    db.commit()
    db.refresh(row)
    return row, renamed


def rename_asset_values(db: Session, spec: MasterSpec, old_name: str, new_name: str) -> int:
    renamed = 0
    for reg in _spec_registers(spec):
        column = getattr(reg.model, spec.asset_attr)
        result = (
            db.query(reg.model)
            .filter(func.lower(column) == old_name.strip().lower())
            .update({spec.asset_attr: new_name}, synchronize_session=False)
        )
        renamed += int(result or 0)
    return renamed


def delete_master(db: Session, row: Any) -> None:
    db.delete(row)
    db.commit()


def master_value_index(db: Session) -> dict[str, dict[str, str]]:
    return {
        spec.key: {
            (name or "").strip().lower(): (name or "").strip()
            for name in _master_names(db, spec)
            if (name or "").strip()
        }
        for spec in MASTER_SPECS
    }


def _register_key(register: Optional[Register]) -> Optional[str]:
    return register.key if register is not None else None


def canonicalise_master_values(
    data: dict[str, Any], known: dict[str, dict[str, str]], register: Optional[Register] = None,
) -> list[tuple[str, str, str]]:
    changed: list[tuple[str, str, str]] = []
    for spec in specs_for(_register_key(register)):
        value = data.get(spec.row_key)
        if _blank(value):
            continue
        written = str(value).strip()
        canonical = known.get(spec.key, {}).get(written.lower())
        if canonical is None:
            continue
        if canonical != written:
            changed.append((spec.row_key, written, canonical))
        data[spec.row_key] = canonical
    return changed


def unknown_master_values(
    rows: list[dict[str, Any]], known: dict[str, dict[str, str]], register: Optional[Register] = None,
) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for spec in specs_for(_register_key(register)):
        seen: dict[str, str] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            value = row.get(spec.row_key)
            if _blank(value):
                continue
            text = str(value).strip()
            if text.lower() in known.get(spec.key, {}):
                continue
            seen.setdefault(text.lower(), text)
        if seen:
            out[spec.row_key] = sorted(seen.values(), key=str.lower)
    return out


def _row_unknowns(
    row: dict[str, Any], known: dict[str, dict[str, str]], register: Optional[Register] = None,
) -> list[str]:
    out = []
    for spec in specs_for(_register_key(register)):
        value = row.get(spec.row_key)
        if _blank(value):
            continue
        text = str(value).strip()
        if text.lower() not in known.get(spec.key, {}):
            out.append(f"{spec.label} '{text}'")
    return out


def sync_masters_from_rows(
    db: Session, rows: list[dict[str, Any]], register: Optional[Register] = None,
) -> None:
    for spec in specs_for(_register_key(register)):
        values = [row.get(spec.row_key) for row in rows]
        values = [str(v).strip() for v in values if not _blank(v)]
        if not values:
            continue

        known = {n.lower() for n in _master_names(db, spec)}
        next_order = _next_sort_order(db, spec)
        shared_seeds = {n.lower() for n in SHARED_TYPE_SEEDS}
        for value in values:
            if value.lower() in known:
                continue
            known.add(value.lower())
            extra = {}
            if spec.model is AssetType and value.lower() in shared_seeds:
                extra["is_shared"] = True
            db.add(spec.new_row(name=value, description=None, sort_order=next_order,
                                is_active=True, **extra))
            next_order += 1


def sync_masters_from_values(
    db: Session, data: dict[str, Any], register: Optional[Register] = None,
) -> None:
    sync_masters_from_rows(db, [data], register)


def seed_masters(db: Session) -> None:
    empty: list[MasterSpec] = [
        spec for spec in MASTER_SPECS
        if not db.execute(select(func.count()).select_from(spec.model).where(*spec.scope())).scalar_one()
    ]
    for spec in empty:
        for reg in _spec_registers(spec):
            column = getattr(reg.model, spec.asset_attr)
            rows = [{spec.row_key: value}
                    for value in db.execute(select(column).distinct()).scalars().all()
                    if not _blank(value)]
            if rows:
                sync_masters_from_rows(db, rows, reg if spec.classification else None)
                db.flush()
    if empty:
        db.commit()


def ensure_reserved_statuses(db: Session) -> None:
    spec = MASTERS.get("status")
    if spec is None:
        return
    if find_master_by_name(db, spec, SCRAP_STATUS) is not None:
        return
    db.add(spec.model(
        name=SCRAP_STATUS,
        description="Set automatically when an asset is deleted. Cannot be chosen manually.",
        sort_order=_next_sort_order(db, spec),
        is_active=False,
    ))
    db.commit()


def master_to_dict(row: Any, category: str) -> dict[str, Any]:
    d = {
        "id": row.id,
        "category": category,
        "name": row.name,
        "description": row.description,
        "sortOrder": row.sort_order,
        "isActive": row.is_active,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }
    if isinstance(row, AssetType):
        d["isShared"] = bool(row.is_shared)
    if isinstance(row, Make):
        d["classification"] = row.classification
    return d


def all_masters_snapshot(db: Session) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for spec in MASTER_SPECS:
        usage = master_usage_counts(db, spec)
        out[spec.key] = []
        for row in list_master(db, spec, include_inactive=True):
            item = master_to_dict(row, spec.key)
            item["inUse"] = usage.get(row.name.lower(), 0)
            out[spec.key].append(item)
    return out


_YES ={"yes", "y", "true", "1", "active", "shared", "several assets"}
_NO = {"no", "n", "false", "0", "retired", "inactive", "one at a time"}


def _yes_no(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    text = str(value if value is not None else "").strip().lower()
    if text in _YES:
        return True
    if text in _NO:
        return False
    return None


def import_masters(db: Session, lists: dict[str, Any]) -> dict[str, Any]:
    report: dict[str, Any] = {"lists": {}, "errors": []}
    for spec in MASTER_SPECS:
        items = lists.get(spec.key)
        if not isinstance(items, list):
            continue
        counts = {"added": 0, "updated": 0, "unchanged": 0, "skipped": 0}
        existing = {
            (row.name or "").strip().lower(): row
            for row in db.execute(select(spec.model).where(*spec.scope())).scalars().all()
        }
        seen: dict[str, str] = {}
        next_order = _next_sort_order(db, spec)

        def skip(index: int, reason: str) -> None:
            counts["skipped"] += 1
            report["errors"].append({"list": spec.plural, "row": index, "reason": reason})

        for index, item in enumerate(items):
            item = item if isinstance(item, dict) else {}
            name = str(item.get("name") or "").strip()
            description = str(item.get("description") or "").strip()
            if not name:
                skip(index, "the value is blank")
                continue
            if len(name) > MASTER_NAME_MAX:
                skip(index, f'"{name[:40]}…" is longer than {MASTER_NAME_MAX} characters')
                continue
            if len(description) > MASTER_DESCRIPTION_MAX:
                skip(index, f'the description of "{name}" is longer than {MASTER_DESCRIPTION_MAX} characters')
                continue
            lowered = name.lower()
            if lowered in seen:
                skip(index, f'"{seen[lowered]}" is in this sheet more than once')
                continue
            seen[lowered] = name

            active = _yes_no(item.get("isActive"))
            active = True if active is None else active
            order = item.get("sortOrder")
            try:
                order = int(float(order)) if str(order if order is not None else "").strip() else None
            except (TypeError, ValueError):
                order = None
            shared = _yes_no(item.get("isShared")) if spec.model is AssetType else None
            if spec.key == "status" and lowered == SCRAP_STATUS.lower():
                active = False

            row = existing.get(lowered)
            if row is None:
                extra = {"is_shared": bool(shared)} if spec.model is AssetType else {}
                db.add(spec.new_row(
                    name=name, description=description or None,
                    sort_order=next_order if order is None else order,
                    is_active=active, **extra,
                ))
                if order is None:
                    next_order += 1
                counts["added"] += 1
                continue

            before = (row.description, row.is_active, row.sort_order,
                      getattr(row, "is_shared", None))
            row.description = description or None
            row.is_active = active
            if order is not None:
                row.sort_order = order
            if shared is not None and spec.model is AssetType:
                row.is_shared = shared
            after = (row.description, row.is_active, row.sort_order,
                     getattr(row, "is_shared", None))
            counts["updated" if after != before else "unchanged"] += 1
        report["lists"][spec.key] = counts

    db.commit()
    return report


def get_user(db: Session, user_id: str) -> Optional[User]:
    return db.get(User, user_id)


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def find_user_by_username(db: Session, username: str) -> Optional[User]:
    clean = (username or "").strip()
    if not clean:
        return None
    stmt = select(User).where(func.lower(func.trim(User.username)) == clean.lower())
    return db.execute(stmt).scalars().first()


def list_users(db: Session) -> list[User]:
    return list(db.execute(select(User).order_by(User.created_at)).scalars().all())


def count_users(db: Session) -> int:
    return len(list(db.execute(select(User.id)).scalars().all()))


def count_register(db: Session, register: Register = ASSETS) -> int:
    return db.execute(
        select(func.count()).select_from(register.model)
    ).scalar_one()


TRANSFER_BY_ASSET = "asset"
TRANSFER_BY_LOCATION = "location"

_IN_USE = re.compile(r"^in[\s_-]*use$", re.IGNORECASE)


def is_in_use(status: Any) -> bool:
    return bool(_IN_USE.match(str(status or "").strip()))


LIFECYCLE_NEW = "new"
LIFECYCLE_REPLACED = "replaced"


def _same_person(a: Any, b: Any) -> bool:
    return " ".join(str(a or "").split()).lower() == " ".join(str(b or "").split()).lower()


def lifecycle(item) -> str:
    count = getattr(item, "assign_count", None) or 0
    if count == 0 or (count == 1 and is_in_use(item.status)):
        return LIFECYCLE_NEW
    return LIFECYCLE_REPLACED


def note_assignment(asset, user_before: Any) -> None:
    after = str(asset.user or "").strip()
    if after and not _same_person(user_before, after):
        asset.assign_count = (getattr(asset, "assign_count", None) or 0) + 1


def backfill_assign_counts(db: Session, register: Register) -> int:
    model = register.model
    field = "user" if register is ASSETS else "linkedAsset"
    events: dict[str, list] = {}
    for e in db.execute(
        select(AssetEvent)
        .where(AssetEvent.register == register.key, AssetEvent.field == field)
        .order_by(AssetEvent.at, AssetEvent.id)
    ).scalars():
        events.setdefault(e.asset_pk, []).append(e)

    linked_now = set()
    if register is not ASSETS:
        linked_now = {pid for (pid,) in db.execute(select(PeripheralLink.peripheral_id)).all()}

    filled = 0
    for item_id, holder in db.execute(select(model.id, model.user)).all():
        trail = events.get(item_id, [])
        if trail:
            count = 1 if str(trail[0].old_value or "").strip() else 0
        elif register is ASSETS:
            count = 1 if str(holder or "").strip() else 0
        else:
            count = 1 if item_id in linked_now else 0
        count += sum(1 for e in trail
                     if str(e.new_value or "").strip() and not _same_person(e.old_value, e.new_value))
        if count:
            db.execute(sql_text(f"UPDATE {register.table} SET assign_count = :n WHERE id = :id"),
                       {"n": count, "id": item_id})
            filled += 1
    db.commit()
    return filled


def _local_day(moment) -> Optional[str]:
    return to_ist(moment).date().isoformat() if moment is not None else None


def backfill_assigned_dates(db: Session, register: Register) -> int:
    if register is ASSETS:
        holders = {pk: str(user or "").strip()
                   for pk, user in db.execute(sql_text(
                       f'SELECT id, "user" FROM {register.table} '
                       "WHERE assigned_date IS NULL OR trim(assigned_date) = ''")).all()
                   if str(user or "").strip()}
        field = "user"
    else:
        linked = {pid for (pid,) in db.execute(select(PeripheralLink.peripheral_id)).all()}
        holders = {pk: None for (pk,) in db.execute(sql_text(
            f"SELECT id FROM {register.table} "
            "WHERE assigned_date IS NULL OR trim(assigned_date) = ''")).all() if pk in linked}
        field = "linkedAsset"
    if not holders:
        return 0

    latest: dict[str, Any] = {}
    for e in db.execute(
        select(AssetEvent)
        .where(AssetEvent.register == register.key, AssetEvent.field == field)
        .order_by(AssetEvent.at, AssetEvent.id)
    ).scalars():
        if e.asset_pk not in holders or not str(e.new_value or "").strip():
            continue
        if register is ASSETS and not _same_person(e.new_value, holders[e.asset_pk]):
            continue
        latest[e.asset_pk] = e.at

    for pk, at in latest.items():
        db.execute(sql_text(f"UPDATE {register.table} SET assigned_date = :d WHERE id = :id"),
                   {"d": _local_day(at), "id": pk})
    db.commit()
    return len(latest)


def move_joining_dates_to_users(db: Session) -> dict[str, int]:
    people: dict[str, list] = {}
    blank: set[str] = set()
    for uid, full_name, joined in db.execute(sql_text(
            "SELECT id, full_name, date_of_joining FROM users")).all():
        key = " ".join(str(full_name or "").split()).lower()
        if key:
            people.setdefault(key, []).append(uid)
        if not str(joined or "").strip():
            blank.add(uid)

    def account_for(name) -> Optional[str]:
        key = " ".join(clean_person_name(name).split()).lower()
        ids = people.get(key, []) if key else []
        return ids[0] if len(ids) == 1 else None

    found = [(holder, day) for holder, day in db.execute(sql_text(
        'SELECT "user", doj FROM assets WHERE doj IS NOT NULL')).all()]
    found += [(holder, day) for holder, day in db.execute(sql_text(
        'SELECT a."user", p.doj FROM peripherals p '
        "JOIN peripheral_links l ON l.peripheral_id = p.id "
        "JOIN assets a ON a.id = l.asset_id WHERE p.doj IS NOT NULL")).all()]

    chosen: dict[str, str] = {}
    unmatched = 0
    for holder, day in found:
        day = str(day or "").strip()
        if not DATE_RE.match(day):
            continue
        uid = account_for(holder)
        if uid is None:
            unmatched += 1
            continue
        if uid in blank and (uid not in chosen or day < chosen[uid]):
            chosen[uid] = day

    for uid, day in chosen.items():
        db.execute(sql_text("UPDATE users SET date_of_joining = :d WHERE id = :id"),
                   {"d": day, "id": uid})
    db.commit()
    return {"people": len(chosen), "unmatched": unmatched}


def peripheral_transfer_mode(peripheral) -> str:
    return TRANSFER_BY_ASSET if is_in_use(peripheral.status) else TRANSFER_BY_LOCATION


def transfer_location_error(holder: User, location: str) -> Optional[str]:
    where = (getattr(holder, "location", "") or "").strip()
    if not where:
        return None
    if where.lower() == (location or "").strip().lower():
        return None
    return (
        f"{holder.full_name} is recorded at {where}, not {location}. "
        "Choose someone at the destination, or confirm the move anyway."
    )


def canonical_location(db: Session, value: Any) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    spec = MASTERS.get("location")
    if spec is not None:
        row = find_master_by_name(db, spec, text)
        if row is not None:
            return row.name
    return text


def _clean_email(value: Any) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    return text or None


def create_user(
    db: Session,
    *,
    username: str,
    password: str,
    full_name: str,
    role: str,
    email: Optional[str] = None,
    location: Optional[str] = None,
    must_change_password: bool = False,
    date_of_joining: Optional[str] = None,
) -> User:
    user = User(
        username=username.strip(),
        password_hash=get_password_hash(password),
        full_name=full_name,
        role=role,
        email=_clean_email(email),
        location=canonical_location(db, location),
        is_active=True,
        must_change_password=bool(must_change_password),
        date_of_joining=(date_of_joining or "").strip() or None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


_RECOVERABLE_FROM_REGISTER = {"email": "email", "location": "location"}


def _register_values_by_person(db: Session, attr: str) -> dict[str, str]:
    seen: dict[str, dict[str, str]] = {}
    for reg in registers.ALL:
        column = getattr(reg.model, attr)
        for name, value in db.execute(select(reg.model.user, column)).all():
            clean_name = (name or "").strip().lower()
            clean_value = (value or "").strip()
            if not clean_name or not clean_value:
                continue
            seen.setdefault(clean_name, {}).setdefault(clean_value.lower(), clean_value)
    return {name: next(iter(found.values()))
            for name, found in seen.items() if len(found) == 1}


def backfill_user_details(db: Session) -> dict[str, int]:
    filled: dict[str, int] = {}

    for field, attr in _RECOVERABLE_FROM_REGISTER.items():
        column = getattr(User, field)
        blanks = db.execute(
            select(User).where(or_(column.is_(None), func.trim(column) == ""))
        ).scalars().all()
        if not blanks:
            continue

        by_name = _register_values_by_person(db, attr)
        count = 0
        for user in blanks:
            found = by_name.get((user.full_name or "").strip().lower())
            if not found:
                continue
            setattr(user, field, found)
            count += 1
        if count:
            filled[field] = count

    if filled:
        db.commit()
    return filled

_NOT_A_PERSON = re.compile(
    r"(^|\s)(sold|scrap|spare|stock|common|pool|office|service|store|room|"
    r"counter|reception|desk|lab|server|helpdesk|guest|demo|test|training|"
    r"department|security|conference|meeting)\d*(\s|$)",
    re.IGNORECASE,
)

_TITLE_WORDS = {
    "trainee", "intern", "auditor", "deo", "cmo", "cfo", "ceo", "md",
    "hr", "it", "cs", "finance", "accounts", "account", "tally", "admin",
    "exec", "executive", "manager", "assistant", "officer", "dept",
}

_ASIDE = re.compile(r"[\[(]([^\])]*)[\])]")

_USERNAME_STRIP = re.compile(r"[^a-z0-9.]+")


def _name_words(text: str) -> list[str]:
    words = [w for w in text.split() if any(ch.isalpha() for ch in w)]
    while words and words[-1].lower().rstrip("0123456789") in _TITLE_WORDS:
        words.pop()
    return words


def _is_person_name(text: str) -> bool:
    clean = " ".join(text.split())
    if not clean or _NOT_A_PERSON.search(clean):
        return False
    return len(_name_words(clean)) >= 2


def clean_person_name(value: Any) -> str:
    raw = str(value or "")
    outside = " ".join(_ASIDE.sub(" ", raw).split())
    if _is_person_name(outside):
        return " ".join(_name_words(outside))

    inside = _ASIDE.search(raw)
    if inside:
        text = " ".join(inside.group(1).split())
        if _is_person_name(text):
            return " ".join(_name_words(text))

    return ""


def looks_like_a_person(value: Any) -> bool:
    return bool(clean_person_name(value))


def derive_username(full_name: Any) -> str:
    words = _name_words(clean_person_name(full_name))
    if not words:
        return ""
    first = _USERNAME_STRIP.sub("", words[0].lower()).strip(".")
    last = _USERNAME_STRIP.sub("", words[-1].lower()).strip(".") if len(words) > 1 else ""
    candidate = f"{first}.{last}" if last else first
    return candidate.strip(".") or first


def unique_username(base: str, taken: set[str]) -> str:
    if base not in taken:
        return base
    n = 2
    while f"{base}{n}" in taken:
        n += 1
    return f"{base}{n}"


def _field_by_person(rows: list[Any], key: str) -> dict[str, str]:
    seen: dict[str, dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = clean_person_name(str(row.get("user") or ""))
        value = "" if row.get(key) is None else str(row.get(key)).strip()
        if not name or not value:
            continue
        seen.setdefault(name.lower(), {}).setdefault(value.lower(), value)
    return {name: next(iter(found.values()))
            for name, found in seen.items() if len(found) == 1}


def emails_by_person(rows: list[Any]) -> dict[str, str]:
    return _field_by_person(rows, "email")


def locations_by_person(rows: list[Any]) -> dict[str, str]:
    return _field_by_person(rows, "location")


def joining_dates_by_person(rows: list[Any]) -> dict[str, str]:
    return {name: day for name, day in _field_by_person(rows, "dateOfJoining").items()
            if DATE_RE.match(day)}


def fill_joining_dates(db: Session, joining: dict[str, str]) -> int:
    if not joining:
        return 0
    filled = 0
    for user in db.execute(select(User).where(User.date_of_joining.is_(None))).scalars():
        day = joining.get(" ".join((user.full_name or "").split()).lower())
        if day:
            user.date_of_joining = day
            filled += 1
    if filled:
        db.commit()
    return filled


def create_users_from_names(
    db: Session, names: list[str], password: str,
    emails: Optional[dict[str, str]] = None,
    locations: Optional[dict[str, str]] = None,
    joining: Optional[dict[str, str]] = None,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    password_hash = get_password_hash(password)

    all_users = list(db.execute(select(User)).scalars().all())
    taken = {u.username.lower() for u in all_users}
    existing_names = {u.full_name.strip().lower() for u in all_users if u.full_name}

    seen_cells: set[str] = set()
    seen_people: set[str] = set()

    for raw in names:
        cell = str(raw or "").strip()
        if not cell or cell.lower() in seen_cells:
            continue
        seen_cells.add(cell.lower())

        name = clean_person_name(cell)
        if not name:
            skipped.append({"name": cell, "username": "",
                            "reason": "does not look like a person's name"})
            continue

        key = name.lower()
        if key in seen_people:
            continue
        seen_people.add(key)

        if key in existing_names:
            skipped.append({"name": name, "username": "",
                            "reason": "already has an account"})
            continue

        base = derive_username(name)
        if not base:
            skipped.append({"name": name, "username": "",
                            "reason": "no usable username could be made from this name"})
            continue

        username = unique_username(base, taken)
        taken.add(username)
        db.add(User(
            username=username,
            password_hash=password_hash,
            full_name=name,
            role=roles.BULK_CREATED_ROLE,
            email=_clean_email((emails or {}).get(key)),
            location=(locations or {}).get(key) or None,
            is_active=True,
            must_change_password=True,
            date_of_joining=(joining or {}).get(key) or None,
        ))
        created.append({"name": name, "username": username, "reason": ""})

    db.commit()
    return created, skipped


USER_UPLOAD_MAX_ROWS = 5000
USER_UPLOAD_REQUIRED = (("fullName", "Full Name"), ("email", "Email ID"),
                        ("location", "Location"), ("dateOfJoining", "Date of Joining"))


def _upload_username(full_name: str, taken: set[str]) -> str:
    base = derive_username(full_name) or _USERNAME_STRIP.sub(
        ".", " ".join(full_name.lower().split())).strip(".")
    return unique_username(base, taken) if base else ""


def bulk_upsert_users(db: Session, rows: list[Any], default_password: str) -> dict[str, Any]:
    created: list[dict[str, Any]] = []
    updated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    unchanged = 0

    everyone = list(db.execute(select(User)).scalars().all())
    by_email: dict[str, list[User]] = {}
    by_name: dict[str, list[User]] = {}
    for u in everyone:
        if u.email:
            by_email.setdefault(u.email.strip().lower(), []).append(u)
        by_name.setdefault(" ".join((u.full_name or "").split()).lower(), []).append(u)
    taken = {u.username.lower() for u in everyone}
    password_hash = None
    seen: set[str] = set()

    def cell(row, key):
        value = row.get(key) if isinstance(row, dict) else None
        return " ".join(str(value).split()) if value not in (None, "") else ""

    for index, row in enumerate(rows):
        full_name, email = cell(row, "fullName"), cell(row, "email")
        location, joined = cell(row, "location"), cell(row, "dateOfJoining")

        def skip(reason):
            skipped.append({"row": index, "name": full_name or email, "reason": reason})

        missing = [label for key, label in USER_UPLOAD_REQUIRED if not cell(row, key)]
        if missing:
            skip(f"missing {', '.join(missing)}")
            continue
        if not EMAIL_RE.match(email):
            skip(f"Email ID {email!r} is not a valid address")
            continue
        if not DATE_RE.match(joined):
            skip(f"Date of Joining {joined!r} is not a date (use dd-mm-yyyy)")
            continue

        same_mail = by_email.get(email.lower(), [])
        same_name = by_name.get(full_name.lower(), [])
        unaddressed = [u for u in same_name if not u.email]
        note = ""
        if len(same_mail) > 1:
            skip(f"{len(same_mail)} accounts share the Email ID {email} -- correct them first")
            continue
        if same_mail:
            account = same_mail[0]
        elif len(unaddressed) > 1:
            skip(f"{len(unaddressed)} accounts are called {full_name} with no Email ID on file "
                 "-- set it on the right one, then upload again")
            continue
        elif unaddressed:
            account = unaddressed[0]
        else:
            account = None
            if same_name:
                note = (f"another account is called {full_name}, with a different Email ID "
                        "-- treated as a different person")

        marker = f"id:{account.id}" if account is not None and account.id else f"mail:{email.lower()}"
        if marker in seen or f"mail:{email.lower()}" in seen:
            skip("appears earlier in this file")
            continue
        seen.add(marker)
        seen.add(f"mail:{email.lower()}")

        if account is not None:
            changes = []
            if (account.email or "") != email:
                account.email = email
                changes.append("email")
            place = canonical_location(db, location)
            if (account.location or "") != place:
                account.location = place
                changes.append("location")
            if (account.date_of_joining or "") != joined:
                account.date_of_joining = joined
                changes.append("date of joining")
            if changes:
                updated.append({"row": index, "username": account.username,
                                "fullName": account.full_name, "fields": changes})
            else:
                unchanged += 1
            continue

        username = _upload_username(full_name, taken)
        if not username:
            skip("no usable username could be made from this name")
            continue
        taken.add(username.lower())
        if password_hash is None:
            password_hash = get_password_hash(default_password)
        user = User(
            username=username,
            password_hash=password_hash,
            full_name=full_name,
            role=roles.ASSIGNEE,
            email=email,
            location=canonical_location(db, location),
            is_active=True,
            must_change_password=True,
            date_of_joining=joined,
        )
        db.add(user)
        by_email.setdefault(email.lower(), []).append(user)
        by_name.setdefault(full_name.lower(), []).append(user)
        created.append({"row": index, "username": username, "fullName": full_name, "note": note})

    db.commit()
    return {"created": created, "updated": updated, "unchanged": unchanged, "skipped": skipped}


def clear_all_users(db: Session, keep_user_id: str) -> int:
    doomed = [u for u in db.execute(select(User)).scalars().all() if u.id != keep_user_id]
    for user in doomed:
        db.delete(user)
    db.commit()
    return len(doomed)


def update_user(
    db: Session,
    user: User,
    *,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    password: Optional[str] = None,
    email: Optional[str] = None,
    location: Optional[str] = None,
    date_of_joining: Optional[str] = None,
) -> User:
    if full_name is not None:
        user.full_name = full_name
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    if email is not None:
        user.email = _clean_email(email)
    if location is not None:
        user.location = canonical_location(db, location)
    if date_of_joining is not None:
        user.date_of_joining = date_of_joining.strip() or None
    if password:
        user.password_hash = get_password_hash(password)
    db.commit()
    db.refresh(user)
    return user


def deactivate_user(db: Session, user: User) -> None:
    user.is_active = False
    db.commit()


def peripheral_ref(peripheral) -> dict[str, Any]:
    return {
        "id": peripheral.id,
        "assetId": peripheral.asset_id,
        "srl": peripheral.srl or "",
        "type": peripheral.type,
        "model": peripheral.model,
        "assetTag": peripheral.asset_tag,
        "label": peripheral_label(peripheral),
    }


def asset_ref(asset) -> dict[str, Any]:
    return {"id": asset.id, "assetId": asset.asset_id,
            "assetTag": asset.asset_tag, "model": asset.model}


def asset_to_dict(asset, links=None, linked_to=None, shared=None) -> dict[str, Any]:  # noqa: C901
    d: dict[str, Any] = {key: getattr(asset, attr) for key, attr in attrs_of(asset).items()}
    d["register"] = registers.of(asset).key
    d["id"] = asset.id

    if registers.of(asset) is registers.SOFTWARES:
        pass
    elif registers.of(asset) is ASSETS:
        refs = [peripheral_ref(p) for p in (links or [])]
        d["linkedPeripherals"] = refs
        d["linkedPeripheralsText"] = ", ".join(r["label"] for r in refs if r["label"])
    else:
        on = [asset_ref(a) for a in (linked_to or [])]
        d["linkedAssets"] = on
        d["linkedAssetText"] = ", ".join(a["assetId"] or "" for a in on if a["assetId"])
        d["isSharedType"] = is_shared_peripheral(asset, shared or set())
    d["createdAt"] = asset.created_at.isoformat() if asset.created_at else None
    d["updatedAt"] = asset.updated_at.isoformat() if asset.updated_at else None
    d["createdBy"] = asset.created_by
    d["updatedBy"] = asset.updated_by
    d["isDeleted"] = bool(asset.is_deleted)
    d["verification"] = asset.verification or VERIFIED
    d["verifiedBy"] = asset.verified_by
    d["verifiedAt"] = asset.verified_at.isoformat() if asset.verified_at else None
    d["verificationNote"] = asset.verification_note
    d["lifecycle"] = lifecycle(asset)
    return d


def auth_user_dict(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "fullName": user.full_name,
        "email": getattr(user, "email", None),
        "location": getattr(user, "location", None),
        "dateOfJoining": getattr(user, "date_of_joining", None),
        "role": user.role,
        "mustChangePassword": bool(getattr(user, "must_change_password", False)),
    }


def me_dict(user: User) -> dict[str, Any]:
    d = auth_user_dict(user)
    d["isActive"] = user.is_active
    return d


def user_out_dict(user: User) -> dict[str, Any]:
    d = me_dict(user)
    d["createdAt"] = user.created_at.isoformat() if user.created_at else None
    return d

