#!/usr/bin/env bash
# Unit-like contract test for credential capture safety (no Docker required).
#
# Proves that parse_credential_line / require_one_token fail closed on polluted
# or malformed captures, and that the real create_account emits exactly one
# machine-readable credential line on stdout with human messages on stderr — the
# V2 review finding. Nothing here reports fake success: a failure exits non-zero.
set -uo pipefail

ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ENV_DIR/lib/common.sh"
# seed.sh only defines functions when sourced (main() runs on execute).
source "$ENV_DIR/seed.sh"
set -uo pipefail

passed=0
failed=0

ok() { printf 'PASS %s\n' "$1"; passed=$((passed + 1)); }
bad() {
  printf 'FAIL %s\n' "$1" >&2
  failed=$((failed + 1))
}

expect_password() {
  local desc="$1" expected="$2" line="$3" actual
  if actual="$(parse_credential_line test "$line" 2>/dev/null)" && [[ "$actual" == "$expected" ]]; then
    ok "$desc"
  else
    bad "$desc (got '${actual:-<rejected>}')"
  fi
}

expect_rejected() {
  local desc="$1" line="$2"
  if (parse_credential_line test "$line") >/dev/null 2>&1; then
    bad "$desc (expected rejection)"
  else
    ok "$desc"
  fi
}

good_pw='AbCdEf0123456789AbCdEf01'

expect_password "accepts a single well-formed credential line" "$good_pw" \
  "$(printf 'alice@company.test\t%s' "$good_pw")"

# Regression: the V2 bug — a status line prepended to the credential line.
expect_rejected "rejects status text prepended to the credential line" \
  "$(printf '[ OK ] Created mailbox alice@company.test\nalice@company.test\t%s' "$good_pw")"
expect_rejected "rejects a trailing extra line" \
  "$(printf 'alice@company.test\t%s\nextra' "$good_pw")"
expect_rejected "rejects an embedded carriage return" \
  "$(printf 'alice@company.test\t%s\r' "$good_pw")"
expect_rejected "rejects a missing tab separator" 'alice@company.test'
expect_rejected "rejects an empty password" \
  "$(printf 'alice@company.test\t')"
expect_rejected "rejects a short password" \
  "$(printf 'alice@company.test\tshort')"
expect_rejected "rejects a password containing a space" \
  "$(printf 'alice@company.test\tAbCdEf 0123456789AbCdEf')"

if (require_one_token test "$good_pw" '^[A-Za-z0-9]{24}$') >/dev/null 2>&1; then
  ok "require_one_token accepts a single token"
else
  bad "require_one_token accepts a single token"
fi
if (require_one_token test "$(printf 'line1\nline2')") >/dev/null 2>&1; then
  bad "require_one_token rejects a multiline value"
else
  ok "require_one_token rejects a multiline value"
fi

# --- Behavioural test of the real create_account ------------------------------
# Stub the engine-facing helpers so create_account runs without Docker.
stalwart_cli() { :; }
stalwart_json() { :; }
openssl() { printf 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; }
STATE_DIR="$(mktemp -d)"
DOMAIN_ID="dom-test"

err_file="$(mktemp)"
stdout="$(create_account alice "Alice Acceptance" "alice.alias" 2>"$err_file")"

stdout_lines="$(printf '%s\n' "$stdout" | grep -c '')"
if [[ "$stdout_lines" == "1" ]]; then
  ok "create_account emits exactly one stdout line"
else
  bad "create_account emits exactly one stdout line (got $stdout_lines)"
fi

if captured="$(parse_credential_line alice "$stdout" 2>/dev/null)" && [[ "$captured" =~ ^[A-Za-z0-9]{24}$ ]]; then
  ok "create_account stdout parses to one valid password"
else
  bad "create_account stdout parses to one valid password"
fi

if grep -q 'Created mailbox' "$err_file"; then
  ok "create_account sends its human status message to stderr"
else
  bad "create_account sends its human status message to stderr"
fi

if grep -qE '(Created|Reconciled) mailbox' <<<"$stdout"; then
  bad "create_account leaks no status text on stdout"
else
  ok "create_account leaks no status text on stdout"
fi

rm -rf "$STATE_DIR" "$err_file"

printf '\ncapture-contract: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
