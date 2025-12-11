# Everlight MCP rollout plan (aetheranalysis.com)

## Domains and routes
- Human-readable logs: `https://mcp.aetheranalysis.com/everlight-context/logs/{filename}` (static HTML/MD).
- API root: `https://api.aetheranalysis.com/mcp/{model_name}` (per-model front door).
  - `/resources` — list resources (uses `index.json`).
  - `/resource/{id}` — stream markdown/HTML for a single log.
  - `/search` — semantic search over `chunks.jsonl` -> Vectorize index.
  - `/health` — lightweight ready check.
- Auth: Bearer token header `Authorization: Bearer <TOKEN>` (token sourced from omni-env.sh e.g., `TINKER_API_KEY` or dedicated `MCP_API_KEY`).
- Future cross-domain linking: allow CORS for `everlightos.com`, `aetherintelligence.net`, `aetherintelligence.vip`, `thesentinelframework.com`.

## Artifacts now available
- `everlight-context/index.json` — 800 logs, enriched metadata (hash, mtime, accounts, tags, summary).
- `everlight-context/chunks.jsonl` — 30k+ chunks (~1.5k chars, 200 overlap) ready for vector ingestion.
- `everlight-context/build_index.py` — reproducible generator; accepts `--base-url`, `--target-chars`, `--overlap`.

## Vector ingestion (Cloudflare Vectorize)
1) One-time: create Vectorize index (e.g., `everlight-memory-context`) via Wrangler or dashboard.
2) Ingest: Worker script reads `chunks.jsonl`, computes embeddings (OpenAI, Claude, Gemini, or local), and upserts `{chunk_id, vector, metadata}` where metadata includes `slug`, `title`, `url`, `accounts`, `tags`, `conversation_id`, `message_count`, `file_sha256`.
3) Search: `/search` endpoint accepts `{query, top_k, filters}` and returns chunk excerpts + source URLs/ids.

## MCP manifest template (per model)
Serve at `https://api.aetheranalysis.com/mcp/<model>/manifest.json`. Example (Claude):
```json
{
  "name": "everlight-memory-context",
  "description": "EverLight conversational memory (logs + semantic search)",
  "version": "1.0.0",
  "schema": 2,
  "capabilities": {
    "resources": {
      "list": true,
      "read": true
    },
    "tools": [
      {
        "name": "search",
        "description": "Semantic search across EverLight logs",
        "input_schema": {
          "type": "object",
          "properties": {
            "query": { "type": "string" },
            "top_k": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 },
            "accounts": { "type": "array", "items": { "type": "string" }, "description": "Optional account filter" },
            "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional tag filter" }
          },
          "required": ["query"]
        }
      }
    ]
  },
  "endpoints": {
    "resources": "https://api.aetheranalysis.com/mcp/claude/resources",
    "resource": "https://api.aetheranalysis.com/mcp/claude/resource/{id}",
    "tools": "https://api.aetheranalysis.com/mcp/claude/tools"
  },
  "auth": {
    "type": "bearer",
    "header": "Authorization"
  }
}
```
Notes:
- Duplicate the manifest per model (`claude`, `openai`, `gemini`, etc.) at the corresponding path; only the endpoint prefix changes.
- Add model-specific defaults inside Worker routing if desired (e.g., preferred embedding model).

## Worker/service layout (next step)
- Wrangler bindings: `VECTORIZE`, `KV_INDEX` (index.json), `KV_MANIFESTS`, `LOG_BUCKET` (R2 or static assets).
- Routes:
  - `/mcp/<model>/resources` -> list from KV `index.json`.
  - `/mcp/<model>/resource/:id` -> stream markdown/HTML (from R2/static).
  - `/mcp/<model>/tools/search` -> vector search.
  - `/mcp/<model>/tools` -> manifest of available tools (search, maybe summarize).
  - `/mcp/<model>/manifest.json` -> served per model using template above.
- Tinker Linker: if `TINKER_API_KEY` exists in env, Worker accepts it as `Authorization: Bearer <key>` and can also proxy embedding calls through the Tinker API if available.

## Operational notes
- Regenerate index/chunks after adding logs: `python3 everlight-context/build_index.py --base-url https://mcp.aetheranalysis.com/everlight-context/logs`.
- Keep PII-aware filters available in `/search` (account/tag filters) and consider redaction before returning excerpts.
- Log search queries minimally (timestamp, model, query hash) to Durable Object for observability without leaking content.

## New support files
- `api/worker.js` — Cloudflare Worker for `/mcp/{model}` (resources, resource fetch, search, manifest).
- `wrangler.mcp.toml` — Worker config targeting `api.aetheranalysis.com/mcp/*` (fill in account/zone/bindings).
- `everlight-context/ingest_vectorize.py` — CLI to upsert `chunks.jsonl` into Cloudflare Vectorize using OpenAI embeddings (config via env).
