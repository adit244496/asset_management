"""Production entry point: runs the API under waitress, on loopback only.

    backend/.venv/bin/python deploy/serve.py --port 8019

Started by the asset-management-api systemd service (see install.sh).
"""
import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8019)
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()

    from waitress import serve

    from app.main import app

    serve(
        app,
        host="127.0.0.1",
        port=args.port,
        threads=args.threads,
        # nginx on this machine is the only caller; believing its headers makes
        # the Activity Log record each visitor's address instead of 127.0.0.1.
        trusted_proxy="127.0.0.1",
        trusted_proxy_headers={"x-forwarded-for", "x-forwarded-proto"},
    )


if __name__ == "__main__":
    main()
