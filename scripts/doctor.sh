#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

errors=0
warnings=0
ok() { pass "$1"; }
bad() { printf '[FAIL] %s\n' "$1"; errors=$((errors + 1)); }
caution() { warn "$1"; warnings=$((warnings + 1)); }

printf 'NAVIN MAIL DOCTOR\n\n'
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then ok "Docker and Compose available"; else bad "Docker or Compose unavailable"; fi
if compose ps --status running --services 2>/dev/null | grep -qx stalwart; then ok "Stalwart container running"; else bad "Stalwart container not running"; fi
if compose ps --status running --services 2>/dev/null | grep -qx snappymail; then ok "SnappyMail container running"; else bad "SnappyMail container not running"; fi
if curl -fsS --max-time 5 "http://${STALWART_HTTP_BIND}/admin" >/dev/null 2>&1; then ok "Stalwart HTTP responds locally"; else caution "Stalwart /admin not ready locally"; fi
if curl -fsS --max-time 5 "http://${SNAPPYMAIL_HTTP_BIND}/" >/dev/null 2>&1; then ok "SnappyMail responds locally"; else bad "SnappyMail does not respond locally"; fi

# Inspect listeners without opening and immediately dropping protocol sessions.
# Repeated raw TCP probes are intentionally avoided because Stalwart correctly
# treats that pattern as port scanning and can block Docker's bridge gateway.
for port in 25 465 587 993; do
  if ss -H -ltn 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" { found=1 } END { exit !found }'; then
    ok "Mail port $port is listening"
  else
    bad "Mail port $port is not listening"
  fi
done

if curl -fsS --max-time 10 "https://$WEBMAIL_HOSTNAME/" >/dev/null 2>&1; then
  ok "Webmail HTTPS certificate and route are valid"
else
  bad "Webmail HTTPS certificate or route failed"
fi
if curl -fsS --max-time 10 "https://$MAIL_HOSTNAME/.well-known/mta-sts.txt" | grep -q '^version: STSv1'; then
  ok "Stalwart HTTPS and MTA-STS policy endpoint respond"
else
  bad "Stalwart HTTPS or MTA-STS policy endpoint failed"
fi

cert_pem="$(echo | timeout 10 openssl s_client -connect "$MAIL_HOSTNAME:993" -servername "$MAIL_HOSTNAME" 2>/dev/null \
  | openssl x509 2>/dev/null || true)"
cert_end="$(openssl x509 -noout -enddate 2>/dev/null <<<"$cert_pem" | cut -d= -f2- || true)"
if [[ -n "$cert_pem" ]] && openssl x509 -checkend 1814400 -noout <<<"$cert_pem" >/dev/null 2>&1; then
  ok "Mail TLS certificate is valid for more than 21 days ($cert_end)"
else
  bad "Mail TLS certificate is missing, invalid, or expires within 21 days"
fi

if command -v dig >/dev/null 2>&1; then
  mapfile -t mail_a < <(dig +short A "$MAIL_HOSTNAME")
  printf '%s\n' "${mail_a[@]:-}" | grep -qx "$SERVER_IPV4" && ok "$MAIL_HOSTNAME A points to $SERVER_IPV4" || caution "$MAIL_HOSTNAME A is not published yet"
  dig +short MX "$DOMAIN" | grep -Fq "$MAIL_HOSTNAME." && ok "$DOMAIN MX points to $MAIL_HOSTNAME" || caution "$DOMAIN MX is not cut over"
  dig +short TXT "$DOMAIN" | grep -qi 'v=spf1' && ok "SPF is present" || caution "SPF is missing"
  dig +short TXT "_dmarc.$DOMAIN" | grep -qi 'v=DMARC1' && ok "DMARC is present" || caution "DMARC is missing"
  if [[ -n "${DKIM_SELECTORS:-}" ]]; then
    for selector in $DKIM_SELECTORS; do
      dig +short TXT "$selector._domainkey.$DOMAIN" | grep -qi 'v=DKIM1' \
        && ok "DKIM selector $selector is present" \
        || caution "DKIM selector $selector is missing"
    done
  else
    caution "DKIM_SELECTORS is unset; DKIM DNS checks skipped"
  fi
  dig +short -x "$SERVER_IPV4" | grep -Fxq "$MAIL_HOSTNAME." && ok "PTR matches $MAIL_HOSTNAME" || caution "PTR does not match $MAIL_HOSTNAME"
else
  caution "dig unavailable; DNS checks skipped"
fi

available_kb="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
(( available_kb >= 5242880 )) && ok "At least 5 GiB disk free" || bad "Less than 5 GiB disk free"

printf '\nResult: %d failure(s), %d warning(s)\n' "$errors" "$warnings"
if (( errors > 0 )); then exit 1; fi
if (( warnings > 0 )); then echo 'NOT READY FOR DNS CUTOVER'; exit 2; fi
echo 'READY'
