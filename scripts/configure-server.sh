#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
[[ "$(id -u)" -eq 0 ]] || fail "Run server configuration as root"

query="$ROOT_DIR/state/listener-submission.json"
install -d -m 700 "$ROOT_DIR/state"
umask 077
stalwart_cli query NetworkListener --where 'name=submission' --fields id,name --json >"$query" 2>/dev/null || true
listener_id="$(python3 - "$query" <<'PY'
import json,sys
text=open(sys.argv[1],encoding='utf-8').read().strip()
if not text: rows=[]
else:
    try: values=[json.loads(text)]
    except json.JSONDecodeError: values=[json.loads(line) for line in text.splitlines() if line.strip()]
    rows=[]
    for v in values:
        if isinstance(v,list): rows.extend(v)
        elif isinstance(v,dict) and 'id' in v: rows.append(v)
        elif isinstance(v,dict) and isinstance(v.get('items'),list): rows.extend(v['items'])
for row in rows:
    if row.get('name') == 'submission': print(row['id']); break
PY
)"
rm -f "$query"

if [[ -n "$listener_id" ]]; then
  stalwart_cli update NetworkListener "$listener_id" \
    --field protocol=smtp \
    --field 'bind={"[::]:587":true}' \
    --field useTls=true \
    --field tlsImplicit=false >/dev/null
  pass "Submission listener already exists and was reconciled"
else
  stalwart_cli create NetworkListener \
    --field name=submission \
    --field protocol=smtp \
    --field 'bind={"[::]:587":true}' \
    --field useTls=true \
    --field tlsImplicit=false >/dev/null
  pass "Created submission listener on port 587"
fi

docker compose -f "$ROOT_DIR/compose.yaml" --env-file "$ROOT_DIR/.env" restart stalwart >/dev/null
pass "Restarted Stalwart to activate listener and certificate changes"
