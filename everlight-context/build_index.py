"""
Richer index + chunk builder for the EverLight context logs.

Outputs:
- index.json: per-file metadata (id/slug/title/urls/tags/summary/accounts/message_count/hash/mtime/size).
- chunks.jsonl: chunked text segments ready for vector ingestion (Vectorize, Qdrant, etc.).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Sequence
from urllib.parse import quote


BASE_URL_DEFAULT = "https://mcp.aetheranalysis.com/everlight-context/logs"
LOGS_DIR = Path(__file__).parent / "logs"
RECORDS_PATH = Path(__file__).parent / "records.json"
INDEX_PATH = Path(__file__).parent / "index.json"
CHUNKS_PATH = Path(__file__).parent / "chunks.jsonl"


@dataclass
class Record:
    slug: str
    title: str
    filename: str
    conversation_id: Optional[str]
    accounts: List[str]
    tags: List[str]
    message_count: Optional[int]
    summary: Optional[str]

    @classmethod
    def from_dict(cls, data: dict) -> "Record":
        return cls(
            slug=data.get("slug") or Path(data["filename"]).stem,
            title=data.get("title") or Path(data["filename"]).stem.replace("_", " ").replace("-", " "),
            filename=data["filename"],
            conversation_id=data.get("conversation_id"),
            accounts=data.get("accounts") or [],
            tags=data.get("tags") or [],
            message_count=data.get("message_count"),
            summary=data.get("summary"),
        )


def load_records() -> dict:
    with open(RECORDS_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    records = {}
    for entry in raw:
        rec = Record.from_dict(entry)
        records[rec.filename] = rec
    return records


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def chunk_text(text: str, target_chars: int = 1500, overlap: int = 200) -> List[str]:
    """
    Basic character-based chunker with paragraph awareness and overlap for better recall.
    """
    # Normalize newlines and trim
    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: List[str] = []
    buf: List[str] = []

    def flush():
        if buf:
            chunks.append("\n\n".join(buf).strip())
            buf.clear()

    for para in paragraphs:
        next_len = sum(len(p) for p in buf) + len(buf) * 2 + len(para)
        if next_len > target_chars and buf:
            flush()
        buf.append(para)
    flush()

    # Apply overlap between chunks
    if overlap > 0 and len(chunks) > 1:
        overlapped: List[str] = []
        for i, chunk in enumerate(chunks):
            if i == 0:
                overlapped.append(chunk)
            else:
                prev_tail = chunks[i - 1][-overlap:]
                overlapped.append(prev_tail + "\n\n" + chunk)
        chunks = overlapped
    return chunks


def build_index(base_url: str, records: dict) -> List[dict]:
    entries = []
    for path in sorted(LOGS_DIR.glob("*.md"), key=lambda p: p.name.lower()):
        rec: Optional[Record] = records.get(path.name)
        slug = rec.slug if rec else path.stem
        title = rec.title if rec else path.stem.replace("_", " ").replace("-", " ")
        url = f"{base_url}/{quote(path.name)}"
        stat = path.stat()
        entries.append(
            {
                "id": slug,
                "slug": slug,
                "title": title,
                "file": str(path),
                "url": url,
                "tags": (rec.tags if rec else []) + ["everlight-log"],
                "accounts": rec.accounts if rec else [],
                "conversation_id": rec.conversation_id if rec else None,
                "message_count": rec.message_count if rec else None,
                "summary": rec.summary if rec else None,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "sha256": sha256_file(path),
            }
        )
    return entries


def build_chunks(entries: Sequence[dict], records: dict) -> List[dict]:
    chunks = []
    for entry in entries:
        path = Path(entry["file"])
        text = path.read_text(encoding="utf-8", errors="replace")
        parts = chunk_text(text)
        for i, part in enumerate(parts):
            rec: Optional[Record] = records.get(path.name)
            chunk_id = f"{entry['slug']}:{i}"
            chunks.append(
                {
                    "chunk_id": chunk_id,
                    "chunk_index": i,
                    "slug": entry["slug"],
                    "title": entry["title"],
                    "url": entry["url"],
                    "path": str(path),
                    "accounts": rec.accounts if rec else [],
                    "tags": entry["tags"],
                    "message_count": entry.get("message_count"),
                    "conversation_id": entry.get("conversation_id"),
                    "text": part,
                    "char_count": len(part),
                    "file_sha256": entry["sha256"],
                }
            )
    return chunks


def main():
    parser = argparse.ArgumentParser(description="Build index.json and chunks.jsonl for everlight-context.")
    parser.add_argument("--base-url", default=os.getenv("BASE_URL", BASE_URL_DEFAULT), help="Base URL for published logs.")
    parser.add_argument("--target-chars", type=int, default=1500, help="Target characters per chunk.")
    parser.add_argument("--overlap", type=int, default=200, help="Character overlap between chunks.")
    parser.add_argument("--chunks-path", default=CHUNKS_PATH, help="Where to write chunks.jsonl")
    parser.add_argument("--index-path", default=INDEX_PATH, help="Where to write index.json")
    args = parser.parse_args()

    records = load_records()
    entries = build_index(args.base_url, records)

    with open(args.index_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    chunks = build_chunks(entries, records)
    with open(args.chunks_path, "w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")

    print(f"Wrote {len(entries)} entries to {args.index_path}")
    print(f"Wrote {len(chunks)} chunks to {args.chunks_path}")


if __name__ == "__main__":
    main()
