#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

cat <<EOF
Required baseline records (publish only after Stalwart bootstrap):

A      ${MAIL_HOSTNAME}.          ${SERVER_IPV4}
A      ${WEBMAIL_HOSTNAME}.       ${SERVER_IPV4}
MX 10  ${DOMAIN}.                 ${MAIL_HOSTNAME}.
TXT    ${DOMAIN}.                 "v=spf1 mx -all"
TXT    _dmarc.${DOMAIN}.          "v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}; adkim=s; aspf=s"

PTR at the server provider:
${SERVER_IPV4} -> ${MAIL_HOSTNAME}

Do not publish AAAA or ip6 SPF until IPv6 PTR and forward DNS are verified.
DKIM must be copied exactly from Stalwart's generated DNS zone after bootstrap.
Do not publish MTA-STS/autoconfig CNAME records until those names are included
in the public TLS certificate.
EOF

if command -v dig >/dev/null 2>&1; then
  printf '\nCurrent public DNS:\n'
  printf 'A mail: '; dig +short A "$MAIL_HOSTNAME" | paste -sd, -; true
  printf 'A webmail: '; dig +short A "$WEBMAIL_HOSTNAME" | paste -sd, -; true
  printf 'MX domain: '; dig +short MX "$DOMAIN" | paste -sd, -; true
  printf 'SPF: '; dig +short TXT "$DOMAIN" | grep -i 'v=spf1' || true
  printf 'DMARC: '; dig +short TXT "_dmarc.$DOMAIN" || true
  for selector in ${DKIM_SELECTORS:-}; do
    printf 'DKIM %s: ' "$selector"; dig +short TXT "$selector._domainkey.$DOMAIN" | paste -sd, -; true
  done
  printf 'PTR: '; dig +short -x "$SERVER_IPV4" | paste -sd, -; true
fi
