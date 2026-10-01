#!/usr/bin/env bash
# Tear down the isolated acceptance stack: stop containers and remove the
# acceptance network and volumes. Only resources namespaced `navin-acceptance`
# (or labelled com.navin.acceptance=true) are touched.
#
# Usage: down.sh [--purge]
#   --purge  also delete the generated/ directory (credentials, state, evidence)
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_docker

info "Tearing down isolated acceptance stack (project '$COMPOSE_PROJECT_NAME')"
compose down -v --remove-orphans || warn "compose down reported an issue (continuing teardown)"

# Remove any stray acceptance-labelled containers, then the network/volumes.
stray="$(docker ps -aq --filter "label=com.navin.acceptance=true" 2>/dev/null || true)"
if [[ -n "$stray" ]]; then
  # shellcheck disable=SC2086
  docker rm -f $stray >/dev/null 2>&1 || true
fi
docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
for volume in "$NAVIN_ACCEPTANCE_VOLUME_ETC" "$NAVIN_ACCEPTANCE_VOLUME_LIB"; do
  docker volume rm "$volume" >/dev/null 2>&1 || true
done

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$GENERATED_DIR"
  pass "Teardown complete and generated artifacts purged"
else
  pass "Teardown complete; containers, network and volumes removed (evidence retained under $EVIDENCE_ROOT)"
fi
