"""Asset and peripheral IDs built from the type's abbreviation.

New assets and peripherals are numbered <CODE>_<running number>, e.g.
LAP_00001, LAP_00002, MOU_00001: the abbreviation of their Asset Type and a
running number of at least five digits that each abbreviation counts on its
own (shared by both registers, so an ID is never used twice).

* Every Asset Type has an abbreviation (`asset_types.code`) of exactly three
  letters or digits, unique across the list and editable on Master Data. A
  new type gets one automatically: the known ones below, otherwise its first
  three letters; on a clash the third character becomes a number (DES, DE1,
  DE2 ...), then the last two (D01, D02 ...). A bulk import naming types not
  in Master Data shows the abbreviations first and takes edited ones
  (plan_new_codes / check_chosen_codes).
* An ID is given once, when the record is saved, and never changes -- not
  if the type is corrected, not if its abbreviation is edited later.
* Records saved before this scheme keep their AMB.../PRP... IDs. Softwares
  keep SFT... IDs (see crud.next_asset_id).
"""
import logging
import re
from typing import Iterable, Optional

from sqlalchemy import event, func, select, text
from sqlalchemy.orm import Session

from app.models import AssetType, Counter

logger = logging.getLogger(__name__)

CODE_LEN = 3
CODE_RE = re.compile(rf"^[A-Z][A-Z0-9]{{{CODE_LEN - 1}}}$")
DIGITS = 5
COUNTER_PREFIX = "type_id:"
UNIQUE_INDEX = "ix_asset_types_code_unique"

# Abbreviations agreed for these types (not always their first letters).
KNOWN_CODES = {
    "desktop": "DES",
    "laptop": "LAP",
    "printer": "PRI",
    "mouse": "MOU",
    "server": "SER",
    "pen drive": "PEN",
    "pendrive": "PEN",
    "extn hdd": "HDD",
    "ext hdd": "HDD",
    "external hdd": "HDD",
}


def clean_code(value) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()


def code_problem(code: str) -> Optional[str]:
    if not CODE_RE.match(code):
        return (f"The abbreviation must be exactly {CODE_LEN} letters or digits, starting with a "
                "letter (e.g. LAP, HDD, DE1).")
    return None


def base_code(name: str) -> str:
    key = " ".join(str(name or "").lower().split())
    if key in KNOWN_CODES:
        return KNOWN_CODES[key]
    letters = re.sub(r"[^A-Za-z]", "", str(name or "")).upper()
    if len(letters) >= CODE_LEN:
        return letters[:CODE_LEN]
    # Short or mostly-digit names ("PC", "3D printer"): still a valid code.
    alnum = clean_code(name)
    if not alnum:
        return "TYP"
    if not alnum[0].isalpha():
        alnum = "T" + alnum
    return (alnum + "XX")[:CODE_LEN]


def suggest_code(name: str, taken: Iterable[str]) -> str:
    """The type's three-character abbreviation, not one already in use:
    DES, then DE1 ... DE9, then D01 ... D99 (names cleaned the same way)."""
    used = {str(c).upper() for c in taken if c}
    base = base_code(name)
    if base not in used:
        return base
    for n in range(1, 10):
        if f"{base[:2]}{n}" not in used:
            return f"{base[:2]}{n}"
    for n in range(1, 100):
        if f"{base[0]}{n:02d}" not in used:
            return f"{base[0]}{n:02d}"
    for first in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        for n in range(100):
            if f"{first}{n:02d}" not in used:
                return f"{first}{n:02d}"
    raise ValueError("No three-character abbreviation is free.")


def taken_codes(db: Session, exclude_id: Optional[str] = None) -> set[str]:
    stmt = select(AssetType.code).where(AssetType.code.is_not(None))
    if exclude_id:
        stmt = stmt.where(AssetType.id != exclude_id)
    return {c.upper() for c in db.execute(stmt).scalars().all() if c}


