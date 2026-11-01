"""Nightly database backup: a pg_dump of the whole database, kept N days.

    .venv\\Scripts\\python.exe scripts\\backup_db.py --out D:\\backups\\asset-management [--keep 30]

Reads DATABASE_URL from backend/.env, so the password is never on a command
line or in a scheduled task's definition (it reaches pg_dump through
PGPASSWORD, in this process's environment only). Writes
asset_management-YYYY-MM-DD_HHMMSS.dump in pg_dump's custom format -- every
table: the registers, each record's history, users (password hashes
included), master data, settings and the Activity Log. The emailed data
export is NOT a backup: it carries CSVs, without history, accounts or
settings, and cannot be restored.

Then deletes this script's own dumps older than --keep days, and exits
non-zero on any failure, so the scheduled task shows as failed.

Restore (into an EMPTY database -- test this, a backup never restored is a
hope, not a plan):
    createdb -U postgres asset_management_restore
    pg_restore -U postgres -d asset_management_restore --no-owner <file>.dump

Schedule (Task Scheduler, daily, "Run whether user is logged on or not"):
    Program:   E:\\asset-management-it\\backend\\.venv\\Scripts\\python.exe
    Arguments: scripts\\backup_db.py --out D:\\backups\\asset-management --keep 30
    Start in:  E:\\asset-management-it\\backend
Put --out on a different disk, and copy it off this machine too: a backup on
the same disk as the database goes with it.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parent.parent


def find_pg_dump(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("pg_dump")
    if found:
        return found
    for root in sorted(Path(r"C:\Program Files\PostgreSQL").glob("*/bin/pg_dump.exe"), reverse=True):
        return str(root)
    sys.exit("pg_dump not found: install the PostgreSQL client tools or pass --pg-dump.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True, help="folder for the dumps (another disk)")
    ap.add_argument("--keep", type=int, default=30, help="days of dumps to keep (default 30)")
    ap.add_argument("--pg-dump", help="path to pg_dump.exe, if not found automatically")
    args = ap.parse_args()

    raw = dotenv_values(BACKEND / ".env").get("DATABASE_URL") or os.getenv("DATABASE_URL")
    if not raw:
        sys.exit("DATABASE_URL is not set in backend/.env.")
    url = make_url(raw)
    if not url.drivername.startswith("postgresql"):
        sys.exit(f"Only PostgreSQL is backed up by this script, not {url.drivername}.")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{url.database}-{datetime.now():%Y-%m-%d_%H%M%S}.dump"
    env = dict(os.environ, PGPASSWORD=url.password or "")
    cmd = [find_pg_dump(args.pg_dump), "--format=custom", "--no-owner",
           "--host", url.host or "localhost", "--port", str(url.port or 5432),
           "--username", url.username or "postgres", "--file", str(target), url.database]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        sys.exit(f"pg_dump failed ({result.returncode}): {result.stderr.strip()[:500]}")
    print(f"Backed up {url.database} to {target} ({target.stat().st_size // 1024} KB)")

    cutoff = time.time() - args.keep * 86400
    for old in out.glob(f"{url.database}-*.dump"):
        if old.stat().st_mtime < cutoff:
            old.unlink()
            print(f"Removed {old.name} (older than {args.keep} days)")


if __name__ == "__main__":
    main()

