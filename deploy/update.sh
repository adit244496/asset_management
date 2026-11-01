#!/usr/bin/env bash
# Releases the latest code: pulls, builds, backs up the database, restarts.
# The backup comes before the restart because every API start can change the schema.
#
#   sudo env "PATH=$PATH" bash deploy/update.sh
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_root
[ -f "$SETTINGS_FILE" ] || die "$SETTINGS_FILE is missing: run deploy/install.sh first."
source "$SETTINGS_FILE"

# Restart this script after pulling, so a release always runs its own update.sh.
if [ "${1:-}" != --pulled ]; then
    step "Pulling the latest code"
    as_app_user git -C "$ROOT" pull --ff-only
    exec bash "$ROOT/deploy/update.sh" --pulled
fi

step "Building the frontend"
build_frontend

step "Backing up the database"
systemctl start "$BACKUP_SERVICE.service"

step "Restarting"
install_backend
systemctl restart "$API_SERVICE"
wait_healthy "$API_PORT"
publish_frontend
check_public "$SERVER_NAME"

printf '\nUpdate complete.\n'
