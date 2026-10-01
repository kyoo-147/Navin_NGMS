#!/usr/bin/env bash
# Evidence capture helpers for the isolated acceptance environment.
# Sourced by run.sh. Every artifact is redacted; no secret is written to git
# (the whole generated/ tree is ignored).
set -euo pipefail

EVIDENCE_RUN_DIR="${EVIDENCE_RUN_DIR:-}"

evidence_init() {
  EVIDENCE_RUN_DIR="${EVIDENCE_RUN_DIR:-$EVIDENCE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)}"
  install -d -m 700 "$EVIDENCE_RUN_DIR"
  export EVIDENCE_RUN_DIR
}

# Scrub anything that looks like a credential, including quoted values.
redact() {
  sed -E "s/(password|secret|token|passwd|credential)([=: ]+)('[^']*'|\"[^\"]*\"|[^[:space:]]+)/\1\2[REDACTED]/Ig"
}

evidence_versions() {
  {
    printf '# versions\n'
    printf 'captured_at=%s\n' "$(now_utc)"
    docker version --format 'docker_client={{.Client.Version}} docker_server={{.Server.Version}}' 2>&1 || true
    docker compose version 2>&1 || true
    uname -a 2>&1 || true
  } | redact >"$EVIDENCE_RUN_DIR/versions.txt"
}

evidence_images() {
  {
    printf '# pinned image digests\n'
    for image in "$STALWART_IMAGE" "$CLI_IMAGE"; do
      printf 'requested=%s\n' "$image"
      printf 'resolved=%s\n' "$(docker image inspect "$image" --format '{{index .RepoDigests 0}}' 2>&1 || echo not-present)"
    done
  } | redact >"$EVIDENCE_RUN_DIR/images.txt"
}

evidence_compose() {
  compose config >"$EVIDENCE_RUN_DIR/compose-config.yaml" 2>&1 || true
  compose ps >"$EVIDENCE_RUN_DIR/compose-ps.txt" 2>&1 || true
  docker ps --filter "label=com.navin.acceptance=true" \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
    >"$EVIDENCE_RUN_DIR/containers.txt" 2>&1 || true
}

evidence_logs() {
  compose logs --no-color --tail=300 stalwart 2>&1 | redact >"$EVIDENCE_RUN_DIR/stalwart.log" || true
}

# Render a human-readable summary plus a machine-readable summary.json.
evidence_summary() {
  local overall="${1:-unknown}"
  EVIDENCE_RUN_DIR="$EVIDENCE_RUN_DIR" STATE_DIR="$STATE_DIR" OVERALL="$overall" python3 - <<'PY'
import json
import os
from pathlib import Path

evidence = Path(os.environ["EVIDENCE_RUN_DIR"])
evidence.mkdir(parents=True, exist_ok=True)
state = Path(os.environ["STATE_DIR"])
overall = os.environ["OVERALL"]

def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None

protocol = read_json(state / "protocol-check.json") or {}
seed = read_json(state / "seed.json") or {}
checks = protocol.get("results", [])

lines = ["# Navin W03 acceptance evidence", ""]
lines.append(f"- overall: **{overall}**")
lines.append(f"- evidence dir: `{evidence}`")
lines.append(f"- domain: `{seed.get('domain', 'unknown')}`")
lines.append(f"- alias: `{seed.get('alias', 'unknown')}`")
lines.append("")
lines.append("## Protocol checks")
lines.append("")
if checks:
    for item in checks:
        mark = "PASS" if item.get("ok") else "FAIL"
        detail = item.get("detail", "")
        lines.append(f"- [{mark}] `{item.get('check')}` {detail}")
else:
    lines.append("- (no protocol checks recorded)")
lines.append("")
lines.append("## Artifacts")
lines.append("")
for name in ["versions.txt", "images.txt", "compose-ps.txt", "containers.txt",
             "compose-config.yaml", "stalwart.log", "guard.txt", "up.txt",
             "seed.txt", "verify.txt", "teardown.txt"]:
    path = evidence / name
    if path.exists():
        lines.append(f"- `{name}` ({path.stat().st_size} bytes)")
lines.append("")

summary = {
    "overall": overall,
    "evidenceDir": str(evidence),
    "protocolChecks": checks,
    "protocolFailures": protocol.get("failures"),
    "domain": seed.get("domain"),
    "alias": seed.get("alias"),
}
(evidence / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
(evidence / "summary.md").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines))
PY
}
