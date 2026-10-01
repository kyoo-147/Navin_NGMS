#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || fail "Usage: ./navin-mail restore <backup.tar.gz>"
[[ "${NAVIN_MAIL_CONFIRM_RESTORE:-}" == "YES" ]] || fail "Set NAVIN_MAIL_CONFIRM_RESTORE=YES after reviewing the archive"
[[ -f "$archive.sha256" ]] || fail "Missing checksum: $archive.sha256"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive.sha256")")

tmp="$(mktemp -d "$ROOT_DIR/.restore.XXXXXX")"
rollback="$(mktemp -d "$ROOT_DIR/.pre-restore.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  fail "Archive contains an unsafe path"
fi
tar -C "$tmp" -xzf "$archive"
[[ -f "$tmp/compose.yaml" && -f "$tmp/.env" && -d "$tmp/data/stalwart" ]] || fail "Archive is missing required deployment data"

compose down
for item in data state credentials.env compose.yaml .env; do
  [[ -e "$ROOT_DIR/$item" ]] && mv "$ROOT_DIR/$item" "$rollback/$item"
  [[ -e "$tmp/$item" ]] && mv "$tmp/$item" "$ROOT_DIR/$item"
done

if compose up -d && sleep 8 && compose ps --status running --services | grep -qx stalwart \
  && compose ps --status running --services | grep -qx snappymail; then
  rm -rf "$rollback"
  trap - EXIT
  rm -rf "$tmp"
  "$ROOT_DIR/scripts/doctor.sh" || true
  pass "Restore completed and both services restarted"
else
  warn "Restore failed; rolling back the pre-restore deployment"
  compose down >/dev/null 2>&1 || true
  for item in data state credentials.env compose.yaml .env; do
    rm -rf "$ROOT_DIR/$item"
    [[ -e "$rollback/$item" ]] && mv "$rollback/$item" "$ROOT_DIR/$item"
  done
  compose up -d >/dev/null 2>&1 || true
  fail "Restore failed and rollback was attempted"
fi
