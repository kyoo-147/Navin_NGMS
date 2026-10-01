#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
require_command docker

printf '=== CONTAINERS ===\n'
compose ps
printf '\n=== RESOURCE USAGE ===\n'
docker stats --no-stream navin-mail-stalwart navin-mail-snappymail 2>/dev/null || true
printf '\n=== LISTENERS ===\n'
ss -ltnp | grep -E ':(25|465|587|993|8082|8888)[[:space:]]' || true
printf '\n=== DISK ===\n'
df -h "$ROOT_DIR"
du -sh "$ROOT_DIR/data" 2>/dev/null || true