def find_code_owner(db: Session, code: str, exclude_id: Optional[str] = None) -> Optional[AssetType]:
    stmt = select(AssetType).where(func.upper(AssetType.code) == code.upper())
    if exclude_id:
        stmt = stmt.where(AssetType.id != exclude_id)
    return db.execute(stmt).scalars().first()


# ---------------------------------------------------------------------------
# Which register a type is for (asset_types.used_for): the Data Entry type
# dropdown of Assets offers only asset types, that of Peripherals only
# peripheral types; "both" is offered in both. Softwares have no type.
# ---------------------------------------------------------------------------
USE_ASSET = "asset"
USE_PERIPHERAL = "peripheral"
USE_BOTH = "both"
USES = (USE_ASSET, USE_PERIPHERAL, USE_BOTH)
USE_LABELS = {USE_ASSET: "Assets", USE_PERIPHERAL: "Peripherals", USE_BOTH: "Both"}

# Starting point for a type no record uses yet (records decide otherwise).
KNOWN_USES = {
    **{n: USE_ASSET for n in ("laptop", "desktop", "macbook", "server", "workstation")},
    **{n: USE_PERIPHERAL for n in (
        "mouse", "keyboard", "printer", "scanner", "projector", "pen drive", "pendrive",
        "extn hdd", "ext hdd", "external hdd", "webcam", "headset", "dock", "docking station",
    )},
}

_USE_WORDS = {
    "asset": USE_ASSET, "assets": USE_ASSET, "asset only": USE_ASSET, "assets only": USE_ASSET,
    "peripheral": USE_PERIPHERAL, "peripherals": USE_PERIPHERAL,
    "peripheral only": USE_PERIPHERAL, "peripherals only": USE_PERIPHERAL,
    "both": USE_BOTH, "all": USE_BOTH, "assets and peripherals": USE_BOTH,
    "assets & peripherals": USE_BOTH, "asset and peripheral": USE_BOTH,
    "asset & peripheral": USE_BOTH, "asset / peripheral": USE_BOTH,
}


def clean_use(value) -> Optional[str]:
    """'Assets', 'peripheral', 'Both' ... -> asset / peripheral / both; None if unreadable."""
    return _USE_WORDS.get(" ".join(str(value or "").lower().replace("/", " / ").split()))


def default_use(name: str, shared: bool = False) -> str:
    key = " ".join(str(name or "").lower().split())
    if key in KNOWN_USES:
        return KNOWN_USES[key]
    return USE_PERIPHERAL if shared else USE_BOTH


def use_of(row) -> str:
    return (getattr(row, "used_for", None) or USE_BOTH)


def fits(use: Optional[str], register_key: str) -> bool:
    return (use or USE_BOTH) in (USE_BOTH, register_key)


def type_uses(db: Session) -> dict[str, str]:
    """{type name (lower case): asset / peripheral / both} for every type."""
    return {
        (name or "").strip().lower(): (use or USE_BOTH)
        for name, use in db.execute(select(AssetType.name, AssetType.used_for)).all()
    }


def use_problem(uses: dict[str, str], register, type_name, current_type=None) -> Optional[str]:
    """Why this type cannot be used on this register's record, or None.
    A type not in Master Data yet is fine (it is added for this register).
    Keeping the type a record already has is always fine."""
    from app import registers
    if register not in registers.HARDWARE:
        return None
    clean = str(type_name or "").strip()
    if not clean:
        return None
    if current_type is not None and clean.lower() == str(current_type or "").strip().lower():
        return None
    use = uses.get(clean.lower())
    if use is None or fits(use, register.key):
        return None
    other = "an asset" if use == USE_ASSET else "a peripheral"
    listed = "Assets" if use == USE_ASSET else "Peripherals"
    return (f"Type '{clean}' is {other} type (Master Data > Type > {listed}), so it cannot be "
            f"used for a {register.noun}. Choose a {register.noun} type.")


