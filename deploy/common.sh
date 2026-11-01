# Shared by install.sh and update.sh. Sourced, not run.

API_SERVICE=asset-management-api
BACKUP_SERVICE=asset-management-backup
SITE_DIR=/var/www/asset-management
SETTINGS_FILE=/etc/default/asset-management

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PYTHON="$BACKEND/.venv/bin/python"

step() { printf '\n== %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die 'Run with: sudo env "PATH=$PATH" bash deploy/<script>.sh'
    APP_USER="${SUDO_USER:-}"
    [ -n "$APP_USER" ] && [ "$APP_USER" != root ] \
        || die "Run through sudo from the account that owns the code, not as root directly."
    [ "$(stat -c %U "$ROOT")" = "$APP_USER" ] \
        || die "$ROOT is not owned by $APP_USER."
    # sudo drops nvm's directory from PATH unless it is passed through.
    command -v npm >/dev/null \
        || die 'npm not found. Run with: sudo env "PATH=$PATH" bash deploy/<script>.sh'
}

# Builds and git run as the code's owner, so nothing in the checkout becomes root's.
as_app_user() { sudo -u "$APP_USER" -H env "PATH=$PATH" "$@"; }

install_backend() {
    as_app_user "$VENV_PYTHON" -m pip install --quiet --disable-pip-version-check \
        -r "$BACKEND/requirements.txt"
}

build_frontend() {
    (cd "$FRONTEND" && as_app_user npm ci --no-audit --no-fund && as_app_user npm run build)
}

# nginx cannot read inside a home directory, so the bundle is copied out. The
# swap is a rename, so visitors never see a half-copied site.
publish_frontend() {
    local fresh="$SITE_DIR.new" old="$SITE_DIR.old"
    rm -rf "$fresh" "$old"
    cp -r "$FRONTEND/dist" "$fresh"
    chown -R root:root "$fresh"
    chmod -R a+rX "$fresh"
    [ -d "$SITE_DIR" ] && mv "$SITE_DIR" "$old"
    mv "$fresh" "$SITE_DIR"
    rm -rf "$old"
}

wait_healthy() {
    local api_port="$1" attempts=40
    while [ "$attempts" -gt 0 ]; do
        if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$api_port/api/health"; then
            echo "API is healthy."
            return 0
        fi
        attempts=$((attempts - 1))
        sleep 3
    done
    journalctl -u "$API_SERVICE" -n 30 --no-pager || true
    die "The API did not become healthy. See: journalctl -u $API_SERVICE"
}

check_public() {
    local name="$1"
    # --resolve sends the real name, so nginx picks this site rather than its
    # default one. -k: this checks that it answers, not the certificate.
    local curl_site=(curl -kfsS -o /dev/null --max-time 10 --resolve "$name:443:127.0.0.1")
    "${curl_site[@]}" "https://$name/" \
        || die "The site did not answer. See /var/log/nginx/asset-management-error.log"
    "${curl_site[@]}" "https://$name/api/health" \
        || die "nginx did not reach the API."
    echo "Site is answering at https://$name"
}
