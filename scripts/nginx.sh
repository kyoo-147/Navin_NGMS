#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

action="${1:-check}"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
template="$ROOT_DIR/config/nginx/mail.conf.template"
if [[ -r "/etc/letsencrypt/live/$MAIL_HOSTNAME/fullchain.pem" \
   && -r "/etc/letsencrypt/live/$MAIL_HOSTNAME/privkey.pem" ]]; then
  template="$ROOT_DIR/config/nginx/mail-tls.conf.template"
fi
sed -e "s/__MAIL_HOSTNAME__/$MAIL_HOSTNAME/g" -e "s/__WEBMAIL_HOSTNAME__/$WEBMAIL_HOSTNAME/g" \
  "$template" > "$tmp"
case "$action" in
  check)
    cat "$tmp"
    ;;
  apply)
    [[ "$(id -u)" -eq 0 ]] || fail "nginx apply must run as root"
    [[ "$(getent ahostsv4 "$MAIL_HOSTNAME" | awk 'NR==1 {print $1}')" == "$SERVER_IPV4" ]] || fail "$MAIL_HOSTNAME does not resolve to $SERVER_IPV4"
    [[ "$(getent ahostsv4 "$WEBMAIL_HOSTNAME" | awk 'NR==1 {print $1}')" == "$SERVER_IPV4" ]] || fail "$WEBMAIL_HOSTNAME does not resolve to $SERVER_IPV4"
    install -m 644 "$tmp" /etc/nginx/sites-available/navin-mail
    ln -sfn /etc/nginx/sites-available/navin-mail /etc/nginx/sites-enabled/navin-mail
    nginx -t
    systemctl reload nginx
    if [[ "$template" == *mail-tls.conf.template ]]; then
      pass "Nginx HTTPS routes installed"
    else
      pass "Nginx HTTP bootstrap routes installed; request TLS certificates next"
    fi
    ;;
  *) fail "Usage: ./navin-mail nginx [check|apply]" ;;
esac
