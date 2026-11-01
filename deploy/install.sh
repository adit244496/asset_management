#!/usr/bin/env bash
# Installs the IT Asset Engine on Ubuntu. Safe to run again.
#
#   sudo env "PATH=$PATH" bash deploy/install.sh \
#       --server-name itassets.company.local \
#       --cert /etc/ssl/certs/itassets.crt --key /etc/ssl/private/itassets.key
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SERVER_NAME='' CERT_FILE='' KEY_FILE=''
API_PORT=8018
BACKUP_DIR=/var/backups/asset-management

while [ $# -gt 0 ]; do
    case "$1" in
        --server-name) SERVER_NAME="$2"; shift 2 ;;
        --cert) CERT_FILE="$2"; shift 2 ;;
        --key) KEY_FILE="$2"; shift 2 ;;
        --api-port) API_PORT="$2"; shift 2 ;;
        --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
        *) die "Unknown option: $1" ;;
    esac
done
[ -n "$SERVER_NAME" ] && [ -n "$CERT_FILE" ] && [ -n "$KEY_FILE" ] \
    || die "--server-name, --cert and --key are required."

NGINX_AVAILABLE=/etc/nginx/sites-available/asset-management
NGINX_ENABLED=/etc/nginx/sites-enabled/asset-management
ENV_FILE="$BACKEND/.env"

port_owner() { ss -tlnpH "( sport = :$1 )" | head -1; }

step "Checking the server"
require_root
[ -f "$CERT_FILE" ] || die "Certificate not found: $CERT_FILE"
[ -f "$KEY_FILE" ] || die "Key not found: $KEY_FILE"
for tool in python3 npm nginx psql pg_dump curl git; do
    command -v "$tool" >/dev/null || die "$tool is not installed."
done
# Not grep -q: it exits early, and pipefail then reports nginx's broken pipe as failure.
nginx -T 2>/dev/null | grep 'include /etc/nginx/sites-enabled/\*' >/dev/null \
    || die "This nginx does not load /etc/nginx/sites-enabled/."
# On a re-run this port is ours; on a first run anything there is someone else's.
if ! systemctl is-active --quiet "$API_SERVICE" && [ -n "$(port_owner "$API_PORT")" ]; then
    die "Port $API_PORT is already in use: $(port_owner "$API_PORT")"
fi

step "Checking backend/.env"
if [ ! -f "$ENV_FILE" ]; then
    secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    sed "s/^SECRET_KEY=\$/SECRET_KEY=$secret/" "$ROOT/deploy/backend.env.production" > "$ENV_FILE"
    echo "Created $ENV_FILE with a new SECRET_KEY."
fi
chown "$APP_USER": "$ENV_FILE"
chmod 600 "$ENV_FILE"
# Settings only: the template's header comment mentions CHANGE_ME too.
if grep -q '^[^#]*CHANGE_ME' "$ENV_FILE"; then
    printf '\nReplace every CHANGE_ME in %s, then run this script again.\n' "$ENV_FILE"
    exit 1
fi

step "Installing the backend"
if ! python3 -c 'import ensurepip' 2>/dev/null; then
    apt-get install -y python3-venv
fi
[ -x "$VENV_PYTHON" ] || as_app_user python3 -m venv "$BACKEND/.venv"
install_backend

step "Building the frontend"
build_frontend
publish_frontend

step "Installing the services"
install -d -o "$APP_USER" -g "$(id -gn "$APP_USER")" -m 750 "$BACKUP_DIR"

cat > "$SETTINGS_FILE" <<EOF
SERVER_NAME=$SERVER_NAME
API_PORT=$API_PORT
EOF

cat > "/etc/systemd/system/$API_SERVICE.service" <<EOF
[Unit]
Description=IT Asset Engine API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$ROOT
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV_PYTHON $ROOT/deploy/serve.py --port $API_PORT
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/$BACKUP_SERVICE.service" <<EOF
[Unit]
Description=IT Asset Engine database backup
After=postgresql.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$BACKEND
ExecStart=$VENV_PYTHON scripts/backup_db.py --out $BACKUP_DIR --keep 30
EOF

cat > "/etc/systemd/system/$BACKUP_SERVICE.timer" <<EOF
[Unit]
Description=Nightly IT Asset Engine database backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --quiet "$API_SERVICE" "$BACKUP_SERVICE.timer"
systemctl restart "$API_SERVICE"
systemctl start "$BACKUP_SERVICE.timer"
wait_healthy "$API_PORT"

step "Adding the nginx site"
# Other sites share this nginx, and one bad file stops all of them at their next
# reload. So a config that fails the test is taken straight back out.
previous=''
if [ -f "$NGINX_AVAILABLE" ]; then
    previous="$(mktemp)"
    cp "$NGINX_AVAILABLE" "$previous"
fi
was_enabled=''
[ -e "$NGINX_ENABLED" ] && was_enabled=yes

sed -e "s|@@SERVER_NAME@@|$SERVER_NAME|g" \
    -e "s|@@API_PORT@@|$API_PORT|g" \
    -e "s|@@CERT_FILE@@|$CERT_FILE|g" \
    -e "s|@@KEY_FILE@@|$KEY_FILE|g" \
    -e "s|@@SITE_DIR@@|$SITE_DIR|g" \
    "$ROOT/deploy/nginx.conf.template" > "$NGINX_AVAILABLE"
ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"

if ! nginx -t; then
    if [ -n "$previous" ]; then cp "$previous" "$NGINX_AVAILABLE"; else rm -f "$NGINX_AVAILABLE"; fi
    [ -n "$was_enabled" ] || rm -f "$NGINX_ENABLED"
    die "nginx rejected the new site, so it was removed. Other sites were not affected."
fi
[ -n "$previous" ] && rm -f "$previous"
# reload, never restart: the other sites keep serving throughout.
systemctl reload nginx
sleep 2
check_public "$SERVER_NAME"

printf '\nInstalled: https://%s\n' "$SERVER_NAME"
