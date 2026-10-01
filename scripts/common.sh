#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CREDENTIALS_FILE="$ROOT_DIR/credentials.env"

fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '[INFO] %s\n' "$*"; }
pass() { printf '[ OK ] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

require_env() {
  [[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE; copy .env.example and edit it"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  local key
  for key in DOMAIN MAIL_HOSTNAME WEBMAIL_HOSTNAME ADMIN_EMAIL SERVER_IPV4; do
    [[ -n "${!key:-}" ]] || fail "$key is required in .env"
  done
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

compose() {
  (cd "$ROOT_DIR" && docker compose "$@")
}

load_credentials() {
  [[ -f "$CREDENTIALS_FILE" ]] || fail "Missing $CREDENTIALS_FILE (mode 600)"
  local mode
  mode="$(stat -c '%a' "$CREDENTIALS_FILE" 2>/dev/null || true)"
  [[ "$mode" == "600" ]] || fail "$CREDENTIALS_FILE must have mode 600 (current: ${mode:-unknown})"
  set -a
  # shellcheck disable=SC1090
  source "$CREDENTIALS_FILE"
  set +a
}

stalwart_cli() {
  load_credentials
  local url="${STALWART_URL:-http://stalwart:8080}"
  local -a credential_args
  if [[ -n "${STALWART_TOKEN:-}" ]]; then
    credential_args=(-e STALWART_TOKEN)
  elif [[ -n "${STALWART_USER:-}" && -n "${STALWART_PASSWORD:-}" ]]; then
    credential_args=(-e STALWART_USER -e STALWART_PASSWORD)
  else
    fail "credentials.env must define STALWART_TOKEN or STALWART_USER and STALWART_PASSWORD"
  fi
  docker run --rm -i --network navin-mail \
    -e STALWART_URL="$url" \
    "${credential_args[@]}" \
    "${STALWART_CLI_IMAGE:-ghcr.io/stalwartlabs/cli:1.0.13}" "$@"
}
