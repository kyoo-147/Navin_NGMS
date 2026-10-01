#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

failures=0
check_result() {
  local label="$1" result="$2"
  if [[ "$result" == true ]]; then pass "$label"; else warn "$label"; failures=$((failures + 1)); fi
}

port_available_or_owned() {
  local port="$1"
  if ! ss -ltnH "sport = :$port" | grep -q .; then
    return 0
  fi
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
    | grep -E '^navin-mail-(stalwart|snappymail) ' \
    | grep -Eq "(^|[,: ])(0\\.0\\.0\\.0|127\\.0\\.0\\.1|\\[::\\]):${port}->"
}

info "Navin Mail preflight"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] && result=true || result=false
check_result "64-bit Linux host" "$result"
(( $(nproc) >= 1 )) && result=true || result=false
check_result "At least 1 CPU core" "$result"
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
(( mem_kb >= 1572864 )) && result=true || result=false
check_result "At least 1.5 GiB total RAM" "$result"
free_kb="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
(( free_kb >= 10485760 )) && result=true || result=false
check_result "At least 10 GiB free on data filesystem" "$result"

for port in 25 465 587 993 "${STALWART_HTTP_BIND##*:}" "${SNAPPYMAIL_HTTP_BIND##*:}"; do
  if port_available_or_owned "$port"; then pass "Port $port is free or owned by Navin Mail"; else warn "Port $port is occupied by another service"; failures=$((failures + 1)); fi
done

if (( failures > 0 )); then
  fail "$failures preflight check(s) failed"
fi
pass "Preflight complete"
