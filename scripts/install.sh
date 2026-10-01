#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
require_env
require_command docker

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
"$SCRIPT_DIR/preflight.sh"

install -d -m 750 "$ROOT_DIR/data/stalwart/etc" "$ROOT_DIR/data/stalwart/lib" "$ROOT_DIR/data/snappymail" "$ROOT_DIR/backups" "$ROOT_DIR/state"
# Stalwart's production image runs as UID/GID 2000.
chown -R 2000:2000 "$ROOT_DIR/data/stalwart/etc" "$ROOT_DIR/data/stalwart/lib"

info "Pulling pinned images"
compose pull
info "Starting Navin Mail"
compose up -d
compose ps
pass "Services started. Continue with Stalwart bootstrap before DNS cutover."
