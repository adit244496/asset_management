import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import logging
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.database import Base, SessionLocal, engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app.main")


def ensure_database_exists() -> None:
    url = make_url(settings.DATABASE_URL)
    if not url.get_backend_name().startswith("postgresql"):
        return

    try:
        with engine.connect():
            return
    except DBAPIError as exc:
        detail = str(exc).lower()
        if "does not exist" not in detail and "3d000" not in detail:
            raise

    logger.warning("Database %r does not exist yet -- creating it.", url.database)
    admin_engine = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Could not create database {url.database!r}. Create it by hand and start again:\n"
            f'  psql -U {url.username} -h {url.host} -c \'CREATE DATABASE "{url.database}";\''
        ) from exc
    finally:
        admin_engine.dispose()
    logger.warning("Created database %r.", url.database)


_ASSET_COLUMN_PATCHES = [
    ("asset_id", "VARCHAR(20)",
     "CREATE UNIQUE INDEX IF NOT EXISTS ix_assets_asset_id ON assets (asset_id)"),
    ("make", "VARCHAR(100)", None),
    ("availability", "VARCHAR(20)", None),
    ("service_tag", "VARCHAR(100)",
     "CREATE INDEX IF NOT EXISTS ix_assets_service_tag ON assets (service_tag)"),
    ("is_deleted", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("previous_status", "VARCHAR(50)", None),
    ("warranty_end", "VARCHAR(20)", None),
    ("sap_id", "VARCHAR(50)",
     "CREATE INDEX IF NOT EXISTS ix_assets_sap_id ON assets (sap_id)"),
    ("verification", "VARCHAR(20) NOT NULL DEFAULT 'verified'",
     "CREATE INDEX IF NOT EXISTS ix_assets_verification ON assets (verification)"),
    ("verified_by", "VARCHAR(150)", None),
    ("verified_at", "TIMESTAMP WITH TIME ZONE", None),
    ("verification_note", "VARCHAR(500)", None),
    ("insurance_end", "VARCHAR(20)", None),
    ("assign_count", "INTEGER NOT NULL DEFAULT 0", None),
    ("assigned_date", "VARCHAR(20)", None),
]

_USER_COLUMN_PATCHES = [
    ("must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("email", "VARCHAR(255)", None),
    ("location", "VARCHAR(255)", None),
    ("date_of_joining", "VARCHAR(20)", None),
]


_NOTIFY_COLUMN_PATCHES = [
    ("hr_email", "VARCHAR(255)", None),
    ("joiner_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("joiner_days", "INTEGER NOT NULL DEFAULT 7", None),
    ("transfer_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("registration_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("verification_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("renewal_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("renewal_time", "VARCHAR(5) NOT NULL DEFAULT '09:00'", None),
    ("last_renewal_on", "VARCHAR(10)", None),
    ("export_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ("export_recipients", "VARCHAR(1000)", None),
    ("export_interval_days", "INTEGER NOT NULL DEFAULT 7", None),
    ("export_time", "VARCHAR(5) NOT NULL DEFAULT '09:00'", None),
    ("last_export_on", "VARCHAR(10)", None),
    ("last_export_try_on", "VARCHAR(10)", None),
    ("export_clear_activity", "BOOLEAN NOT NULL DEFAULT TRUE", None),
    ("activity_cleared_at", "VARCHAR(40)", None),
]


def _add_missing_columns(table: str, patches) -> list[str]:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return []

    existing = {col["name"] for col in inspector.get_columns(table)}
    added = []
    for name, ddl_type, index_ddl in patches:
        if name in existing:
            continue
        logger.warning("Adding missing column %s.%s", table, name)
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl_type}"))
            if index_ddl:
                conn.execute(text(index_ddl))
        added.append(name)
    return added


_EVENT_COLUMN_PATCHES = [
    ("register", "VARCHAR(20) NOT NULL DEFAULT 'asset'",
     "CREATE INDEX IF NOT EXISTS ix_asset_events_register ON asset_events (register)"),
]


def ensure_asset_columns() -> None:
    from app.registers import ALL as ALL_REGISTERS

    added = {reg: _add_missing_columns(reg.table, _register_column_patches(reg))
             for reg in ALL_REGISTERS}
    users_added = _add_missing_columns("users", _USER_COLUMN_PATCHES)
    _add_missing_columns("notification_settings", _NOTIFY_COLUMN_PATCHES)
    _add_missing_columns("asset_events", _EVENT_COLUMN_PATCHES)
    _add_missing_columns("asset_types", _ASSET_TYPE_COLUMN_PATCHES)

    from app import crud
    for reg, names in added.items():
        if "assign_count" in names:
            with SessionLocal() as db:
                filled = crud.backfill_assign_counts(db, reg)
            logger.warning("Set the assignment count of %d existing %s from their history.",
                           filled, reg.plural)
        if "assigned_date" in names:
            with SessionLocal() as db:
                filled = crud.backfill_assigned_dates(db, reg)
            logger.warning("Set the Assigned Date of %d existing %s from recorded hand-overs.",
                           filled, reg.plural)

    if "date_of_joining" in users_added:
        with SessionLocal() as db:
            moved = crud.move_joining_dates_to_users(db)
        logger.warning("Moved Date of Joining onto %d user records (%d register values "
                       "named nobody with an account).", moved["people"], moved["unmatched"])


def migrate_peripheral_links() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "peripherals" not in tables or "peripheral_links" not in tables:
        return
    if "linked_asset_id" not in {c["name"] for c in inspector.get_columns("peripherals")}:
        return

    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT id, linked_asset_id FROM peripherals WHERE linked_asset_id IS NOT NULL"
        )).all()
        for peripheral_id, asset_id in rows:
            existing = conn.execute(text(
                "SELECT 1 FROM peripheral_links "
                "WHERE peripheral_id = :p AND asset_id = :a"
            ), {"p": peripheral_id, "a": asset_id}).first()
            if existing:
                continue
            conn.execute(text(
                "INSERT INTO peripheral_links (id, peripheral_id, asset_id, created_at) "
                "VALUES (:id, :p, :a, :at)"
            ), {"id": str(uuid.uuid4()), "p": peripheral_id, "a": asset_id, "at": datetime.now(timezone.utc)})

        conn.execute(text("DROP INDEX IF EXISTS ix_peripherals_linked_asset_id"))

        conn.execute(text("ALTER TABLE peripherals DROP COLUMN linked_asset_id"))

    logger.warning(
        "Moved %d peripheral link(s) into peripheral_links and dropped "
        "peripherals.linked_asset_id.", len(rows)
    )


def migrate_user_roles() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    with engine.begin() as conn:
        legacy = conn.execute(text(
            "SELECT COUNT(*) FROM users WHERE role = 'user'"
        )).scalar_one()
        if not legacy:
            return
        conn.execute(text("UPDATE users SET role = 'assignee' WHERE role = 'user'"))

    logger.warning(
        "Moved %d account(s) from the retired `user` role to `assignee`; "
        "they can no longer sign in. Give anyone who needs access a viewer, "
        "admin or superadmin account.", legacy,
    )


def drop_sub_location() -> None:
    from app.registers import ALL as ALL_REGISTERS

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    for reg in ALL_REGISTERS:
        if reg.table not in tables:
            continue
        if "sub_location" not in {c["name"] for c in inspector.get_columns(reg.table)}:
            continue
        with engine.begin() as conn:
            held = conn.execute(text(
                f"SELECT COUNT(*) FROM {reg.table} "
                "WHERE sub_location IS NOT NULL AND TRIM(sub_location) <> ''"
            )).scalar_one()
            conn.execute(text(f"ALTER TABLE {reg.table} DROP COLUMN sub_location"))
        logger.warning(
            "Dropped %s.sub_location (the field is retired); %d row(s) held a value.",
            reg.table, held,
        )


_REGISTER_EXTRA_PATCHES: dict[str, list] = {}

_ASSET_TYPE_COLUMN_PATCHES = [
    ("is_shared", "BOOLEAN NOT NULL DEFAULT FALSE", None),
]


def _register_column_patches(register):
    shared = [
        (name, ddl_type,
         index_ddl.replace("ix_assets_", f"ix_{register.table}_").replace(
             " ON assets ", f" ON {register.table} ") if index_ddl else None)
        for name, ddl_type, index_ddl in _ASSET_COLUMN_PATCHES
    ]
    return shared + _REGISTER_EXTRA_PATCHES.get(register.table, [])


def ensure_register_column_order() -> None:
    from app.registers import ALL as ALL_REGISTERS

    for reg in ALL_REGISTERS:
        _rebuild_column_order(reg.table, reg.model)


def _rebuild_column_order(table: str, model) -> None:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return

    actual = [col["name"] for col in inspector.get_columns(table)]
    wanted = [col.name for col in model.__table__.columns]
    if actual == wanted:
        return
    if sorted(actual) != sorted(wanted):
        logger.warning(
            "%s has unexpected columns (%s) -- leaving its column order alone.",
            table, sorted(set(actual) ^ set(wanted)),
        )
        return

    legacy = f"{table}_column_order_backup"
    if legacy in inspector.get_table_names():
        logger.warning(
            "%s already exists -- a previous rebuild left it behind. "
            "Drop it by hand to let the column order be fixed.", legacy
        )
        return

    logger.warning("Rebuilding `%s` to put its columns in the model's order.", table)
    index_names = [idx["name"] for idx in inspector.get_indexes(table)]
    pk_name = (inspector.get_pk_constraint(table) or {}).get("name")
    columns = ", ".join(f'"{name}"' for name in wanted)

    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} RENAME TO {legacy}"))
        for name in index_names:
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
        if pk_name and engine.dialect.name == "postgresql":
            conn.execute(
                text(f'ALTER TABLE {legacy} RENAME CONSTRAINT "{pk_name}" TO "{legacy}_pkey"')
            )

        model.__table__.create(bind=conn)
        conn.execute(text(f"INSERT INTO {table} ({columns}) SELECT {columns} FROM {legacy}"))
        conn.execute(text(f"DROP TABLE {legacy}"))

    logger.warning("Rebuilt `%s`; column order now matches the model.", table)


SRL_UNIQUE_INDEX = "ix_assets_srl_unique"


def _srl_unique_ddl(table: str, index: str) -> str:
    return (
        f"CREATE UNIQUE INDEX IF NOT EXISTS {index} ON {table} (lower(trim(srl))) "
        "WHERE srl IS NOT NULL AND trim(srl) <> ''"
    )


def _srl_duplicates_sql(table: str) -> str:
    return (
        f"SELECT lower(trim(srl)) AS key, count(*) AS n FROM {table} "
        "WHERE srl IS NOT NULL AND trim(srl) <> '' "
        "GROUP BY lower(trim(srl)) HAVING count(*) > 1 ORDER BY n DESC"
    )


def srl_index_exists(conn, index: str = SRL_UNIQUE_INDEX) -> bool:
    sql = (
        "SELECT 1 FROM pg_class WHERE relname = :name AND relkind = 'i'"
        if engine.dialect.name == "postgresql"
        else "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :name"
    )
    return conn.execute(text(sql), {"name": index}).first() is not None


def ensure_srl_unique_index() -> None:
    from app.registers import ALL as ALL_REGISTERS

    tables = set(inspect(engine).get_table_names())
    for reg in ALL_REGISTERS:
        if reg.table not in tables:
            continue

        with engine.connect() as conn:
            if srl_index_exists(conn, reg.srl_index):
                continue
            clashes = conn.execute(text(_srl_duplicates_sql(reg.table))).all()

        if clashes:
            rows = sum(n for _, n in clashes)
            logger.warning(
                "Serial numbers are not unique yet: %d serial(s) are shared by %d %s, "
                "so the UNIQUE index (%s) was not created. New duplicates are still refused. "
                "Shared serials: %s",
                len(clashes), rows, reg.plural, reg.srl_index,
                ", ".join(f"{key!r} x{n}" for key, n in clashes[:10])
                + (f", and {len(clashes) - 10} more" if len(clashes) > 10 else ""),
            )
            continue

        with engine.begin() as conn:
            conn.execute(text(_srl_unique_ddl(reg.table, reg.srl_index)))
        logger.warning("Created %s -- %s serial numbers are now unique at the database level.",
                       reg.srl_index, reg.noun)


def _refuse_unsafe_secret_key() -> None:
    from app.core.config import MIN_SECRET_KEY_LENGTH, PLACEHOLDER_SECRET_KEY
    if "pytest" in sys.modules:
        return
    key = settings.SECRET_KEY or ""
    if key == PLACEHOLDER_SECRET_KEY or len(key) < MIN_SECRET_KEY_LENGTH:
        raise RuntimeError(
            "SECRET_KEY is missing, the placeholder, or shorter than "
            f"{MIN_SECRET_KEY_LENGTH} characters. Set a long random value in backend/.env -- "
            'for example the output of: python -c "import secrets; print(secrets.token_hex(32))"')


def create_app() -> Flask:
    import app.models  # noqa: F401  (registers User/Asset/master tables on Base.metadata)
    from app import crud, roles

    _refuse_unsafe_secret_key()
    ensure_database_exists()

    Base.metadata.create_all(bind=engine)

    migrate_peripheral_links()

    ensure_asset_columns()

    drop_sub_location()

    migrate_user_roles()

    ensure_register_column_order()

    ensure_srl_unique_index()

    with SessionLocal() as db:
        if crud.count_users(db) == 0:
            if not settings.ADMIN_PASSWORD:
                raise RuntimeError(
                    "No accounts exist yet and ADMIN_PASSWORD is not set. Set it in backend/.env "
                    "for this first start; each seeded account must replace it at its first sign-in.")
            for username, full_name, role in (
                (settings.ADMIN_USERNAME, settings.ADMIN_FULL_NAME, roles.SUPERADMIN),
                ("admin", "Administrator", roles.ADMIN),
                ("verifier", "Verifier", roles.VERIFIER),
                ("viewer", "Viewer", roles.VIEWER),
            ):
                if crud.find_user_by_username(db, username) is not None:
                    continue
                crud.create_user(
                    db,
                    username=username,
                    password=settings.ADMIN_PASSWORD,
                    full_name=full_name,
                    role=role,
                    must_change_password=True,
                )
            logger.warning(
                "Seeded the accounts %s, admin, verifier and viewer, all on the shared "
                "starting password; each must set its own at its first sign-in.",
                settings.ADMIN_USERNAME,
            )

        crud.seed_masters(db)

        crud.ensure_reserved_statuses(db)

        shared = crud.ensure_shared_types(db, crud.SHARED_TYPE_SEEDS)
        if shared:
            logger.warning(
                "Marked %s as shared peripheral types (several assets at once). "
                "Change this on the Master Data screen.", ", ".join(shared)
            )

        from app.registers import ALL as ALL_REGISTERS

        for reg in ALL_REGISTERS:
            crud.ensure_asset_id_counter(db, reg)
            filled = crud.backfill_asset_ids(db, reg)
            if filled:
                logger.warning("Assigned an ID to %d existing %s.", filled, reg.plural)

            derived = crud.backfill_derived_fields(db, reg)
            if derived:
                logger.warning("Derived availability for %d existing %s.", derived, reg.plural)

            tagged = crud.backfill_service_tags(db, reg)
            if tagged:
                logger.warning("Extracted a service tag for %d existing %s.", tagged, reg.plural)

            sold = crud.strip_sold_to_prefixes(db, reg)
            if sold:
                logger.warning("Stored the buyer's name alone on %d sold %s.", sold, reg.plural)

            moved = crud.compact_asset_ids(db, reg)
            if moved:
                logger.warning("Closed gaps in %s numbering: %d %s renumbered.",
                               reg.id_label, moved, reg.plural)

        for field, count in crud.backfill_user_details(db).items():
            logger.warning("Filled in %s for %d account(s) from the register.",
                           field, count)

    app = Flask(__name__)
    app.config["SECRET_KEY"] = settings.SECRET_KEY

    cors_origins = settings.CORS_ORIGINS.strip()
    if cors_origins:
        origins = "*" if cors_origins == "*" else [o.strip() for o in cors_origins.split(",") if o.strip()]
        CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=False)

    from app import activity
    from app.api.activity import bp as activity_bp
    from app.api.assets import BLUEPRINTS as register_bps
    from app.api.assistant import bp as assistant_bp
    from app.api.auth import bp as auth_bp
    from app.api.data import bp as data_bp
    from app.api.masters import bp as masters_bp
    from app.api.notifications import bp as notifications_bp
    from app.api.users import bp as users_bp
    from app.api.verification import bp as verification_bp

    app.register_blueprint(auth_bp)
    for register_bp in register_bps:
        app.register_blueprint(register_bp)
    app.register_blueprint(masters_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(activity_bp)
    app.register_blueprint(assistant_bp)
    app.register_blueprint(verification_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(data_bp)

    if "pytest" not in sys.modules and os.getenv("DISABLE_SCHEDULER", "").lower() not in ("1", "true", "yes"):
        from app import approvals
        approvals.start_scheduler()

    activity.install(app)

    @app.route("/api/health")
    def health():
        return jsonify({"ok": True})

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=8000)

