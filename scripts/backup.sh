#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
require_command tar

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$ROOT_DIR/backups/navin-mail-$stamp.tar.gz"
was_running=0
if compose ps --status running --services 2>/dev/null | grep -qx stalwart; then was_running=1; fi

cleanup() {
  if (( was_running == 1 )); then compose start stalwart >/dev/null || true; fi
}
trap cleanup EXIT

info "Stopping Stalwart for a consistent embedded-database backup"
if (( was_running == 1 )); then compose stop -t 60 stalwart; fi

items=(compose.yaml .env data)
[[ -f "$ROOT_DIR/credentials.env" ]] && items+=(credentials.env)
[[ -d "$ROOT_DIR/state" ]] && items+=(state)
tar -C "$ROOT_DIR" -czf "$archive" "${items[@]}"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"

if (( was_running == 1 )); then compose start stalwart >/dev/null; was_running=0; fi
trap - EXIT
find "$ROOT_DIR/backups" -type f -mtime "+${BACKUP_RETENTION_DAYS:-7}" -delete
pass "Backup created: $archive"
warn "Copy this backup and checksum offsite; a same-disk backup is not disaster recovery"
