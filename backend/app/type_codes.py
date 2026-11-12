"""Asset and peripheral IDs built from the type's abbreviation.

New assets and peripherals are numbered <CODE>_<running number>, e.g.
LAP_00001, LAP_00002, MOU_00001: the abbreviation of their Asset Type and a
running number of at least five digits that each abbreviation counts on its
own (shared by both registers, so an ID is never used twice).

* Every Asset Type has an abbreviation (`asset_types.code`), unique across
  the list and editable on Master Data. A new type gets one automatically:
  the known ones below, otherwise its first three letters; on a clash a
  number is added (DES, DES1, DES2 ...).
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

CODE_MAX = 8
CODE_RE = re.compile(rf"^[A-Z][A-Z0-9]{{1,{CODE_MAX - 1}}}$")
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
        return (f"The abbreviation must be 2 to {CODE_MAX} letters or digits, starting with a "
                "letter (e.g. LAP, HDD, DES1).")
    return None


def base_code(name: str) -> str:
    key = " ".join(str(name or "").lower().split())
    if key in KNOWN_CODES:
        return KNOWN_CODES[key]
    letters = re.sub(r"[^A-Za-z]", "", str(name or "")).upper()
    if len(letters) >= 3:
        return letters[:3]
    # Short or mostly-digit names ("PC", "3D printer"): still a valid code.
    alnum = clean_code(name)
    if not alnum:
        return "TYP"
    if not alnum[0].isalpha():
        alnum = "T" + alnum
    return alnum[:3] if len(alnum) >= 2 else alnum + "X"


def suggest_code(name: str, taken: Iterable[str]) -> str:
    """The type's abbreviation, numbered past any already in use (DES -> DES1)."""
    used = {str(c).upper() for c in taken if c}
    base = base_code(name)
    if base not in used:
        return base
    n = 1
    while f"{base}{n}" in used:
        n += 1
    return f"{base}{n}"


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


def _fill_new_types(session: Session, flush_context, instances) -> None:
    """Every new Asset Type gets an abbreviation, however it is added (Master
    Data, bulk add, workbook upload, a bulk import naming a new type)."""
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
    """Startup: give every Asset Type without an abbreviation one (oldest
    first, so the first DES-type keeps DES), then make abbreviations unique
    in the database. Returns [(type, code)] assigned."""
    rows = db.execute(select(AssetType).order_by(AssetType.sort_order, AssetType.created_at,
                                                 AssetType.name)).scalars().all()
    used = {r.code.upper() for r in rows if r.code}
    assigned = []
    for row in rows:
        if row.code:
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


def code_for_type(db: Session, type_name: str) -> str:
    """The abbreviation of this type, adding the type to Master Data if it
    is not there yet (as saving the record would anyway)."""
    row = type_row(db, type_name)
    if row is None:
        from app.masters import MASTERS
        from app import crud
        spec = MASTERS["type"]
        row = spec.new_row(name=(type_name or "").strip(), description=None,
                           sort_order=crud._next_sort_order(db, spec), is_active=True)
        db.add(row)
        db.flush()  # _fill_new_types gives it its abbreviation
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


def next_id(db: Session, type_name: str) -> str:
    """The next ID for a new asset or peripheral of this type."""
    code = code_for_type(db, type_name)
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
