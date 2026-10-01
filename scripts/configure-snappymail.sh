#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env
[[ "$(id -u)" -eq 0 ]] || fail "Run SnappyMail configuration as root"

base="$ROOT_DIR/data/snappymail/_data_/_default_"
domain_dir="$base/domains"
app_ini="$base/configs/application.ini"
source_json="$ROOT_DIR/config/snappymail/domain.template.json"
rendered_json="$ROOT_DIR/state/snappymail-domain.json"
[[ -d "$domain_dir" && -f "$app_ini" ]] || fail "SnappyMail data is not initialized; start the container first"
[[ -f "$source_json" ]] || fail "Missing SnappyMail domain template: $source_json"

install -d -m 700 "$ROOT_DIR/state"
python3 - "$source_json" "$rendered_json" "$DOMAIN" "$MAIL_HOSTNAME" <<'PY'
import pathlib, sys

source, output, domain, mail_hostname = sys.argv[1:]
text = pathlib.Path(source).read_text(encoding="utf-8")
text = text.replace("__DOMAIN__", domain).replace("__MAIL_HOSTNAME__", mail_hostname)
pathlib.Path(output).write_text(text, encoding="utf-8")
PY
chmod 600 "$rendered_json"

uid="$(stat -c %u "$domain_dir")"
gid="$(stat -c %g "$domain_dir")"
install -m 600 "$rendered_json" "$domain_dir/$DOMAIN.json"
chown "$uid:$gid" "$domain_dir/$DOMAIN.json"
rm -f "$rendered_json"

python3 - "$app_ini" "$DOMAIN" <<'PY'
import re,sys
path,domain=sys.argv[1:]
text=open(path,encoding='utf-8').read()
replacements={
    'allow_admin_panel': 'Off',
    'force_https': 'On',
    'default_domain': f'"{domain}"',
}
for key,value in replacements.items():
    pattern=rf'(?m)^(\s*{re.escape(key)}\s*=\s*).*$'
    text,n=re.subn(pattern,rf'\g<1>{value}',text,count=1)
    if n != 1:
        raise SystemExit(f'Missing SnappyMail setting: {key}')
open(path,'w',encoding='utf-8').write(text)
PY
chown "$uid:$gid" "$app_ini"
chmod 600 "$app_ini"

docker compose -f "$ROOT_DIR/compose.yaml" --env-file "$ROOT_DIR/.env" restart snappymail >/dev/null
pass "Configured SnappyMail for $DOMAIN and disabled its admin panel"