def ensure_uses(db: Session) -> list[tuple[str, str]]:
    """Startup: every type without a 'used for' gets one -- from the records
    that use it (assets only, peripherals only, or both), otherwise from its
    name. Returns [(type, use)] set."""
    from app import registers
    rows = db.execute(select(AssetType).where(AssetType.used_for.is_(None))).scalars().all()
    if not rows:
        return []
    counts = {}
    for reg in registers.HARDWARE:
        counts[reg.key] = {
            (value or "").strip().lower()
            for value in db.execute(select(reg.model.type).distinct()).scalars().all() if value
        }
    done = []
    for row in rows:
        key = (row.name or "").strip().lower()
        on_asset = key in counts.get(USE_ASSET, set())
        on_peripheral = key in counts.get(USE_PERIPHERAL, set())
        if on_asset and on_peripheral:
            row.used_for = USE_BOTH
        elif on_asset:
            row.used_for = USE_ASSET
        elif on_peripheral:
            row.used_for = USE_PERIPHERAL
        else:
            row.used_for = default_use(row.name, bool(row.is_shared))
        done.append((row.name, row.used_for))
    db.commit()
    return done


def _fill_new_types(session: Session, flush_context, instances) -> None:
    """Every new Asset Type gets an abbreviation, however it is added (Master
    Data, bulk add, workbook upload, a bulk import naming a new type) -- and
    a 'used for' if none was given."""
    for o in session.new:
        if isinstance(o, AssetType) and not o.used_for:
            o.used_for = default_use(o.name, bool(o.is_shared))
    fresh = [o for o in session.new if isinstance(o, AssetType) and not o.code]
    if not fresh:
        return
    with session.no_autoflush:
        used = taken_codes(session)
    used |= {o.code.upper() for o in session.new if isinstance(o, AssetType) and o.code}
    for row in fresh:
        row.code = suggest_code(row.name, used)
        used.add(row.code)


event.listen(Session, "before_flush", _fill_new_types)


def ensure_codes(db: Session) -> list[tuple[str, str]]:
    """Startup: give every Asset Type without a valid three-character
    abbreviation one (oldest first, so the first DES-type keeps DES) -- a
    longer one from before (DES1) is replaced by a free three-character one
    (DE1); IDs already given keep the old one. Then make abbreviations unique
    in the database. Returns [(type, code)] assigned."""
    rows = db.execute(select(AssetType).order_by(AssetType.sort_order, AssetType.created_at,
                                                 AssetType.name)).scalars().all()
    valid = lambda code: bool(code) and bool(CODE_RE.match(code.upper()))  # noqa: E731
    used = {r.code.upper() for r in rows if valid(r.code)}
    assigned = []
    for row in rows:
        if valid(row.code):
            continue
        row.code = suggest_code(row.name, used)
        used.add(row.code)
        assigned.append((row.name, row.code))
    if assigned:
        db.commit()
    db.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {UNIQUE_INDEX} ON asset_types (code)"))
    db.commit()
    return assigned


def type_row(db: Session, type_name: str) -> Optional[AssetType]:
    clean = (type_name or "").strip()
    if not clean:
        return None
    return db.execute(
        select(AssetType).where(func.lower(func.trim(AssetType.name)) == clean.lower())
    ).scalars().first()


def plan_new_codes(db: Session, names: Iterable[str]) -> list[dict[str, str]]:
    """Bulk import, before it runs: the abbreviation each type not yet in
    Master Data would get -- [{name, code}], unique against the list and
    each other (the same rule as adding them one by one)."""
    used = taken_codes(db)
    seen: set[str] = set()
    out = []
    for name in names:
        clean = str(name or "").strip()
        if not clean or clean.lower() in seen:
            continue
        seen.add(clean.lower())
        if type_row(db, clean) is not None:
            continue
        code = suggest_code(clean, used)
        used.add(code)
        out.append({"name": clean, "code": code})
    return out


