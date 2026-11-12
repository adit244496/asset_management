"""Software Serial Numbers (licence keys) are shown masked: XXXX.

The real value never leaves the server in a list, a record, Verification,
search results, History, the Activity Log, the History export, emails, QR
labels or the assistant. A profile allowed under Admin controls reveals one
key at a time with the eye button (POST /api/softwares/<id>/serial), and
every reveal is written to the Activity Log. A superadmin always may.

Kept real on purpose: the stored value and its change history (so the
audit trail is intact), and the superadmin data export -- it is the backup
of the register, and a masked backup could not restore the keys.

Assets and peripherals are not affected: their serial numbers stay visible.
"""
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from app import roles
from app.models import AccessSettings, Software

MASK = "XXXX"
SOFTWARE_KEY = "software"
SERIAL_FIELD = "srl"

# Profiles a superadmin can allow (assignees cannot sign in).
CHOICES = (roles.SUPERADMIN, roles.ADMIN, roles.VERIFIER, roles.VIEWER)
DEFAULT_ROLES = (roles.SUPERADMIN,)


def is_mask(value: Any) -> bool:
    return str(value or "").strip().upper() == MASK


def shown(item, reveal: bool = False) -> Optional[str]:
    """The serial number as it may be shown: masked for a software."""
    value = getattr(item, "srl", None)
    if value and isinstance(item, Software) and not reveal:
        return MASK
    return value


def shown_dict_value(register_key: Optional[str], value: Any) -> Any:
    """For a dict that only knows its register key ('software', ...)."""
    return MASK if value and register_key == SOFTWARE_KEY else value


def shown_event_value(register_key: Optional[str], field: Optional[str], value: Any) -> Any:
    """A history value: masked when it is a software's serial number."""
    if value and register_key == SOFTWARE_KEY and field == SERIAL_FIELD:
        return MASK
    return value


def drop_mask(data: dict) -> bool:
    """A masked XXXX sent back from a form or a re-uploaded export means "no
    change" -- never store it as the serial. Returns True when one was dropped."""
    if isinstance(data, dict) and is_mask(data.get(SERIAL_FIELD)):
        data.pop(SERIAL_FIELD, None)
        return True
    return False


def _row(db: Session) -> AccessSettings:
    row = db.get(AccessSettings, 1)
    if row is None:
        row = AccessSettings(id=1, software_serial_roles=",".join(DEFAULT_ROLES))
        db.add(row)
        db.commit()
    return row


def reveal_roles(db: Session) -> list[str]:
    saved = {r.strip() for r in (_row(db).software_serial_roles or "").split(",") if r.strip()}
    saved.add(roles.SUPERADMIN)
    return [r for r in CHOICES if r in saved]


def can_reveal(db: Session, role: str) -> bool:
    return role == roles.SUPERADMIN or role in reveal_roles(db)


def set_reveal_roles(db: Session, wanted: Iterable[str], username: str) -> tuple[list[str], Optional[str]]:
    wanted = [str(r).strip().lower() for r in (wanted or [])]
    unknown = [r for r in wanted if r not in CHOICES]
    if unknown:
        return [], f"Unknown profile: {', '.join(unknown)}. Choose from {', '.join(CHOICES)}."
    keep = [r for r in CHOICES if r in set(wanted) | {roles.SUPERADMIN}]
    row = _row(db)
    row.software_serial_roles = ",".join(keep)
    row.updated_by = username
    db.commit()
    return keep, None


def settings_dict(db: Session) -> dict:
    row = _row(db)
    return {
        "softwareSerialRoles": reveal_roles(db),
        "choices": list(CHOICES),
        "alwaysAllowed": [roles.SUPERADMIN],
        "updatedBy": row.updated_by,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }
