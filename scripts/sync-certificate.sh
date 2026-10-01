#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
[[ "$(id -u)" -eq 0 ]] || fail "Run certificate sync as root"

cert_dir="/etc/letsencrypt/live/$MAIL_HOSTNAME"
fullchain="$cert_dir/fullchain.pem"
private_key="$cert_dir/privkey.pem"
[[ -r "$fullchain" && -r "$private_key" ]] || fail "Let's Encrypt certificate files not found under $cert_dir"

install -d -m 700 "$ROOT_DIR/state"
umask 077
payload="$ROOT_DIR/state/certificate-payload.json"
query="$ROOT_DIR/state/certificate-query.json"
python3 - "$fullchain" "$private_key" "$payload" <<'PY'
import json,sys
cert,key,out=sys.argv[1:]
payload={
  "certificate":{"@type":"Text","value":open(cert,encoding="utf-8").read()},
  "privateKey":{"@type":"Text","secret":open(key,encoding="utf-8").read()},
}
open(out,"w",encoding="utf-8").write(json.dumps(payload))
PY

stalwart_cli query Certificate --where "subjectAlternativeNames=$MAIL_HOSTNAME" --fields id,subjectAlternativeNames --json >"$query" 2>/dev/null || true
cert_id="$(python3 - "$query" "$MAIL_HOSTNAME" <<'PY'
import json,sys
try: v=json.load(open(sys.argv[1],encoding='utf-8'))
except Exception: v=[]
host=sys.argv[2]
rows=v if isinstance(v,list) else ([v] if isinstance(v,dict) and 'id' in v else v.get('items',[]) if isinstance(v,dict) else [])
for row in rows:
    sans=row.get('subjectAlternativeNames') or {}
    names=set(sans) if isinstance(sans,list) else {k for k,val in sans.items() if val} if isinstance(sans,dict) else set()
    if host in names:
        print(row['id']); break
PY
)"

if [[ -n "$cert_id" ]]; then
  stalwart_cli update Certificate "$cert_id" --stdin <"$payload" >/dev/null
  pass "Updated Stalwart TLS certificate $cert_id"
else
  stalwart_cli create Certificate --stdin <"$payload" >/dev/null
  pass "Installed Stalwart TLS certificate"
fi
rm -f "$payload" "$query"
