#!/usr/bin/env bash
# Baixa a blocklist HaGeZi Pro em formato RPZ (a única fonte real do
# repositório oficial: https://github.com/hagezi/dns-blocklists/tree/main/rpz)
# e salva como zonefile pro Unbound consumir via a diretiva `rpz:`.
#
# Rodar manualmente ou via cron semanal no host do servidor VPN.
#
# ⚠️ Rodar direto na VPS/HomeLab, não neste sandbox de desenvolvimento.

set -euo pipefail

BLOCKLIST_URL="https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt"
OUTPUT="$(dirname "$0")/hagezi-pro.rpz"

curl -fsSL "$BLOCKLIST_URL" -o "$OUTPUT"
echo "Blocklist atualizada em $OUTPUT ($(wc -l < "$OUTPUT") linhas)"
echo "Reinicie o container unbound para aplicar: docker compose restart unbound"
