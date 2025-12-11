// Cloudflare Worker for EverLight MCP endpoints
// Routes: /mcp/:model/resources, /mcp/:model/resource/:id, /mcp/:model/tools/search, /mcp/:model/manifest.json

const DEFAULT_INDEX_URL = 'https://mcp.aetheranalysis.com/everlight-context/index.json';
const DEFAULT_LOG_BASE = 'https://mcp.aetheranalysis.com/everlight-context/logs';
const INDEX_KV_KEY = 'index.json';

let indexCache = null;
let indexCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'mcp' || parts.length < 2) {
      return new Response('Not found', { status: 404 });
    }
    const model = parts[1];
    const tail = parts.slice(2);

    const auth = authorize(request, env);
    if (!auth.ok) return auth.resp;

    // /mcp/:model/manifest.json
    if (tail.length === 1 && tail[0] === 'manifest.json') {
      return manifestResponse(model, env);
    }

    // /mcp/:model/resources
    if (tail.length === 1 && tail[0] === 'resources') {
      const index = await loadIndex(env);
      return json(index);
    }

    // /mcp/:model/resource/:id
    if (tail.length === 2 && tail[0] === 'resource') {
      const id = decodeURIComponent(tail[1]);
      return handleResource(id, env);
    }

    // /mcp/:model/tools/search
    if (tail.length === 2 && tail[0] === 'tools' && tail[1] === 'search') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleSearch(request, env);
    }

    // /mcp/:model/tools -> list tools
    if (tail.length === 1 && tail[0] === 'tools') {
      return json({ tools: ['search'] });
    }

    return new Response('Not found', { status: 404 });
  },
};

function authorize(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^[Bb]earer\s+/i, '').trim();
  const allowed = (env.API_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (allowed.length === 0) return { ok: true };
  if (!token || !allowed.includes(token)) {
    return { ok: false, resp: new Response('Unauthorized', { status: 401 }) };
  }
  return { ok: true };
}

async function loadIndex(env) {
  const now = Date.now();
  if (indexCache && now - indexCacheAt < CACHE_TTL_MS) return indexCache;

  // Try KV first
  if (env.INDEX_KV) {
    const kvData = await env.INDEX_KV.get(INDEX_KV_KEY);
    if (kvData) {
      indexCache = JSON.parse(kvData);
      indexCacheAt = now;
      return indexCache;
    }
  }

  // Fallback to remote URL
  const indexUrl = env.INDEX_URL || DEFAULT_INDEX_URL;
  const resp = await fetch(indexUrl);
  if (!resp.ok) throw new Error(`Failed to fetch index: ${resp.status}`);
  indexCache = await resp.json();
  indexCacheAt = now;
  return indexCache;
}

async function handleResource(id, env) {
  const index = await loadIndex(env);
  const match = index.find((e) => e.id === id || e.slug === id);
  if (!match) return new Response('Not found', { status: 404 });

  // Prefer direct fetch from configured log base URL; fall back to R2 if bound
  const base = env.LOG_BASE_URL || DEFAULT_LOG_BASE;
  const fileName = match.file ? match.file.split('/').pop() : `${id}.md`;
  const url = `${base}/${encodeURIComponent(fileName)}`;

  // If R2 bucket is bound, try it first
  if (env.LOG_BUCKET) {
    const obj = await env.LOG_BUCKET.get(fileName);
    if (obj) {
      const headers = { 'content-type': 'text/markdown; charset=utf-8' };
      return new Response(obj.body, { headers });
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) return new Response('Failed to fetch resource', { status: 502 });
  const headers = new Headers(resp.headers);
  headers.set('cache-control', 'public, max-age=300');
  return new Response(resp.body, { headers });
}

async function handleSearch(request, env) {
  const body = await request.json();
  const query = (body.query || '').trim();
  const topK = clampInt(body.top_k, 5, 1, 20);
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  const tags = Array.isArray(body.tags) ? body.tags : [];

  if (!query) return new Response('Missing query', { status: 400 });

  if (!env.VECTORIZE) {
    return json(
      {
        error: 'Vector search not configured',
        hint: 'Bind VECTORIZE and embedding secrets to enable search.',
      },
      501
    );
  }

  const vector = await embedQuery(query, env);
  const filter = buildFilter(accounts, tags);
  const options = { topK, returnMetadata: true };
  if (filter) options.filter = filter;

  const results = await env.VECTORIZE.query(vector, options);
  // Expected shape: { matches: [{id, score, metadata}] }
  const data = (results.matches || []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata || {},
  }));
  return json({ query, top_k: topK, results: data });
}

function buildFilter(accounts, tags) {
  const must = [];
  if (accounts.length) {
    must.push({ key: 'accounts', any: accounts });
  }
  if (tags.length) {
    must.push({ key: 'tags', any: tags });
  }
  if (!must.length) return null;
  return { must };
}

async function embedQuery(text, env) {
  const endpoint = env.EMBEDDINGS_URL || 'https://api.openai.com/v1/embeddings';
  const model = env.EMBEDDINGS_MODEL || 'text-embedding-ada-002'; // default OpenAI-style
  const apiKey = env.EMBEDDINGS_KEY || env.OPENAI_API_KEY || env.OPENAI_KEY;
  if (!apiKey) throw new Error('Missing EMBEDDINGS_KEY / OPENAI_API_KEY');

  // Cloudflare AI run endpoint
  if (endpoint.includes('cloudflare.com/client/v4/accounts') && endpoint.includes('/ai/run/')) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text: [text] }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`Embedding error ${resp.status}: ${detail}`);
    }
    const data = await resp.json();
    const vector = data.result?.data?.[0];
    if (!Array.isArray(vector)) throw new Error('Embedding response missing vector');
    return vector;
  }

  // OpenAI-style
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text, model }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Embedding error ${resp.status}: ${detail}`);
  }
  const data = await resp.json();
  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error('Embedding response missing vector');
  return vector;
}

function manifestResponse(model, env) {
  const base = env.API_BASE || 'https://api.aetheranalysis.com';
  const root = `${base}/mcp/${model}`;
  const manifest = {
    name: 'everlight-memory-context',
    description: 'EverLight conversational memory (logs + semantic search)',
    version: '1.0.0',
    schema: 2,
    capabilities: {
      resources: { list: true, read: true },
      tools: [
        {
          name: 'search',
          description: 'Semantic search across EverLight logs',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              top_k: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
              accounts: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['query'],
          },
        },
      ],
    },
    endpoints: {
      resources: `${root}/resources`,
      resource: `${root}/resource/{id}`,
      tools: `${root}/tools`,
      search: `${root}/tools/search`,
    },
    auth: {
      type: 'bearer',
      header: 'Authorization',
    },
  };
  return json(manifest);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function clampInt(val, fallback, min, max) {
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
