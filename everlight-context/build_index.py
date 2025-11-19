from pathlib import Path
import json
import urllib.parse

BASE_URL = "https://ai.everlightos.com/everlight-context/logs"
LOGS_DIR = Path("logs")

entries = []

for path in sorted(LOGS_DIR.glob("*.md")):
    # Basic ID from filename (without extension)
    log_id = path.stem

    # Human-ish title from filename
    title = path.stem.replace("_", " ").replace("-", " ")

    # URL-encode the filename for the canonical URL
    url_name = urllib.parse.quote(path.name)
    url = f"{BASE_URL}/{url_name}"

    entries.append({
        "id": log_id,
        "file": str(path),
        "url": url,
        "title": title,
        "tags": ["everlight-log"]
    })

with open("index.json", "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=2)

print("Wrote index.json with", len(entries), "entries.")
