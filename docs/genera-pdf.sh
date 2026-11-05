#!/usr/bin/env bash
# Genera un PDF a partir d'un Markdown (taules, català i blocs mermaid).
# Ús: ./genera-pdf.sh [entrada.md] [sortida.pdf]
# Per defecte: especificacio.md del mateix directori -> especificacio.pdf

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Ús: $0 [entrada.md] [sortida.pdf]"
  echo "Per defecte converteix especificacio.md en especificacio.pdf."
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${1:-$ROOT/especificacio.md}"

if [[ ! -f "$INPUT" ]]; then
  echo "No es troba el fitxer: $INPUT" >&2
  exit 1
fi

INPUT="$(readlink -f "$INPUT")"
if [[ $# -ge 2 ]]; then
  OUTPUT="$2"
else
  OUTPUT="${INPUT%.md}.pdf"
fi
mkdir -p "$(dirname "$OUTPUT")"
OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"

find_bin() {
  local name
  for name in "$@"; do
    if command -v "$name" >/dev/null 2>&1; then
      command -v "$name"
      return 0
    fi
  done
  return 1
}

PANDOC="$(find_bin pandoc || true)"
CHROME="$(find_bin google-chrome google-chrome-stable chromium chromium-browser || true)"

if [[ -z "$PANDOC" ]]; then
  echo "Cal tenir pandoc instal·lat." >&2
  exit 1
fi
if [[ -z "$CHROME" ]]; then
  echo "Cal tenir Google Chrome o Chromium instal·lat." >&2
  exit 1
fi

MERMAID_VERSION="10.9.3"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/acap-md-pdf"
MERMAID_JS="$CACHE_DIR/mermaid.min.js"
mkdir -p "$CACHE_DIR"
if [[ ! -s "$MERMAID_JS" ]]; then
  echo "Descarregant mermaid ${MERMAID_VERSION}..."
  curl -fsSL -o "$MERMAID_JS" \
    "https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js"
fi

WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

cp "$MERMAID_JS" "$WORKDIR/mermaid.min.js"

"$PANDOC" "$INPUT" -t html --wrap=none -o "$WORKDIR/body.html"

python3 - "$WORKDIR" << 'PY'
import re
import sys
from pathlib import Path

workdir = Path(sys.argv[1])
body = (workdir / "body.html").read_text(encoding="utf-8")
body = re.sub(
    r'<pre class="mermaid"><code>(.*?)</code></pre>',
    lambda m: '<div class="mermaid">' + m.group(1) + "</div>",
    body,
    flags=re.S,
)

html = """<!DOCTYPE html>
<html lang="ca">
<head>
<meta charset="utf-8">
<title>Especificació</title>
<script src="mermaid.min.js"></script>
<style>
  @page {
    size: A4;
    margin: 16mm 14mm 16mm 14mm;
    @bottom-left {
      content: "ACAP — Plataforma de venda d'entrades";
      font-family: "DejaVu Sans", sans-serif;
      font-size: 8.5pt;
      color: #666;
    }
    @bottom-right {
      content: counter(page);
      font-family: "DejaVu Sans", sans-serif;
      font-size: 8.5pt;
      color: #666;
    }
  }
  * { box-sizing: border-box; }
  html {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    margin: 0;
    font-family: "DejaVu Sans", "Noto Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #1a1a1a;
  }
  h1 {
    font-size: 17pt;
    line-height: 1.25;
    margin: 0 0 0.7em;
    page-break-after: avoid;
  }
  h2 {
    font-size: 13.5pt;
    margin: 1.25em 0 0.4em;
    padding-bottom: 0.12em;
    border-bottom: 1px solid #ddd;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt;
    margin: 1em 0 0.3em;
    page-break-after: avoid;
  }
  p { margin: 0.35em 0 0.65em; }
  ul, ol { margin: 0.25em 0 0.7em; padding-left: 1.25em; }
  ol { padding-left: 1.8em; }
  li { margin: 0.12em 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0 0.9em;
    font-size: 9pt;
    line-height: 1.35;
  }
  th, td {
    border: 1px solid #ccc;
    padding: 4px 6px;
    vertical-align: top;
    text-align: left;
  }
  th { background: #f3f3f3; font-weight: 700; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  code {
    font-family: "DejaVu Sans Mono", monospace;
    font-size: 0.88em;
    background: #f4f4f4;
    padding: 0 0.2em;
  }
  pre {
    background: #f6f6f6;
    padding: 0.55em 0.7em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 8.5pt;
  }
  blockquote {
    margin: 0.7em 0 0.9em;
    padding: 0.45em 0.8em;
    border-left: 4px solid #3b7dd8;
    background: #eef4fc;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  blockquote p { margin: 0.25em 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
  .mermaid {
    margin: 0.6em 0 0.9em;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .mermaid svg {
    max-width: 100% !important;
    height: auto !important;
  }
  a { color: inherit; text-decoration: none; }
</style>
</head>
<body>
""" + body + """
<script>
  mermaid.initialize({
    startOnLoad: true,
    theme: "neutral",
    fontFamily: "DejaVu Sans, sans-serif",
    flowchart: { htmlLabels: true, useMaxWidth: true }
  });
</script>
</body>
</html>
"""
(workdir / "doc.html").write_text(html, encoding="utf-8")
PY

(
  cd "$WORKDIR"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --disable-dev-shm-usage \
    --virtual-time-budget=20000 \
    --timeout=30000 \
    --dump-dom \
    "doc.html" > "$WORKDIR/rendered.html"
)

python3 - "$WORKDIR/doc.html" "$WORKDIR/rendered.html" << 'PY'
import re
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text(encoding="utf-8")
path = Path(sys.argv[2])
html = path.read_text(encoding="utf-8")
if 'class="mermaid"' in source:
    if "<svg" not in html or 'data-processed="true"' not in html:
        sys.stderr.write("El diagrama mermaid no s'ha renderitzat.\n")
        sys.exit(1)
    if "Syntax error in text" in html:
        sys.stderr.write("Mermaid ha trobat un error de sintaxi al diagrama.\n")
        sys.exit(1)
html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S)
path.write_text(html, encoding="utf-8")
PY

(
  cd "$WORKDIR"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --disable-dev-shm-usage \
    --no-pdf-header-footer \
    --print-to-pdf="$OUTPUT" \
    "rendered.html"
)

if [[ ! -s "$OUTPUT" ]]; then
  echo "Chrome no ha escrit el PDF." >&2
  exit 1
fi

echo "PDF generat: $OUTPUT"
