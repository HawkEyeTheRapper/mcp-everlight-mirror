#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="${1:-dist}"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌ dist directory not found: $DIST_DIR"
  exit 1
fi

mapfile -t FILES < <(ls "$DIST_DIR"/*.html | sed 's#.*/##' | sort)

TOTAL=${#FILES[@]}
echo "🔗 Injecting nav into $TOTAL HTML files"

nav_for () {
  local prev="$1"
  local curr="$2"
  local next="$3"

  cat <<EOF
<nav class="everlight-nav">
  <a class="prev" href="$prev">⟵ Previous</a>
  <a class="index" href="index.html">🏠 Index</a>
  <a class="next" href="$next">Next ⟶</a>
</nav>
EOF
}

for i in "${!FILES[@]}"; do
  file="${FILES[$i]}"
  path="$DIST_DIR/$file"

  prev="index.html"
  next="index.html"

  (( i > 0 )) && prev="${FILES[$((i-1))]}"
  (( i < TOTAL-1 )) && next="${FILES[$((i+1))]}"

  NAV="$(nav_for "$prev" "$file" "$next")"

  # Skip if nav already injected
  if grep -q 'everlight-nav' "$path"; then
    continue
  fi

  # Inject nav right after <body>
  perl -0777 -i -pe "s|<body([^>]*)>|<body\$1>\n$NAV|i" "$path"
done

# Add basic styling once (append to each page if not present)
for file in "$DIST_DIR"/*.html; do
  if ! grep -q 'everlight-nav-style' "$file"; then
    perl -0777 -i -pe 's|</head>|<style id="everlight-nav-style">
      .everlight-nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        margin-bottom: 20px;
        border-bottom: 1px solid rgba(127,127,127,.3);
        font-family: system-ui, sans-serif;
      }
      .everlight-nav a {
        text-decoration: none;
        font-weight: 600;
        opacity: .9;
      }
      .everlight-nav a:hover {
        text-decoration: underline;
        opacity: 1;
      }
    </style>
</head>|i' "$file"
  fi
done

echo "✅ Navigation injected."
