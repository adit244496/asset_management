from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import crud, registers
from app.datefmt import to_ist, today_ist


class ToolError(Exception):
    pass


REGISTER_ENUM = ["asset", "peripheral", "software", "both", "all"]
FILE_REGISTER_ENUM = ["asset", "peripheral", "software"]
REGISTER_NOUNS = {"asset": "Assets", "peripheral": "Peripherals", "software": "Softwares",
                  "both": "Assets and peripherals", "all": "Assets, peripherals and softwares"}

FILTER_ATTRS = ("status", "location", "type", "make", "department", "company", "vendor")

DATE_FIELDS = {
    "purchase": "dop",
    "warranty_end": "warranty_end",
    "insurance_end": "insurance_end",
    "assigned": "assigned_date",
    "added": "created_at",
    "renewal": "warranty_end",
}
DATE_FIELD_ENUM = ["none", *DATE_FIELDS]
DATE_WORDS = {
    "purchase": "Bought",
    "warranty_end": "Warranty / AMC ends",
    "insurance_end": "Insurance ends",
    "assigned": "Assigned",
    "added": "Added to the register",
    "renewal": "Renews",
}

LIFECYCLE_ENUM = ["any", "new", "replaced"]

CHECKS = {
    "warranty_expiring": {
        "label": "Warranty / AMC ends within {days} days",
        "registers": ("asset", "peripheral"),
    },
    "warranty_expired_in_use": {
        "label": "In use, warranty / AMC already ended",
        "registers": ("asset", "peripheral"),
    },
    "insurance_expiring": {
        "label": "Insurance ends within {days} days",
        "registers": ("asset", "peripheral"),
    },
    "insurance_expired_in_use": {
        "label": "In use, insurance already ended",
        "registers": ("asset", "peripheral"),
    },
    "in_use_no_user": {
        "label": "In use but no assigned user",
        "registers": ("asset",),
    },
    "in_stock_but_assigned": {
        "label": "In stock but still assigned to someone",
        "registers": ("asset",),
    },
    "in_use_not_linked": {
        "label": "In use but not linked to any asset",
        "registers": ("peripheral",),
    },
    "renewal_due": {
        "label": "Licence renewal due within {days} days",
        "registers": ("software",),
    },
    "renewal_overdue": {
        "label": "Licence renewal date already passed",
        "registers": ("software",),
    },
}
CHECK_ENUM = ["none", *CHECKS]
DEFAULT_DAYS = 90

_NOBODY = {"", "-", "—", "n/a", "na", "none", "nil", "null"}

COLUMNS = {
    "srl_no": ["srl"],
    "asset_id": ["assetId"],
    "sap_id": ["sapId"],
    "type": ["type"],
    "name": ["assetTag"],
    "model": ["model"],
    "make": ["make"],
    "description": ["description"],
    "status": ["status"],
    "assigned_user": ["user"],
    "email": ["email"],
    "department": ["department"],
    "location": ["location"],
    "site": ["site"],
    "floor": ["floor"],
    "company": ["company"],
    "po_no": ["poNo"],
    "date_of_purchase": ["dop"],
    "warranty_end": ["warrantyEnd"],
    "insurance_end": ["insuranceEnd"],
    "assigned_date": ["assignedDate"],
    "comments": ["comments"],
    "linked": ["linkedPeripheralsText", "linkedAssetText"],
    "availability": ["availability"],
    "version": ["version"],
    "quantity": ["quantity"],
    "renewal_date": ["warrantyEnd"],
    "price": ["price"],
    "vendor": ["vendor"],
}

GROUP_BY_ENUM = ["status", "location", "site", "floor", "type", "department",
                 "company", "make", "model", "assigned_user", "lifecycle",
                 "purchase_year", "age_band", "name", "version", "vendor", "renewal_year"]
GROUP_LABELS = {
    "status": "Status", "location": "Location", "site": "Site", "floor": "Floor",
    "type": "Type", "department": "Department", "company": "Company", "make": "Make",
    "model": "Model", "assigned_user": "Assigned user", "lifecycle": "New / replaced",
    "purchase_year": "Year bought", "age_band": "Age",
    "name": "Software", "version": "Version", "vendor": "Vendor / used by",
    "renewal_year": "Renewal year",
}
MEASURE_ENUM = ["count", "average_age", "total_seats", "total_value"]
NOT_RECORDED = "(not recorded)"

