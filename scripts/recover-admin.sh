#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
require_command openssl

[[ "$(id -u)" -eq 0 ]] || fail "Run recover-admin as root"
install -d -m 700 "$ROOT_DIR/state"
recovery_password="$(openssl rand -hex 24)"
new_password="$(openssl rand -base64 24 | tr -d '\n')"
recovery_env="$ROOT_DIR/state/recovery.env"
override="$ROOT_DIR/state/recovery.override.yaml"
accounts_json="$ROOT_DIR/state/recovery-accounts.json"

umask 077
printf 'STALWART_RECOVERY_ADMIN=recovery-admin:%s\n' "$recovery_password" >"$recovery_env"
cat >"$override" <<'YAML'
services:
  stalwart:
    environment:
      STALWART_RECOVERY_ADMIN: ${STALWART_RECOVERY_ADMIN}
YAML

info "Starting temporary Stalwart recovery administrator"
(cd "$ROOT_DIR" && docker compose --env-file .env --env-file "$recovery_env" -f compose.yaml -f "$override" up -d --force-recreate stalwart)
sleep 5

{
  printf 'STALWART_URL=http://stalwart:8080\n'
  printf 'STALWART_USER=recovery-admin\n'
  printf 'STALWART_PASSWORD=%q\n' "$recovery_password"
} >"$CREDENTIALS_FILE"
chmod 600 "$CREDENTIALS_FILE"

stalwart_cli query Account --fields id,name,domainId --json >"$accounts_json"
account_id="$(python3 - "$accounts_json" "$DOMAIN" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
domain = sys.argv[2]
if isinstance(value, list):
    rows = value
elif isinstance(value, dict):
    rows = [value] if "id" in value else (value.get("items") or value.get("list") or value.get("data") or [])
else:
    rows = []
for row in rows:
    if row.get("name") in {"admin", f"admin@{domain}"}:
        print(row["id"])
        break
PY
)"
[[ -n "$account_id" ]] || fail "Permanent administrator account was not found; recovery files retained in state/"

stalwart_cli update Account "$account_id" \
  --field "credentials={\"0\":{\"@type\":\"Password\",\"secret\":\"$new_password\"}}" \
  >"$ROOT_DIR/state/recovery-update.txt"

{
  printf 'STALWART_URL=http://stalwart:8080\n'
  printf 'STALWART_USER=admin@%s\n' "$DOMAIN"
  printf 'STALWART_PASSWORD=%q\n' "$new_password"
} >"$CREDENTIALS_FILE"
chmod 600 "$CREDENTIALS_FILE"
stalwart_cli query Account --fields id,name >/dev/null

rm -f "$recovery_env" "$override" "$accounts_json" "$ROOT_DIR/state/recovery-update.txt"
info "Removing temporary recovery administrator"
(cd "$ROOT_DIR" && docker compose up -d --force-recreate stalwart)
sleep 5
stalwart_cli query Account --fields id,name >/dev/null
pass "Permanent Stalwart administrator recovered and verified"
