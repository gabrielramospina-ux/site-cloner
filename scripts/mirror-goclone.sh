#!/usr/bin/env bash
# Espelho rápido via Goclone (bom para sites estáticos / HTML clássico).
# Uso: npm run clone:goclone -- https://exemplo.com
set -euo pipefail

URL="${1:-}"
OUT_ROOT="$(cd "$(dirname "$0")/.." && pwd)/output"

if [[ -z "$URL" ]]; then
  echo "Uso: npm run clone:goclone -- <url>" >&2
  exit 1
fi

if ! command -v goclone >/dev/null 2>&1; then
  echo "goclone não encontrado. Instale com:" >&2
  echo "  go install github.com/goclone-dev/goclone/cmd/goclone@latest" >&2
  echo "e garanta que \$(go env GOPATH)/bin está no PATH." >&2
  exit 1
fi

HOST="$(node -e "console.log(new URL(process.argv[1]).hostname.replace(/^www\\./,''))" "$URL")"
DEST="$OUT_ROOT/goclone-$HOST"
mkdir -p "$DEST"
cd "$DEST"

echo "→ Goclone: $URL"
echo "→ Saída:   $DEST"
goclone "$URL"
echo "Pronto. Abra os arquivos HTML em $DEST"
