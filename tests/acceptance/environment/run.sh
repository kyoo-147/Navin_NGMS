#!/usr/bin/env bash
# End-to-end W03 acceptance run against the isolated disposable environment:
#
#   guard -> up -> readiness -> seed -> verify -> evidence -> teardown
#
# The stack is always torn down at the end (pass --keep to leave it running for
# debugging). A non-zero exit means at least one phase failed. Real protocol
# and API exchanges are required; nothing here reports fake success.
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
source "$LIB_DIR/evidence.sh"

KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

require_docker || exit 1
install -d -m 700 "$GENERATED_DIR" "$STATE_DIR" "$EVIDENCE_ROOT" "$TLS_DIR"
evidence_init

OVERALL=0

run_phase() {
  local name="$1"; shift
  local log="$EVIDENCE_RUN_DIR/$name.txt"
  info "── phase: $name"
  if "$@" >"$log" 2>&1; then
    pass "$name phase passed"
    return 0
  fi
  OVERALL=1
  warn "$name phase FAILED (last 40 lines of $log):"
  tail -n 40 "$log" >&2 || true
  return 1
}

collect_evidence() {
  evidence_versions
  evidence_images
  evidence_compose || true
  evidence_logs || true
}

teardown_if_requested() {
  if (( KEEP == 1 )); then
    warn "Stack left running (--keep); run $ENV_DIR/down.sh to tear down"
  else
    run_phase teardown "$ENV_DIR/down.sh" || true
  fi
}

run_phase guard "$ENV_DIR/guard.sh" || true
if (( OVERALL != 0 )); then
  evidence_summary "failed (guard)"
  fail "W03 acceptance FAILED at the production guard — evidence: $EVIDENCE_RUN_DIR"
fi

run_phase up "$ENV_DIR/up.sh" || true
if (( OVERALL != 0 )); then
  collect_evidence
  teardown_if_requested
  evidence_summary "failed (up)"
  fail "W03 acceptance FAILED during startup — evidence: $EVIDENCE_RUN_DIR"
fi

run_phase seed "$ENV_DIR/seed.sh" || true
if (( OVERALL == 0 )); then
  run_phase verify "$ENV_DIR/verify.sh" || true
fi

collect_evidence
teardown_if_requested

if (( OVERALL == 0 )); then
  evidence_summary "passed"
  printf '\n'
  pass "W03 acceptance PASSED — evidence: $EVIDENCE_RUN_DIR"
  exit 0
fi

evidence_summary "failed"
printf '\n'
fail "W03 acceptance FAILED — evidence: $EVIDENCE_RUN_DIR"
