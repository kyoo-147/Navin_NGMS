#!/usr/bin/env bash
# Verify the seeded acceptance environment with real protocol/API exchanges:
# HTTP health, JMAP login, SMTP submission, IMAP receive and alias delivery.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_docker
"$ENV_DIR/guard.sh"
load_mailbox_credentials

export NAVIN_ACCEPT_DOMAIN="$DOMAIN"
export NAVIN_ACCEPT_ALICE="${NAVIN_ACCEPTANCE_ALICE}"
export NAVIN_ACCEPT_BOB="${NAVIN_ACCEPTANCE_BOB}"
export NAVIN_ACCEPT_ALIAS="${NAVIN_ACCEPTANCE_ALIAS}"
export NAVIN_ACCEPT_HTTP_PORT="$HTTP_PORT"
export NAVIN_ACCEPT_SMTP_PORT="$SMTP_PORT"
export NAVIN_ACCEPT_SUBMISSION_PORT="$SUBMISSION_PORT"
export NAVIN_ACCEPT_IMAP_PORT="$IMAP_PORT"
export NAVIN_ACCEPT_IMAPS_PORT="$IMAPS_PORT"
export NAVIN_ACCEPT_TLS_CERT="$TLS_DIR/acceptance.crt"
export NAVIN_ACCEPT_TIMEOUT="${NAVIN_ACCEPT_TIMEOUT:-60}"
export NAVIN_ALICE_PASSWORD="${ALICE_PASSWORD}"
export NAVIN_BOB_PASSWORD="${BOB_PASSWORD}"

python3 "$PROBE_DIR/protocol_check.py" "$STATE_DIR/protocol-check.json" \
  || fail "Protocol verification failed (see $STATE_DIR/protocol-check.json)"

pass "Protocol verification passed: health, JMAP login, SMTP submit, IMAP receive and alias delivery"
