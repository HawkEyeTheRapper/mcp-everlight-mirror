#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.everlight-mirror}"

cd "$ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Env file not found: $ENV_FILE" >&2
  echo "   Run: ./scripts/extract-omni-env-to-dotenv.sh ... $ENV_FILE" >&2
  exit 1
fi

# Load env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Ensure venv + deps (best-effort)
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -U pip >/dev/null

if [[ -f "requirements.txt" ]]; then
  pip install -r requirements.txt >/dev/null
else
  pip install requests beautifulsoup4 lxml python-dotenv >/dev/null
fi

# Sanity checks
command -v wrangler >/dev/null || { echo "❌ wrangler not found in PATH"; exit 1; }

: "${CLOUDFLARE_ACCOUNT_ID:?missing}"
: "${CF_API_TOKEN:?missing}"
: "${VECTORIZE_INDEX:?missing}"
: "${EMBEDDINGS_URL:?missing}"
: "${LOG_BASE_URL:?missing}"

echo "🔧 Step 1: build index + chunks"
pushd everlight-context >/dev/null
python3 build_index.py --base-url "$LOG_BASE_URL"
popd >/dev/null

echo "🧠 Step 2: embed + write vectors.ndjson (this can take a while on big corpora)"
export EMBEDDINGS_KEY="$CF_API_TOKEN"
python3 everlight-context/ingest_vectorize.py \
  --index "$VECTORIZE_INDEX" \
  --batch 64 \
  --sleep 0.05 \
  --out-file everlight-context/vectors.ndjson

echo "☁️ Step 3: upsert Vectorize"
wrangler vectorize upsert "$VECTORIZE_INDEX" \
  --file everlight-context/vectors.ndjson \
  --config wrangler.mcp.toml \
  --batch-size 2000

echo "🚀 Step 4: deploy Worker"
wrangler deploy --config wrangler.mcp.toml

echo "✅ Done."
