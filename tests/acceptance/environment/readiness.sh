#!/usr/bin/env bash
# Wait until the acceptance Stalwart HTTP endpoint answers.
#
# Readiness is polled over HTTP only. Raw TCP probes of the mail ports are
# deliberately avoided: Stalwart treats repeated connect/drop cycles as port
# scanning and can block the source. Real SMTP/IMAP readiness is proven later
# by the protocol probe in verify.sh.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_docker

http_status() {
  local path="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:${HTTP_PORT}${path}" 2>/dev/null || echo "000"
}

deadline=$(( $(date +%s) + READY_TIMEOUT ))
ready=0
while (( $(date +%s) < deadline )); do
  if compose ps --status running --services 2>/dev/null | grep -qx stalwart; then
    for path in /healthz /.well-known/jmap /; do
      status="$(http_status "$path")"
      if [[ "$status" != "000" ]]; then
        ready=1
        info "Stalwart answered HTTP ${status} for ${path}"
        break
      fi
    done
  fi
  (( ready == 1 )) && break
  sleep 3
done

if (( ready != 1 )); then
  warn "Stalwart did not become ready within ${READY_TIMEOUT}s; recent logs:"
  compose logs --tail=100 stalwart >&2 || true
  fail "Stalwart HTTP readiness failed"
fi

pass "Stalwart HTTP endpoint is ready on 127.0.0.1:${HTTP_PORT}"
