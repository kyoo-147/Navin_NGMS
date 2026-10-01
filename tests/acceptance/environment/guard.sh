#!/usr/bin/env bash
# Navin W03 production guard.
#
# The acceptance environment must never contact production. This guard fails
# closed on any of the following:
#   1. a production identifier (domain / container name / bind path / port)
#      appears in the acceptance configuration or fixture scripts;
#   2. the acceptance configuration is not namespaced `navin-acceptance`;
#   3. any published port is not bound to loopback or collides with a
#      production port;
#   4. (when Docker is available) a production container is currently running;
#   5. (when Docker is available) the resolved `docker compose config` model
#      violates any of the above.
#
# The static checks run everywhere; the runtime checks are skipped with a
# warning when Docker is unavailable, so this guard is usable in CI and on a
# developer laptop without a container runtime.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

violations=0
guard_ok() { printf '[GUARD OK ] %s\n' "$*"; }
guard_fail() { printf '[GUARD:FAIL] %s\n' "$*" >&2; violations=$((violations + 1)); }

# ---------------------------------------------------------------------------
# 1. Static scan: no production identifiers in the acceptance configuration,
#    fixture scripts or probe. Documentation (README) and the guard machinery
#    itself (guard.sh, lib/common.sh, lib/guard_compose.py) legitimately name
#    production identifiers and are excluded.
# ---------------------------------------------------------------------------
scan_files=("$COMPOSE_FILE" "$ACCEPTANCE_ENV")
while IFS= read -r -d '' file; do
  scan_files+=("$file")
done < <(find "$ENV_DIR" -type f \( -name '*.sh' -o -name '*.py' \) \
  -not -path "*/generated/*" \
  -not -name 'guard.sh' \
  -not -name 'common.sh' \
  -not -name 'guard_compose.py' \
  -print0)

production_hits=0
for token in "$PRODUCTION_DOMAIN" "$PRODUCTION_MAIL_HOSTNAME" "$PRODUCTION_WEBMAIL_HOSTNAME" \
             "${PRODUCTION_CONTAINER_NAMES[@]}"; do
  if grep -aRIn -- "$token" "${scan_files[@]}" >/dev/null 2>&1; then
    guard_fail "production identifier '$token' found in acceptance files"
    production_hits=$((production_hits + 1))
  fi
done
(( production_hits == 0 )) && guard_ok "no production identifiers in acceptance configuration, fixture scripts or probe"

# ---------------------------------------------------------------------------
# 2. Namespacing.
# ---------------------------------------------------------------------------
grep -q "^name: ${COMPOSE_PROJECT_NAME}$" "$COMPOSE_FILE" \
  && guard_ok "compose project is '${COMPOSE_PROJECT_NAME}'" \
  || guard_fail "compose project name is not '${COMPOSE_PROJECT_NAME}'"

grep -q "name: ${NETWORK_NAME}$" "$COMPOSE_FILE" \
  && guard_ok "network is namespaced '${NETWORK_NAME}'" \
  || guard_fail "network is not namespaced '${NETWORK_NAME}'"

grep -q "name: ${NAVIN_ACCEPTANCE_VOLUME_ETC}" "$COMPOSE_FILE" \
  && grep -q "name: ${NAVIN_ACCEPTANCE_VOLUME_LIB}" "$COMPOSE_FILE" \
  && guard_ok "volumes are namespaced '${COMPOSE_PROJECT_NAME}-*'" \
  || guard_fail "volumes are not namespaced under '${COMPOSE_PROJECT_NAME}'"

# No production bind mounts or production env file.
if grep -nE '\./(data|state|backups)(/|:|$)|credentials\.env|env_file:.*\.env' "$COMPOSE_FILE" >/dev/null 2>&1; then
  guard_fail "compose references a production bind path or production env file"
else
  guard_ok "compose uses only isolated named volumes"
fi

# ---------------------------------------------------------------------------
# 3. Port bindings: every published port is loopback + non-production.
#    Host ports are `${VAR}` substitutions in the compose file, so binding is
#    checked textually and the resolved ports are compared against the
#    production port set from the sourced configuration.
# ---------------------------------------------------------------------------
mapfile -t port_lines < <(grep -oE "[\"']([^\"']*:[0-9]+)[\"']" "$COMPOSE_FILE" || true)
if (( ${#port_lines[@]} == 0 )); then
  guard_fail "no published port mappings found in acceptance compose"
else
  loopback_count=0
  for line in "${port_lines[@]}"; do
    mapping="$(printf '%s' "$line" | tr -d "\"'" )"
    if [[ "$mapping" == 127.0.0.1:* ]]; then
      loopback_count=$((loopback_count + 1))
    else
      guard_fail "published port '$mapping' is not bound to loopback"
    fi
  done
  (( loopback_count == ${#port_lines[@]} )) && guard_ok "all ${#port_lines[@]} published ports are loopback-bound"
fi

declare -A acceptance_ports=()
for port in "$SMTP_PORT" "$SUBMISSION_PORT" "$IMAP_PORT" "$IMAPS_PORT" "$HTTP_PORT"; do
  acceptance_ports[$port]=1
done
port_collision=0
for prod_port in "${PRODUCTION_PORTS[@]}"; do
  if [[ -n "${acceptance_ports[$prod_port]:-}" ]]; then
    guard_fail "acceptance host port $prod_port collides with a production port"
    port_collision=1
  fi
done
(( port_collision == 0 )) && guard_ok "no acceptance host port collides with a production port"

# The fixture domain must be a reserved .test name.
if [[ "$DOMAIN" == *.test ]]; then
  guard_ok "fixture domain '$DOMAIN' is a reserved .test name"
else
  guard_fail "fixture domain '$DOMAIN' is not a reserved .test name"
fi

# ---------------------------------------------------------------------------
# 4 & 5. Runtime checks (Docker-aware).
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  running="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  prod_running=0
  for name in "${PRODUCTION_CONTAINER_NAMES[@]}"; do
    if grep -qx "$name" <<<"$running"; then
      guard_fail "production container '$name' is running; refusing to run acceptance"
      prod_running=1
    fi
  done
  (( prod_running == 0 )) && guard_ok "no production containers are running"

  if compose config --format json 2>/dev/null | python3 "$LIB_DIR/guard_compose.py"; then
    guard_ok "resolved compose model passed runtime guard"
  else
    guard_fail "resolved compose model failed runtime guard"
  fi
else
  warn "Docker unavailable; runtime guard checks skipped (static checks still enforced)"
fi

# ---------------------------------------------------------------------------
if (( violations > 0 )); then
  fail "$violations production-guard violation(s); aborting"
fi
exit 0
