#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env

action="${1:-help}"
case "$action" in
  list)
    stalwart_cli query Account --fields id,name,domainId
    ;;
  add)
    address="${2:-}"; password="${3:-}"
    [[ "$address" == *@"$DOMAIN" ]] || fail "Address must belong to $DOMAIN"
    [[ -n "$password" ]] || fail "Usage: ./navin-mail user add user@$DOMAIN '<initial-password>'"
    localpart="${address%@*}"
    domain_json="$(stalwart_cli query Domain --where "name=$DOMAIN" --fields id,name --json)"
    domain_id="$(printf '%s\n' "$domain_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get("items",d.get("list",[])); print(rows[0]["id"] if rows else "")')"
    [[ -n "$domain_id" ]] || fail "Domain $DOMAIN not found in Stalwart"
    stalwart_cli create Account/User \
      --field "name=$localpart" \
      --field "domainId=$domain_id" \
      --field "credentials={\"0\":{\"@type\":\"Password\",\"secret\":\"$password\"}}" \
      --field 'memberGroupIds={}' \
      --field 'roles={"@type":"User"}' \
      --field 'permissions={"@type":"Inherit"}' \
      --field 'quotas={}' \
      --field 'aliases={}' \
      --field 'encryptionAtRest={"@type":"Disabled"}'
    ;;
  help|-h|--help)
    echo "Usage: ./navin-mail user list | ./navin-mail user add user@$DOMAIN '<initial-password>'"
    ;;
  *) fail "Unknown user action: $action" ;;
esac
