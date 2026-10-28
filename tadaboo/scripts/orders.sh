#!/usr/bin/env bash
# Owner access to the TadaBoo order inbox (Cloudflare Worker tadaboo-orders).
#
#   bash tadaboo/scripts/orders.sh list [new|won|rejected] > leads.json   orders as JSON ({data:[...]})
#   bash tadaboo/scripts/orders.sh status <TB-…id> won|rejected|new      mark one order
#
# Needs ~/.tadaboo/orders.env (never committed), or the same two variables in the environment:
#   TADABOO_ORDERS_URL="https://tadaboo-orders.<account>.workers.dev"
#   TADABOO_ORDERS_TOKEN="<the ADMIN_TOKEN secret>"
set -euo pipefail
env="$HOME/.tadaboo/orders.env"
[ -n "${TADABOO_ORDERS_TOKEN:-}" ] || { [ -f "$env" ] && source "$env"; }
: "${TADABOO_ORDERS_URL:?set TADABOO_ORDERS_URL (in $env)}"; : "${TADABOO_ORDERS_TOKEN:?set TADABOO_ORDERS_TOKEN (in $env)}"
auth=(-H "Authorization: Bearer $TADABOO_ORDERS_TOKEN")
case "${1:-}" in
  list)   curl -fsS "${auth[@]}" "$TADABOO_ORDERS_URL/orders${2:+?status=$2}" ;;
  status) [[ "${2:-}" =~ ^TB-[0-9]{6}-[A-Z0-9]{4}$ ]] || { echo "bad order id"; exit 2; }
          curl -fsS "${auth[@]}" -H 'content-type: application/json' -d "{\"status\":\"${3:?status}\"}" "$TADABOO_ORDERS_URL/orders/$2/status"; echo ;;
  *) sed -n 2,10p "$0"; exit 2 ;;
esac