def check_chosen_codes(db: Session, chosen) -> tuple[dict[str, str], list[str]]:
    """The abbreviations picked for new types on a bulk import ({type name:
    code}) -> ({type name lower case: CODE}, problems). A blank one is left
    out (made up as usual); a type already in Master Data keeps its own."""
    if chosen is None:
        return {}, []
    if not isinstance(chosen, dict):
        return {}, ["typeCodes must map each new type to its abbreviation."]
    out: dict[str, str] = {}
    owner_of: dict[str, str] = {}
    problems = []
    for name, value in chosen.items():
        clean = str(name or "").strip()
        code = clean_code(value)
        if not clean or not code or type_row(db, clean) is not None:
            continue
        problem = code_problem(code)
        if problem:
            problems.append(f"Type '{clean}': {problem}")
            continue
        owner = find_code_owner(db, code)
        if owner is not None:
            problems.append(f"Type '{clean}': the abbreviation {code} is already used by "
                            f"'{owner.name}'. Each type needs its own.")
            continue
        if code in owner_of:
            problems.append(f"Types '{owner_of[code]}' and '{clean}' were both given the "
                            f"abbreviation {code}. Each type needs its own.")
            continue
        owner_of[code] = clean
        out[clean.lower()] = code
    return out, problems


def code_for_type(db: Session, type_name: str, register_key: Optional[str] = None,
                  chosen: Optional[dict[str, str]] = None) -> str:
    """The abbreviation of this type, adding the type to Master Data if it
    is not there yet (as saving the record would anyway) -- for the register
    it was first used on, with the abbreviation picked for it on a bulk
    import (`chosen`, from check_chosen_codes) if there is one."""
    row = type_row(db, type_name)
    if row is None:
        from app.masters import MASTERS
        from app import crud
        spec = MASTERS["type"]
        clean = (type_name or "").strip()
        row = spec.new_row(name=clean, description=None,
                           sort_order=crud._next_sort_order(db, spec), is_active=True,
                           used_for=register_key if register_key in (USE_ASSET, USE_PERIPHERAL) else None)
        picked = (chosen or {}).get(clean.lower())
        if picked:
            with db.no_autoflush:
                if find_code_owner(db, picked) is None:  # still free
                    row.code = picked
        db.add(row)
        db.flush()  # _fill_new_types gives it its abbreviation if none was picked
    elif not row.code:
        row.code = suggest_code(row.name, taken_codes(db, exclude_id=row.id))
        db.flush()
    return row.code.upper()


def _highest_in_use(db: Session, code: str) -> int:
    from app import registers
    pattern = re.compile(rf"^{re.escape(code)}_(\d+)$", re.IGNORECASE)
    highest = 0
    for reg in registers.HARDWARE:
        for value in db.execute(
            select(reg.model.asset_id).where(reg.model.asset_id.ilike(f"{code}\\_%", escape="\\"))
        ).scalars().all():
            m = pattern.match(value or "")
            if m:
                highest = max(highest, int(m.group(1)))
    return highest


def format_id(code: str, number: int) -> str:
    return f"{code}_{number:0{DIGITS}d}"


def next_id(db: Session, type_name: str, register_key: Optional[str] = None,
            chosen: Optional[dict[str, str]] = None) -> str:
    """The next ID for a new asset or peripheral of this type."""
    code = code_for_type(db, type_name, register_key, chosen)
    name = COUNTER_PREFIX + code
    row = db.execute(select(Counter).where(Counter.name == name).with_for_update()).scalar_one_or_none()
    if row is None:
        row = Counter(name=name, next_value=_highest_in_use(db, code) + 1)
        db.add(row)
        db.flush()
    number = row.next_value
    row.next_value = number + 1
    db.flush()
    return format_id(code, number)


def reset_counters(db: Session) -> None:
    """After Clear all data: numbering starts again from 00001."""
    db.query(Counter).filter(Counter.name.like(COUNTER_PREFIX + "%")).delete(synchronize_session=False)
    db.commit()
