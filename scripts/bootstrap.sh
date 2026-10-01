#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
load_credentials

output_file="$ROOT_DIR/state/bootstrap-result.txt"
install -d -m 700 "$ROOT_DIR/state"
umask 077

info "Completing Stalwart bootstrap for $DOMAIN"
if ! stalwart_cli update Bootstrap \
  --field "serverHostname=$MAIL_HOSTNAME" \
  --field "defaultDomain=$DOMAIN" \
  --field requestTlsCertificate=false \
  --field generateDkimKeys=true \
  --field 'dataStore={"@type":"RocksDb","path":"/var/lib/stalwart/","blobSize":16834,"bufferSize":134217728,"cacheSize":134217728,"poolWorkers":null}' \
  --field 'blobStore={"@type":"Default"}' \
  --field 'searchStore={"@type":"Default"}' \
  --field 'inMemoryStore={"@type":"Default"}' \
  --field 'directory={"@type":"Internal"}' \
  --field 'dnsServer={"@type":"Manual"}' \
  --field 'tracer={"@type":"Stdout","ansi":false,"buffered":false,"enable":true,"events":{},"eventsPolicy":"exclude","level":"info","lossy":false,"multiline":false}' \
  >"$output_file" 2>&1; then
  sed -E 's/(password|secret|token).*/\1 [REDACTED]/Ig' "$output_file" >&2
  fail "Stalwart bootstrap failed"
fi
chmod 600 "$output_file"

new_user="$(sed -nE 's/^[[:space:]]*(Username|Administrator)[[:space:]]*:[[:space:]]*(.+)[[:space:]]*$/\2/ip' "$output_file" | tail -1)"
new_password="$(sed -nE 's/^[[:space:]]*(Password|Secret)[[:space:]]*:[[:space:]]*(.+)[[:space:]]*$/\2/ip' "$output_file" | tail -1)"
new_user="${new_user%$'\r'}"
new_password="${new_password%$'\r'}"
new_user="${new_user#\"}"; new_user="${new_user%\"}"
new_password="${new_password#\"}"; new_password="${new_password%\"}"

if [[ -z "$new_user" || -z "$new_password" ]]; then
  sed -E 's/(password|secret|token).*/\1 [REDACTED]/Ig' "$output_file" >&2
  fail "Bootstrap completed but permanent credentials could not be captured; retained root-only output at $output_file"
fi

{
  printf 'STALWART_URL=http://stalwart:8080\n'
  printf 'STALWART_USER=%q\n' "$new_user"
  printf 'STALWART_PASSWORD=%q\n' "$new_password"
} >"$CREDENTIALS_FILE"
chmod 600 "$CREDENTIALS_FILE"
rm -f "$output_file"
pass "Stalwart bootstrap complete for $DOMAIN; permanent credentials stored root-only"
