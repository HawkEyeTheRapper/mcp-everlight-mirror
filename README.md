# Everlight MCP (aetheranalysis.com)

This repo packages the EverLight context logs as an MCP-compatible service with:
- Static human-readable logs at `mcp.aetheranalysis.com/everlight-context/logs`.
- MCP API at `api.aetheranalysis.com/mcp/{model}` exposing `resources`, `resource/{id}`, `tools/search`, and per-model `manifest.json`.
- Vector search backed by Cloudflare Vectorize using the `@cf/baai/bge-base-en-v1.5` embedding model.

## Components
- `everlight-context/logs`: Markdown + HTML logs (~800 entries).
- `everlight-context/build_index.py`: Generates `index.json` and `chunks.jsonl` (chunked text).
- `everlight-context/ingest_vectorize.py`: Embeds chunks and upserts to Cloudflare Vectorize (also supports NDJSON export).
- `api/worker.js`: Cloudflare Worker serving MCP endpoints (resources + search + manifests).
- `wrangler.mcp.toml`: Worker config (bindings, routes).

## Domains / routes
- Human logs (static): `https://mcp.aetheranalysis.com/everlight-context/logs/{filename}`
- MCP API root (per model): `https://api.aetheranalysis.com/mcp/{model}`
  - `GET /resources` — list from KV `index.json`
  - `GET /resource/{id}` — stream markdown from R2
  - `POST /tools/search` — semantic search (Vectorize)
  - `GET /manifest.json` — per-model MCP manifest (resources + search tool)

## Auth
- Worker expects `Authorization: Bearer <token>` when `API_TOKENS` secret is set.
- Local env exports (see `omni-env.sh`):
  - `MCP_API_TOKEN` (for clients)
  - `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (for deploy + Vectorize)
  - `OPEN_AI_API_KEY` (kept for other tooling; search uses CF BGE by default)
- Set/rotate token: `wrangler secret put API_TOKENS --config wrangler.mcp.toml`

## Build and ingest
1) Generate index + chunks (base URL may be overridden):
   ```bash
   cd everlight-context
   python3 build_index.py --base-url https://mcp.aetheranalysis.com/everlight-context/logs
   ```
2) Embed and produce NDJSON (Cloudflare BGE):
   ```bash
   source /mnt/aether_vault/omni-stack/omni-env.sh
   EMBEDDINGS_URL="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/baai/bge-base-en-v1.5" \
   EMBEDDINGS_KEY="$CF_API_TOKEN" \
   python3 ingest_vectorize.py --index everlight-memory-context-bge --batch 64 --sleep 0.05 --out-file vectors.ndjson
   ```
3) Upsert vectors to Vectorize:
   ```bash
   wrangler vectorize upsert everlight-memory-context-bge \
     --file everlight-context/vectors.ndjson \
     --config wrangler.mcp.toml \
     --batch-size 2000
   ```
4) (Optional) Clean NDJSON after upsert:
   ```bash
   rm everlight-context/vectors.ndjson
   ```

## Deploy (Worker)
```bash
source /mnt/aether_vault/omni-stack/omni-env.sh
wrangler deploy --config wrangler.mcp.toml
```
Bindings (in `wrangler.mcp.toml`):
- KV: `INDEX_KV` (b0d040fcab004a8b92d98337e1e19e38)
- R2: `LOG_BUCKET` (everlight-mcp-logs)
- Vectorize: `VECTORIZE` (everlight-memory-context-bge)
- Vars: `INDEX_URL`, `LOG_BASE_URL`, `API_BASE`

## MCP manifests (per model)
Served at `https://api.aetheranalysis.com/mcp/<model>/manifest.json`. Endpoints inside the manifest are model-prefixed. Tools:
- `search` input schema: `{ query: string, top_k?: int (1-20, default 5), accounts?: string[], tags?: string[] }`

## Client usage examples
- List resources:
  ```bash
  curl -H "Authorization: Bearer $MCP_API_TOKEN" \
    https://api.aetheranalysis.com/mcp/claude/resources
  ```
- Fetch a resource:
  ```bash
  curl -H "Authorization: Bearer $MCP_API_TOKEN" \
    https://api.aetheranalysis.com/mcp/claude/resource/10-legal-placeholder-meaning-6843065f-eda8-8011-88fe-1dbc795cbbc8
  ```
- Search:
  ```bash
  curl -H "Authorization: Bearer $MCP_API_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST https://api.aetheranalysis.com/mcp/claude/tools/search \
    -d '{"query":"everlight codex federation diagram","top_k":5,"accounts":["Account1_exports"]}'
  ```

## Notes
- Vector index uses BGE (1024 dims); Worker handles Cloudflare AI run responses.
- `ingest_vectorize.py` falls back to NDJSON export if you want to upsert via CLI instead of direct API calls.
- Avoid committing secrets; tokens live in Wrangler secrets and `omni-env.sh`.
