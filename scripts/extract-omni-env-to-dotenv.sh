#!/usr/bin/env bash
set -euo pipefail

OMNI_ENV="${1:-/mnt/aether_vault/omni-stack/omni-env.sh}"
OUT="${2:-.env.everlight-mirror}"

if [[ ! -f "$OMNI_ENV" ]]; then
  echo "❌ omni-env.sh not found at: $OMNI_ENV" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$OMNI_ENV"

# Try common names (you may have one of these in your omni-env)
CF_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
CF_API_TOKEN="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"

if [[ -z "${CF_ACCOUNT_ID}" ]]; then
  echo "❌ Missing CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID) in omni-env.sh" >&2
  exit 1
fi

if [[ -z "${CF_API_TOKEN}" ]]; then
  echo "❌ Missing CF_API_TOKEN (or CLOUDFLARE_API_TOKEN) in omni-env.sh" >&2
  exit 1
fi

cat > "$OUT" <<EOF
# Generated from: $OMNI_ENV
CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
CF_API_TOKEN="$CF_API_TOKEN"

# Evidence corpus routing (adjust if you change hosting)
INDEX_URL="https://mcp.aetheranalysis.com/everlight-context/index.json"
LOG_BASE_URL="https://mcp.aetheranalysis.com/everlight-context/logs"
API_BASE="https://api.aetheranalysis.com"

# Vectorize index (must exist)
VECTORIZE_INDEX="everlight-memory-context-bge"

# Cloudflare AI embeddings endpoint (BGE)
EMBEDDINGS_MODEL="@cf/baai/bge-base-en-v1.5"
EMBEDDINGS_URL="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/run/\$EMBEDDINGS_MODEL"
EOF

chmod 600 "$OUT"
echo "✅ Wrote $OUT"
