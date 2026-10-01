#!/usr/bin/env bash
# Start the isolated acceptance stack. Enforces the production guard first.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_docker
"$ENV_DIR/guard.sh"

install -d -m 700 "$GENERATED_DIR" "$STATE_DIR" "$EVIDENCE_ROOT" "$TLS_DIR"

info "Pulling pinned acceptance images"
compose pull

info "Starting isolated acceptance stack (project '$COMPOSE_PROJECT_NAME')"
compose up -d
compose ps

"$ENV_DIR/readiness.sh"

pass "Acceptance stack is up; loopback ports http=${HTTP_PORT} smtp=${SMTP_PORT} submission=${SUBMISSION_PORT} imap=${IMAP_PORT} imaps=${IMAPS_PORT}"
