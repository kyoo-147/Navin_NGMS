#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

"$ROOT_DIR/scripts/backup.sh"
old_ids="$(compose images -q | sort)"
compose pull
compose up -d --remove-orphans
sleep 10
if "$ROOT_DIR/scripts/doctor.sh"; then
  pass "Update verified"
else
  warn "Update health verification failed. Images remain pinned by .env; inspect logs before rollback."
  printf 'Previous image IDs:\n%s\n' "$old_ids"
  exit 1
fi
