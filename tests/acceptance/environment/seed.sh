#!/usr/bin/env bash
# Seed the isolated acceptance Stalwart with company.test fixtures:
#   * bootstrap the engine (RocksDb stores, manual DNS, no ACME);
#   * install a locally generated TLS certificate so STARTTLS/IMAP-S work;
#   * create alice@company.test and bob@company.test with generated passwords;
#   * create the team@company.test distribution alias delivering to both;
#   * ensure an authenticated submission listener exists.
#
# Passwords are generated here, written root-only under generated/, and never
# printed. This environment is disposable and never touches production.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# Sourcing this file only defines functions (for test/); main() runs on execute.
DOMAIN_ID=""

emit_summary() {
  python3 - "$STATE_DIR/seed.json" "$DOMAIN" "$MAIL_HOSTNAME" "$ALICE_ADDRESS" "$BOB_ADDRESS" "$ALIAS_ADDRESS" <<'PY'
import json, sys
out, domain, host, alice, bob, alias = sys.argv[1:]
json.dump({
    "domain": domain,
    "mailHostname": host,
    "accounts": [alice, bob],
    "alias": alias,
    "seededAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, open(out, "w", encoding="utf-8"), indent=2)
PY
}

# --- 1. Initial administrator credentials (first boot prints them to logs) -----
ensure_initial_credentials() {
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    return 0
  fi
  local log="$STATE_DIR/stalwart-initial.log"
  docker logs navin-acceptance-stalwart >"$log" 2>&1 || true
  if python3 - "$log" "$CREDENTIALS_FILE" <<'PY'
import re, shlex, sys
from pathlib import Path
log = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
out = Path(sys.argv[2])
user = password = None
m = re.search(r"username\s*:\s*([^\s]+)", log, re.IGNORECASE)
p = re.search(r"password\s*:\s*([^\s]+)", log, re.IGNORECASE)
if m and p:
    user, password = m.group(1).strip("'\""), p.group(1).strip("'\"")
if not (user and password):
    c = re.search(r"administrator account is ['\"]([^'\"]+)['\"] with password ['\"]([^'\"]+)['\"]", log, re.IGNORECASE)
    if c:
        user, password = c.group(1), c.group(2)
if not (user and password):
    sys.exit(3)
out.write_text(
    "STALWART_URL=http://stalwart:8080\n"
    f"STALWART_USER={shlex.quote(user)}\n"
    f"STALWART_PASSWORD={shlex.quote(password)}\n",
    encoding="utf-8",
)
out.chmod(0o600)
PY
  then
    pass "Captured initial administrator credentials from container logs"
  else
    warn "No initial administrator credentials found in logs; continuing (bootstrap may create them)"
  fi
  rm -f "$log"
}

# --- 2. Bootstrap the engine ---------------------------------------------------
bootstrap_stalwart() {
  local output_file="$STATE_DIR/bootstrap-result.txt"
  info "Bootstrapping Stalwart for $DOMAIN"
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

  local new_user new_password
  new_user="$(sed -nE 's/^[[:space:]]*(Username|Administrator)[[:space:]]*:[[:space:]]*(.+)[[:space:]]*$/\2/ip' "$output_file" | tail -1 | tr -d '\r"')"
  new_password="$(sed -nE 's/^[[:space:]]*(Password|Secret)[[:space:]]*:[[:space:]]*(.+)[[:space:]]*$/\2/ip' "$output_file" | tail -1 | tr -d '\r"')"
  if [[ -n "$new_user" && -n "$new_password" ]]; then
    {
      printf 'STALWART_URL=http://stalwart:8080\n'
      printf 'STALWART_USER=%q\n' "$new_user"
      printf 'STALWART_PASSWORD=%q\n' "$new_password"
    } >"$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE"
  fi
  rm -f "$output_file"
  [[ -f "$CREDENTIALS_FILE" ]] || fail "Bootstrap completed but no administrator credentials are available"
  pass "Stalwart bootstrap complete; administrator credentials stored root-only"
}

# --- 3. Local TLS certificate (no ACME, no external CA) ------------------------
generate_tls_certificate() {
  local key="$TLS_DIR/acceptance.key" crt="$TLS_DIR/acceptance.crt"
  if [[ -s "$crt" && -s "$key" ]]; then
    return 0
  fi
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout "$key" -out "$crt" \
    -subj "/CN=$MAIL_HOSTNAME" \
    -addext "subjectAltName=DNS:$MAIL_HOSTNAME,DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1 || fail "openssl failed to generate the acceptance TLS certificate"
  chmod 600 "$key"
  chmod 644 "$crt"
  pass "Generated self-signed acceptance TLS certificate for $MAIL_HOSTNAME"
}

import_tls_certificate() {
  local payload="$STATE_DIR/certificate-payload.json" query="$STATE_DIR/certificate-query.json"
  python3 - "$TLS_DIR/acceptance.crt" "$TLS_DIR/acceptance.key" "$payload" <<'PY'
import json, sys
cert, key, out = sys.argv[1:]
payload = {
    "certificate": {"@type": "Text", "value": open(cert, encoding="utf-8").read()},
    "privateKey": {"@type": "Text", "secret": open(key, encoding="utf-8").read()},
}
open(out, "w", encoding="utf-8").write(json.dumps(payload))
PY
  stalwart_cli query Certificate --fields id --json >"$query" 2>/dev/null || true
  local cert_id
  cert_id="$(stalwart_json first-id "$query" 2>/dev/null || true)"
  rm -f "$query"
  if [[ -n "$cert_id" ]]; then
    stalwart_cli update Certificate "$cert_id" --stdin <"$payload" >/dev/null
  else
    stalwart_cli create Certificate --stdin <"$payload" >/dev/null
  fi
  rm -f "$payload"
  pass "Installed acceptance TLS certificate into Stalwart"
}

# --- 4. Domain ----------------------------------------------------------------
resolve_domain() {
  local query="$STATE_DIR/domain-query.json"
  stalwart_cli query Domain --where "name=$DOMAIN" --fields id,name --json >"$query"
  DOMAIN_ID="$(stalwart_json id-by-name "$query" "$DOMAIN" 2>/dev/null || true)"
  rm -f "$query"
  [[ -n "$DOMAIN_ID" ]] || fail "Domain $DOMAIN was not found after bootstrap"
  pass "Domain $DOMAIN present (id captured)"
}

# --- 5. Mailbox accounts ------------------------------------------------------
# create_account writes EXACTLY one line to stdout: "<address><TAB><password>".
# All human-facing messages go to stderr so a command substitution captures the
# credential alone. See capture_password below.
create_account() {
  local name="$1" description="$2" alias_name="${3:-}"
  local query="$STATE_DIR/account-$name.json" existing password aliases
  stalwart_cli query Account --where "name=$name" --fields id,name --json >"$query" 2>/dev/null || true
  existing="$(stalwart_json id-by-name "$query" "$name" 2>/dev/null || true)"
  rm -f "$query"

  aliases='{}'
  if [[ -n "$alias_name" ]]; then
    aliases="{\"0\":{\"name\":\"$alias_name\",\"domainId\":\"$DOMAIN_ID\",\"enabled\":true,\"description\":\"Acceptance account alias\"}}"
  fi
  password="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-24)"

  if [[ -n "$existing" ]]; then
    stalwart_cli update Account "$existing" \
      --field "description=$description" \
      --field "aliases=$aliases" \
      --field "credentials={\"0\":{\"@type\":\"Password\",\"secret\":\"$password\"}}" >/dev/null
    pass "Reconciled existing mailbox $name@$DOMAIN" >&2
  else
    stalwart_cli create Account/User \
      --field "name=$name" \
      --field "domainId=$DOMAIN_ID" \
      --field "description=$description" \
      --field "credentials={\"0\":{\"@type\":\"Password\",\"secret\":\"$password\"}}" \
      --field 'memberGroupIds={}' \
      --field 'roles={"@type":"User"}' \
      --field 'permissions={"@type":"Inherit"}' \
      --field 'quotas={"maxDiskQuota":1073741824}' \
      --field "aliases=$aliases" \
      --field 'encryptionAtRest={"@type":"Disabled"}' >/dev/null
    pass "Created mailbox $name@$DOMAIN" >&2
  fi
  printf '%s\t%s\n' "$name@$DOMAIN" "$password"
}

# Capture create_account's single credential line and return the validated
# password. Fails closed if stdout was polluted or the password is not one
# non-empty alphanumeric token, so mailbox-credentials.env can never be written
# with a corrupt value.
capture_password() {
  local label="$1"
  shift
  local output
  output="$(create_account "$@")" || fail "create_account failed for $label"
  parse_credential_line "$label" "$output"
}

# --- 6. Distribution alias ----------------------------------------------------
create_alias_list() {
  local plan="$STATE_DIR/alias-list.ndjson"
  python3 - "$plan" "$DOMAIN_ID" "$DOMAIN" "$ALIAS_ADDRESS" "$ALICE_ADDRESS" "$BOB_ADDRESS" <<'PY'
import json, sys
path, domain_id, _domain, alias, alice, bob = sys.argv[1:]
local = alias.split("@", 1)[0]
value = {
    f"list-{local}": {
        "name": local,
        "domainId": domain_id,
        "description": "Acceptance distribution alias",
        "aliases": {},
        "recipients": {alice: True, bob: True},
    }
}
op = {"@type": "upsert", "object": "MailingList", "matchOn": ["name", "domainId"], "value": value}
open(path, "w", encoding="utf-8").write(json.dumps(op, separators=(",", ":")) + "\n")
PY
  if ! stalwart_cli apply --stdin --json <"$plan" \
      >"$STATE_DIR/alias-list.result" 2>"$STATE_DIR/alias-list.stderr"; then
    sed -E 's/(password|secret|token).*/\1 [REDACTED]/Ig' "$STATE_DIR/alias-list.stderr" >&2
    fail "Failed to create distribution alias $ALIAS_ADDRESS"
  fi
  rm -f "$plan" "$STATE_DIR/alias-list.result" "$STATE_DIR/alias-list.stderr"
  pass "Distribution alias $ALIAS_ADDRESS delivers to $ALICE_ADDRESS and $BOB_ADDRESS"
}

# --- 7. Authenticated submission listener -------------------------------------
ensure_submission_listener() {
  local query="$STATE_DIR/listener-submission.json" listener_id
  stalwart_cli query NetworkListener --where 'name=submission' --fields id,name --json >"$query" 2>/dev/null || true
  listener_id="$(stalwart_json id-by-name "$query" submission 2>/dev/null || true)"
  rm -f "$query"
  if [[ -n "$listener_id" ]]; then
    stalwart_cli update NetworkListener "$listener_id" \
      --field protocol=smtp \
      --field 'bind={"[::]:587":true}' \
      --field useTls=true \
      --field tlsImplicit=false >/dev/null
    pass "Reconciled submission listener on :587 (STARTTLS, authentication required)"
  else
    stalwart_cli create NetworkListener \
      --field name=submission \
      --field protocol=smtp \
      --field 'bind={"[::]:587":true}' \
      --field useTls=true \
      --field tlsImplicit=false >/dev/null
    pass "Created submission listener on :587 (STARTTLS, authentication required)"
  fi
}

# --- Run -----------------------------------------------------------------------
main() {
  require_docker
  "$ENV_DIR/guard.sh"
  command -v openssl >/dev/null 2>&1 || fail "openssl is required to generate the acceptance TLS certificate and passwords"

  install -d -m 700 "$GENERATED_DIR" "$STATE_DIR" "$TLS_DIR"
  umask 077

  ensure_initial_credentials
  bootstrap_stalwart
  generate_tls_certificate
  import_tls_certificate
  resolve_domain

  local alice_password bob_password
  alice_password="$(capture_password alice "${NAVIN_ACCEPTANCE_ALICE}" "Alice Acceptance" "alice.alias")"
  bob_password="$(capture_password bob "${NAVIN_ACCEPTANCE_BOB}" "Bob Acceptance")"

  require_one_token "alice password" "$alice_password" '^[A-Za-z0-9]{24}$'
  require_one_token "bob password" "$bob_password" '^[A-Za-z0-9]{24}$'

  create_alias_list
  ensure_submission_listener

  info "Restarting Stalwart to activate the certificate and submission listener"
  compose restart stalwart >/dev/null
  "$ENV_DIR/readiness.sh"

  umask 077
  {
    printf 'ALICE_ADDRESS=%s\n' "$ALICE_ADDRESS"
    printf 'ALICE_PASSWORD=%q\n' "$alice_password"
    printf 'BOB_ADDRESS=%s\n' "$BOB_ADDRESS"
    printf 'BOB_PASSWORD=%q\n' "$bob_password"
  } >"$MAILBOX_CREDENTIALS_FILE"
  chmod 600 "$MAILBOX_CREDENTIALS_FILE"

  emit_summary
  pass "Acceptance fixtures seeded; mailbox credentials stored root-only at $MAILBOX_CREDENTIALS_FILE"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
