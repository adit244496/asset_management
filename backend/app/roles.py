SUPERADMIN = "superadmin"
ADMIN = "admin"
VERIFIER = "verifier"
VIEWER = "viewer"
ASSIGNEE = "assignee"

ALL_ROLES: tuple[str, ...] = (SUPERADMIN, ADMIN, VERIFIER, VIEWER, ASSIGNEE)

LOGIN_ROLES: frozenset[str] = frozenset({SUPERADMIN, ADMIN, VERIFIER, VIEWER})

WRITE_ROLES: frozenset[str] = frozenset({SUPERADMIN, ADMIN})

VERIFY_ROLES: frozenset[str] = frozenset({SUPERADMIN, ADMIN, VERIFIER})

DISCARD_ROLES: frozenset[str] = WRITE_ROLES

EDIT_ROLES: frozenset[str] = WRITE_ROLES | {VERIFIER}

BULK_CREATED_ROLE = ASSIGNEE

ROLE_LABELS = {
    SUPERADMIN: "superadmin",
    ADMIN: "admin",
    VERIFIER: "verifier",
    VIEWER: "viewer",
    ASSIGNEE: "assignee",
}


def is_valid(role: str) -> bool:
    return role in ALL_ROLES


def can_sign_in(role: str) -> bool:
    return role in LOGIN_ROLES


def can_write(role: str) -> bool:
    return role in WRITE_ROLES


def can_verify(role: str) -> bool:
    return role in VERIFY_ROLES


def can_discard(role: str) -> bool:
    return role in DISCARD_ROLES


def can_edit(role: str) -> bool:
    return role in EDIT_ROLES


def role_change_error(current: str, requested: str) -> str | None:
    if requested is None or requested == current:
        return None
    if not is_valid(requested):
        return f"role must be one of: {', '.join(ALL_ROLES)}"
    if current == ASSIGNEE:
        return (
            "An assignee's profile cannot be changed. Assignees are names on "
            "assets rather than accounts; create a new account for this "
            "person instead."
        )
    return None


def superadmin_guard_error(
    actor_role: str,
    target_role: str | None = None,
    requested_role: str | None = None,
) -> str | None:
    if actor_role == SUPERADMIN:
        return None
    if target_role == SUPERADMIN:
        return (
            "Only a superadmin can change a superadmin's account."
        )
    if requested_role == SUPERADMIN:
        return (
            "Only a superadmin can grant the superadmin profile."
        )
    return None

