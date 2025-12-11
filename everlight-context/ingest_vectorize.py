"""
Ingest everlight-context chunks into Cloudflare Vectorize.

Prereqs:
  pip install requests
  export OPENAI_API_KEY=...
  export CF_ACCOUNT_ID=...
  export CF_API_TOKEN=...  # with Vectorize write scope

Example:
  python3 ingest_vectorize.py --index everlight-memory-context --chunks chunks.jsonl --batch 64
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import List
import hashlib

import requests


def parse_args():
    p = argparse.ArgumentParser(description="Ingest chunks.jsonl into Cloudflare Vectorize.")
    p.add_argument("--chunks", default="chunks.jsonl", help="Path to chunks.jsonl")
    p.add_argument("--index", required=True, help="Vectorize index name")
    p.add_argument("--batch", type=int, default=64, help="Batch size for embeddings/upsert")
    p.add_argument("--sleep", type=float, default=0.0, help="Sleep seconds between batches")
    p.add_argument("--dry-run", action="store_true", help="Parse only; do not embed or upsert")
    p.add_argument("--embed-model", default=os.getenv("EMBEDDINGS_MODEL", "text-embedding-ada-002"))
    p.add_argument("--embed-url", default=os.getenv("EMBEDDINGS_URL", "https://api.openai.com/v1/embeddings"))
    p.add_argument("--out-file", help="If set, write vectors to this NDJSON file instead of upserting")
    return p.parse_args()


def load_chunks(path: str):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            yield json.loads(line)


def embed(texts: List[str], model: str, url: str, api_key: str, retries: int = 3, backoff: float = 2.0) -> List[List[float]]:
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            # Cloudflare AI run endpoint: expects {"text": ["..."]} and returns result.data
            if "cloudflare.com/client/v4/accounts" in url and "/ai/run/" in url:
                payload = {"text": texts}
                resp = requests.post(url, headers=headers, json=payload, timeout=120)
                if resp.status_code == 200:
                    data = resp.json()["result"]["data"]
                    return data
            else:
                payload = {"input": texts, "model": model}
                resp = requests.post(url, headers=headers, json=payload, timeout=120)
                if resp.status_code == 200:
                    data = resp.json()["data"]
                    return [d["embedding"] for d in data]
            last_err = RuntimeError(f"Embedding failed {resp.status_code}: {resp.text}")
        except Exception as exc:  # network or JSON issues
            last_err = exc
        if attempt < retries:
            time.sleep(backoff * attempt)
    raise last_err


def upsert(cf_account_id: str, cf_token: str, index_name: str, vectors: List[dict]):
    # Vectorize v1 upsert endpoint
    url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account_id}/vectorize/v1/indexes/{index_name}/upsert"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {cf_token}",
            "Content-Type": "application/json",
        },
        json={"vectors": vectors},
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Upsert failed {resp.status_code}: {resp.text}")
    return resp.json()


def main():
    args = parse_args()
    cf_account = os.getenv("CF_ACCOUNT_ID")
    cf_token = os.getenv("CF_API_TOKEN")
    openai_key = os.getenv("EMBEDDINGS_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")

    if not args.dry_run and not args.out_file and (not cf_account or not cf_token):
        sys.exit("Missing CF_ACCOUNT_ID or CF_API_TOKEN")
    if not args.dry_run and not openai_key:
        sys.exit("Missing EMBEDDINGS_KEY / OPENAI_API_KEY")

    batch = []
    count = 0
    t0 = time.time()

    for chunk in load_chunks(args.chunks):
        batch.append(chunk)
        if len(batch) >= args.batch:
            count += process_batch(batch, args, cf_account, cf_token, openai_key)
            batch = []
            if args.sleep:
                time.sleep(args.sleep)
    if batch:
        count += process_batch(batch, args, cf_account, cf_token, openai_key)

    elapsed = time.time() - t0
    print(f"Done. Processed {count} chunks in {elapsed:.1f}s")


def process_batch(batch: List[dict], args, cf_account, cf_token, openai_key):
    texts = [b["text"] for b in batch]
    if args.dry_run:
        print(f"[dry-run] would embed+upsert {len(batch)} vectors")
        return len(batch)

    vectors = embed(texts, args.embed_model, args.embed_url, openai_key)
    payload = []
    for b, v in zip(batch, vectors):
        # Ensure id length <= 64 bytes for Vectorize
        raw_id = b.get("chunk_id") or b.get("slug") or "chunk"
        short_id = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()  # 40 chars
        meta = {
            "slug": b.get("slug"),
            "title": b.get("title"),
            "url": b.get("url"),
            "accounts": b.get("accounts") or [],
            "tags": b.get("tags") or [],
            "conversation_id": b.get("conversation_id"),
            "message_count": b.get("message_count"),
            "file_sha256": b.get("file_sha256"),
        }
        payload.append({"id": short_id, "values": v, "metadata": meta})

    if args.out_file:
        with open(args.out_file, "a", encoding="utf-8") as f:
            for item in payload:
                f.write(json.dumps(item))
                f.write("\n")
        print(f"Wrote {len(payload)} vectors -> {args.out_file}")
        return len(payload)

    res = upsert(cf_account, cf_token, args.index, payload)
    if not res.get("success"):
        raise RuntimeError(f"Upsert reported failure: {res}")
    print(f"Upserted {len(payload)} vectors -> {args.index}")
    return len(payload)


if __name__ == "__main__":
    main()
