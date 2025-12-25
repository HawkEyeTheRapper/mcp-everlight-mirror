#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOGS_DIR="${LOGS_DIR:-$ROOT/everlight-context/logs}"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"

SITE_TITLE="${SITE_TITLE:-EverLight Context Logs}"
SITE_SUBTITLE="${SITE_SUBTITLE:-HTML archive for Pages (generated index + navigation)}"
BASE_URL="https://mcp.aetheranalysis.com/everlight-context/logs"

if [[ ! -d "$LOGS_DIR" ]]; then
  echo "❌ Logs folder not found: $LOGS_DIR" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

echo "🧹 Step 0: Clear dist/"
rm -rf "$DIST_DIR"/*
mkdir -p "$DIST_DIR"

echo "🚚 Step 1: Copy all .html and .md from logs/ -> dist/"
shopt -s nullglob
html_files=("$LOGS_DIR"/*.html)
md_files=("$LOGS_DIR"/*.md)

if (( ${#html_files[@]} > 0 )); then
  cp -f "$LOGS_DIR"/*.html "$DIST_DIR"/
  echo "✅ Copied ${#html_files[@]} HTML files into dist/"
else
  echo "⚠️ No .html files found in: $LOGS_DIR"
fi

if (( ${#md_files[@]} > 0 )); then
  cp -f "$LOGS_DIR"/*.md "$DIST_DIR"/
  echo "✅ Copied ${#md_files[@]} Markdown files into dist/"
else
  echo "⚠️ No .md files found in: $LOGS_DIR"
fi
shopt -u nullglob

echo "🧭 Step 2: Generate dist/index.html (links + search)"
export DIST_DIR SITE_TITLE SITE_SUBTITLE
python3 - <<'PY'
import os, html, re
from datetime import datetime, timezone

dist = os.environ["DIST_DIR"]
title = os.environ.get("SITE_TITLE", "EverLight Context Logs")
subtitle = os.environ.get("SITE_SUBTITLE", "")

files = [f for f in os.listdir(dist) if f.lower().endswith(".html") and f.lower() != "index.html"]
files.sort(key=lambda s: s.lower())

def nice_name(fn: str) -> str:
    return re.sub(r"\.html$", "", fn, flags=re.I)

now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

items = [(f, nice_name(f)) for f in files]

out = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
      color-scheme: light dark;
    }}
    body {{ margin: 0; padding: 0; }}
    header {{ padding: 24px 18px; border-bottom: 1px solid rgba(127,127,127,.3); }}
    h1 {{ margin: 0 0 6px 0; font-size: 22px; }}
    p {{ margin: 0; opacity: .85; }}
    main {{ padding: 18px; max-width: 1100px; margin: 0 auto; }}
    .controls {{ display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 18px 0; }}
    input {{
      padding: 10px 12px; font-size: 14px;
      min-width: 260px; flex: 1;
      border-radius: 10px;
      border: 1px solid rgba(127,127,127,.35);
      background: transparent;
    }}
    .meta {{ font-size: 12px; opacity: .75; }}
    ul {{ list-style: none; padding: 0; margin: 0; }}
    li {{
      padding: 10px 12px;
      border: 1px solid rgba(127,127,127,.25);
      border-radius: 12px;
      margin-bottom: 10px;
    }}
    a {{ text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .count {{ font-weight: 600; }}
    footer {{ padding: 18px; opacity: .7; font-size: 12px; }}
    code {{ opacity: .85; }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(title)}</h1>
    <p>{html.escape(subtitle)}</p>
    <p class="meta">Generated: {now} • Showing: <span class="count" id="count"></span></p>
  </header>

  <main>
    <div class="controls">
      <input id="q" type="search" placeholder="Search titles… (type to filter)" autocomplete="off" />
    </div>

    <ul id="list">
"""

for f, label in items:
    out += f'      <li data-title="{html.escape(label).lower()}"><a href="{html.escape(f)}">{html.escape(label)}</a></li>\n'

out += """    </ul>
  </main>

  <footer>
    Deploy this <code>dist/</code> folder to Pages. (No Worker required.)
  </footer>

  <script>
    const q = document.getElementById('q');
    const list = document.getElementById('list');
    const count = document.getElementById('count');
    const items = Array.from(list.querySelectorAll('li'));

    function update() {
      const needle = (q.value || '').trim().toLowerCase();
      let shown = 0;
      for (const li of items) {
        const t = li.getAttribute('data-title') || '';
        const ok = !needle || t.includes(needle);
        li.style.display = ok ? '' : 'none';
        if (ok) shown++;
      }
      count.textContent = shown + " / " + items.length;
    }
    q.addEventListener('input', update);
    update();
  </script>
</body>
</html>
"""

with open(os.path.join(dist, "index.html"), "w", encoding="utf-8") as f:
    f.write(out)

print(f"✅ Wrote {os.path.join(dist, 'index.html')} with {len(items)} links.")
PY

echo "🗺️ Step 3: Generate sitemap.xml"
export DIST_DIR BASE_URL
python3 - <<'PY_SITEMAP'
import os, html
from datetime import datetime, timezone

dist = os.environ["DIST_DIR"]
base_url = os.environ["BASE_URL"]

files = [f for f in os.listdir(dist) if f.lower().endswith((".html", ".md"))]
files.sort(key=lambda s: s.lower())

now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

for f in files:
    url = f"{base_url}/{html.escape(f)}"
    sitemap += f"  <url>\n    <loc>{url}</loc>\n    <lastmod>{now}</lastmod>\n  </url>\n"

sitemap += '</urlset>\n'

with open(os.path.join(dist, "sitemap.xml"), "w", encoding="utf-8") as f:
    f.write(sitemap)

print(f"✅ Wrote {os.path.join(dist, 'sitemap.xml')} with {len(files)} URLs.")
PY_SITEMAP

echo "✅ Done. dist/ is Pages-ready."
echo "   - Files copied to: $DIST_DIR"