AGE_BANDS = ["Under 1 yr", "1–2 yrs", "2–3 yrs", "3–4 yrs", "4–5 yrs", "5+ yrs"]
FUTURE_DATE = "Date in the future"
YEAR_DAYS = 365.2425


def same(a, b) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def register_list(key: str):
    if key == "asset":
        return (registers.ASSETS,)
    if key == "peripheral":
        return (registers.PERIPHERALS,)
    if key == "software":
        return (registers.SOFTWARES,)
    if key == "all":
        return registers.ALL
    return registers.HARDWARE


def today() -> date:
    return today_ist()


_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d")


def parse_day(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return to_ist(value).date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def has_user(item) -> bool:
    return (getattr(item, "user", "") or "").strip().lower() not in _NOBODY


def age_years(bought: date, on: date) -> int:
    return on.year - bought.year - ((on.month, on.day) < (bought.month, bought.day))


def age_band(item, on: date) -> str:
    bought = parse_day(item.dop)
    if bought is None:
        return NOT_RECORDED
    if bought > on:
        return FUTURE_DATE
    return AGE_BANDS[min(max(age_years(bought, on), 0), len(AGE_BANDS) - 1)]


def exact_age(item, on: date) -> Optional[float]:
    bought = parse_day(item.dop)
    if bought is None or bought > on:
        return None
    return (on - bought).days / YEAR_DAYS


def group_value(item, field: str, on: date) -> str:
    if field == "lifecycle":
        return "New" if crud.lifecycle(item) == crud.LIFECYCLE_NEW else "Replaced"
    if field == "purchase_year":
        bought = parse_day(item.dop)
        return str(bought.year) if bought else NOT_RECORDED
    if field == "age_band":
        return age_band(item, on)
    if field == "assigned_user":
        return (item.user or "").strip() if has_user(item) else NOT_RECORDED
    if field == "name":
        return (item.asset_tag or "").strip() or NOT_RECORDED
    if field == "renewal_year":
        renews = parse_day(item.warranty_end)
        return str(renews.year) if renews else NOT_RECORDED
    return (str(getattr(item, field, None) or "")).strip() or NOT_RECORDED


def check_label(key: str, days: int) -> str:
    return CHECKS[key]["label"].format(days=days)


def _iso(raw, name: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    try:
        return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise ToolError(f"{name} must be a date as yyyy-mm-dd, or an empty string; got {text!r}.")


def normalize(raw: dict, *, file: bool = False) -> dict:
    raw = raw or {}
    reg = raw.get("register") or ("asset" if file else "both")
    allowed = FILE_REGISTER_ENUM if file else REGISTER_ENUM
    if reg not in allowed:
        raise ToolError(f"register must be one of {', '.join(allowed)}.")

    spec: dict[str, Any] = {"register": reg}
    for key in (*FILTER_ATTRS, "text", "assigned_to"):
        spec[key] = str(raw.get(key) or "").strip()[:200]

    date_field = raw.get("date_field") or "none"
    if date_field not in DATE_FIELD_ENUM:
        raise ToolError(f"date_field must be one of {', '.join(DATE_FIELD_ENUM)}.")
    date_from = _iso(raw.get("date_from"), "date_from")
    date_to = _iso(raw.get("date_to"), "date_to")
    if date_field == "none":
        date_from = date_to = ""
    elif not (date_from or date_to):
        raise ToolError(f"date_field is {date_field!r} but no date_from or date_to was given. "
                        "Give at least one, or set date_field to 'none'.")
    if date_from and date_to and date_from > date_to:
        raise ToolError(f"date_from ({date_from}) is after date_to ({date_to}).")
    spec.update(date_field=date_field, date_from=date_from, date_to=date_to)

    lifecycle = raw.get("lifecycle") or "any"
    if lifecycle not in LIFECYCLE_ENUM:
        raise ToolError(f"lifecycle must be one of {', '.join(LIFECYCLE_ENUM)}.")
    spec["lifecycle"] = lifecycle

    check = raw.get("check") or "none"
    if check not in CHECK_ENUM:
        raise ToolError(f"check must be one of {', '.join(CHECK_ENUM)}.")
    if check != "none" and reg not in ("both", "all") and reg not in CHECKS[check]["registers"]:
        raise ToolError(f"The check {check!r} applies to the "
                        f"{' and '.join(CHECKS[check]['registers'])} register only.")
    spec["check"] = check

    try:
        days = int(raw.get("within_days") or DEFAULT_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    spec["within_days"] = min(max(days, 1), 3650)
    spec["include_scrapped"] = bool(raw.get("include_scrapped"))
    return spec


def describe(spec: dict) -> str:
    parts = []
    if spec.get("text"):
        parts.append(f'Matching "{spec["text"]}"')
    for key in FILTER_ATTRS:
        if spec.get(key):
            parts.append(f"{'Vendor / used by' if key == 'vendor' else key.capitalize()}: {spec[key]}")
    if spec.get("assigned_to"):
        parts.append(f'Assigned to "{spec["assigned_to"]}"')
    field = spec.get("date_field") or "none"
    if field != "none":
        start, end = spec.get("date_from"), spec.get("date_to")
        if start and end:
            parts.append(f"{DATE_WORDS[field]} {start} to {end}")
        elif start:
            parts.append(f"{DATE_WORDS[field]} on or after {start}")
        else:
            parts.append(f"{DATE_WORDS[field]} on or before {end}")
    if spec.get("lifecycle") == "new":
        parts.append("New only")
    elif spec.get("lifecycle") == "replaced":
        parts.append("Replaced only")
    if spec.get("check", "none") != "none":
        parts.append(check_label(spec["check"], spec.get("within_days") or DEFAULT_DAYS))
    parts.append("Scrapped included" if spec.get("include_scrapped") else "Scrapped left out")
    return " · ".join(parts)


def columns_for(names: list) -> list[str]:
    keys: list[str] = []
    for name in names or []:
        if name not in COLUMNS:
            raise ToolError(f"Unknown column {name!r}. Use: {', '.join(COLUMNS)}.")
        for key in COLUMNS[name]:
            if key not in keys:
                keys.append(key)
    return keys


class Pools:
    def __init__(self, db: Session):
        self.db = db
        self._rows: dict[str, list] = {}
        self._links: Optional[dict] = None

    def rows(self, reg) -> list:
        if reg.key not in self._rows:
            self._rows[reg.key] = crud.list_assets(self.db, reg)
        return self._rows[reg.key]

    def linked(self, item) -> bool:
        if self._links is None:
            self._links = crud.linked_assets_map(self.db, self.rows(registers.PERIPHERALS))
        return bool(self._links.get(item.id))


def _matches(item, spec) -> bool:
    for key in FILTER_ATTRS:
        want = spec.get(key)
        if want and not same(getattr(item, key, None), want):
            return False
    who = (spec.get("assigned_to") or "").strip().lower()
    if who and who not in (getattr(item, "user", "") or "").lower():
        return False
    text = (spec.get("text") or "").strip().lower()
    if text:
        hay = " ".join(str(v or "") for v in (
            item.asset_id, item.sap_id, item.srl, item.asset_tag, item.model,
            item.description, getattr(item, "user", ""), item.service_tag,
            getattr(item, "version", ""), getattr(item, "vendor", ""), item.po_no,
        )).lower()
        if text not in hay:
            return False
    return True


def _in_range(item, spec) -> bool:
    field = spec.get("date_field") or "none"
    if field == "none":
        return True
    value = parse_day(getattr(item, DATE_FIELDS[field], None))
    if value is None:
        return False
    iso = value.isoformat()
    if spec.get("date_from") and iso < spec["date_from"]:
        return False
    if spec.get("date_to") and iso > spec["date_to"]:
        return False
    return True


def _passes_check(item, spec, on: date, pools: Pools) -> bool:
    check = spec.get("check") or "none"
    if check == "none":
        return True
    reg = registers.of(item).key
    if reg not in CHECKS[check]["registers"]:
        return False
    active = (item.availability or "").upper() != "INACTIVE" and not item.is_deleted
    if check in ("warranty_expiring", "insurance_expiring"):
        end = parse_day(item.warranty_end if check == "warranty_expiring" else item.insurance_end)
        return active and end is not None and 0 <= (end - on).days <= spec["within_days"]
    if check in ("warranty_expired_in_use", "insurance_expired_in_use"):
        end = parse_day(item.warranty_end if check == "warranty_expired_in_use" else item.insurance_end)
        return active and crud.is_in_use(item.status) and end is not None and end < on
    if check == "in_use_no_user":
        return crud.is_in_use(item.status) and not has_user(item)
    if check == "in_stock_but_assigned":
        return crud.is_in_stock(item.status) and has_user(item)
    if check == "in_use_not_linked":
        return crud.is_in_use(item.status) and not pools.linked(item)
    if check in ("renewal_due", "renewal_overdue"):
        renews = parse_day(item.warranty_end)
        if not active or renews is None:
            return False
        days = (renews - on).days
        return days < 0 if check == "renewal_overdue" else 0 <= days <= spec["within_days"]
    return True


def select(db: Session, spec: dict, *, strict: bool = True,
           pools: Optional[Pools] = None) -> list:
    pools = pools or Pools(db)
    pool = [item for reg in register_list(spec["register"]) for item in pools.rows(reg)
            if spec.get("include_scrapped") or not item.is_deleted]
    if strict:
        for key in FILTER_ATTRS:
            want = (spec.get(key) or "").strip()
            if not want:
                continue
            in_use = {(getattr(i, key, None) or "").strip() for i in pool} - {""}
            if not any(same(v, want) for v in in_use):
                shown = ", ".join(sorted(in_use, key=str.lower)[:30]) or "none recorded"
                raise ToolError(f"No record has {key} {want!r}. Values in use: {shown}.")
    on = today()
    lifecycle = spec.get("lifecycle") or "any"
    found = [
        item for item in pool
        if _matches(item, spec) and _in_range(item, spec)
        and (lifecycle == "any" or crud.lifecycle(item) == lifecycle)
        and _passes_check(item, spec, on, pools)
    ]
    found.sort(key=_srl_order)
    return found


_REGISTER_ORDER = {"asset": 0, "peripheral": 1, "software": 2}


def _srl_order(item):
    srl = (item.srl or "").strip()
    return (_REGISTER_ORDER.get(registers.of(item).key, 9),
            0 if srl.isdigit() else 1,
            int(srl) if srl.isdigit() else 0,
            item.asset_id or "")


MAX_GROUPS = 25
MAX_COLUMNS = 8


def _ordered(counts: dict[str, int], field: str) -> list[str]:
    if field == "age_band":
        order = [*AGE_BANDS, FUTURE_DATE, NOT_RECORDED]
        return [v for v in order if v in counts]
    if field == "purchase_year":
        return sorted(counts, key=lambda v: (v == NOT_RECORDED, v))
    return sorted(counts, key=lambda v: (-counts[v], v == NOT_RECORDED, v.lower()))


def _average(ages: list[float]) -> Optional[float]:
    return round(sum(ages) / len(ages), 1) if ages else None


def _amount(item, measure: str) -> float:
    raw = getattr(item, "quantity" if measure == "total_seats" else "price", None)
    try:
        return float(raw) if raw not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _total(items: list, measure: str):
    total = sum(_amount(i, measure) for i in items)
    return int(total) if measure == "total_seats" else round(total, 2)


def summarize(items: list, group_by: str, then_by: str, measure: str) -> dict:
    on = today()
    with_age = measure == "average_age"
    with_sum = measure in ("total_seats", "total_value")
    sum_label = "Seats" if measure == "total_seats" else "Value (₹)"
    sum_key = "totalSeats" if measure == "total_seats" else "totalValue"
    title_measure = "Average age" if with_age else (sum_label if with_sum else "Count")

    if group_by == "none":
        out = {"total": len(items)}
        if with_age:
            ages = [a for a in (exact_age(i, on) for i in items) if a is not None]
            out["averageAgeYears"] = _average(ages)
            out["datedRecords"] = len(ages)
        if with_sum:
            out[sum_key] = _total(items, measure)
        return {"result": out, "table": None}

    if group_by not in GROUP_BY_ENUM:
        raise ToolError(f"Cannot group by {group_by!r}. Use one of: {', '.join(GROUP_BY_ENUM)}.")
    if then_by not in ("none", *GROUP_BY_ENUM):
        raise ToolError(f"Cannot group by {then_by!r}. Use one of: {', '.join(GROUP_BY_ENUM)}.")
    if then_by == group_by:
        then_by = "none"

    rows: dict[str, list] = {}
    for item in items:
        rows.setdefault(group_value(item, group_by, on), []).append(item)
    counts = {k: len(v) for k, v in rows.items()}
    order = _ordered(counts, group_by)
    shown, hidden = order[:MAX_GROUPS], order[MAX_GROUPS:]

    if then_by == "none":
        groups, table_rows = [], []
        for value in shown:
            entry = {"value": value, "count": counts[value]}
            cells = [value, counts[value]]
            if with_age:
                avg = _average([a for a in (exact_age(i, on) for i in rows[value]) if a is not None])
                entry["averageAgeYears"] = avg
                cells.append(avg)
            if with_sum:
                entry[sum_key] = _total(rows[value], measure)
                cells.append(entry[sum_key])
            groups.append(entry)
            table_rows.append(cells)
        header = ([GROUP_LABELS[group_by], "Count"] + (["Avg age (yrs)"] if with_age else [])
                  + ([sum_label] if with_sum else []))
        result = {"total": len(items), "groupedBy": group_by, "groups": groups,
                  "moreGroups": len(hidden)}
        if with_sum:
            result[sum_key] = _total(items, measure)
        footer = ["Total", len(items)]
        if with_age:
            footer.append(_average([a for a in (exact_age(i, on) for i in items) if a is not None]))
        if with_sum:
            footer.append(_total(items, measure))
        table = {"header": header, "rows": table_rows, "footer": footer,
                 "more": len(hidden), "measure": title_measure}
        return {"result": result, "table": table}

    col_counts: dict[str, int] = {}
    for item in items:
        v = group_value(item, then_by, on)
        col_counts[v] = col_counts.get(v, 0) + 1
    col_order = _ordered(col_counts, then_by)
    columns = col_order[:MAX_COLUMNS]
    folded = len(col_order) > MAX_COLUMNS
    header_cols = columns + (["Other"] if folded else [])

    def line_for(group: list) -> list[int]:
        cells = {c: 0 for c in header_cols}
        for item in group:
            v = group_value(item, then_by, on)
            cells[v if v in columns else "Other"] += 1
        return [cells[c] for c in header_cols]

    table_rows, model_rows = [], []
    for value in shown:
        line = line_for(rows[value])
        table_rows.append([value, *line, counts[value]])
        model_rows.append({"value": value, "total": counts[value], "counts": line})
    totals = line_for(items)
    header = [GROUP_LABELS[group_by], *header_cols, "Total"]
    result = {"total": len(items), "groupedBy": group_by, "thenBy": then_by,
              "columns": header_cols, "rows": model_rows, "moreGroups": len(hidden)}
    table = {"header": header, "rows": table_rows,
             "footer": ["Total", *totals, len(items)],
             "more": len(hidden), "measure": "Count"}
    return {"result": result, "table": table}


def summary_title(spec: dict, group_by: str, then_by: str, measure: str) -> str:
    noun = REGISTER_NOUNS.get(spec["register"], "Records")
    by = GROUP_LABELS.get(group_by, group_by).lower()
    if then_by not in ("none", group_by):
        by += f" and {GROUP_LABELS.get(then_by, then_by).lower()}"
    if measure == "average_age":
        return f"Average age of {noun.lower()} by {by}"
    if measure == "total_seats":
        return f"Seats of {noun.lower()} by {by}"
    if measure == "total_value":
        return f"Value of {noun.lower()} by {by}"
    return f"{noun} by {by}"

