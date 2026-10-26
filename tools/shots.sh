#!/usr/bin/env bash
# Visual smoke: full-page screenshots of the running dev server with headless Chrome.
# Usage: tools/shots.sh [outdir] [base-url]
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="${1:-/tmp/kf-shots}"
BASE="${2:-http://127.0.0.1:3100}"
mkdir -p "$OUT"

shots=(
  "home:/"
  "home-en:/en"
  "convert:/convert"
  "convert-en:/en/convert"
  "green:/green"
  "docs:/docs"
  "pair:/convert/epub-to-mobi"
  "pair-en:/en/convert/pdf-to-epub"
  "404:/this-page-does-not-exist"
)

for entry in "${shots[@]}"; do
  name="${entry%%:*}"
  path="${entry#*:}"
  # Full-page capture: give the page a tall viewport, then trim later if needed.
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1440,4200 \
    --virtual-time-budget=6000 --screenshot="$OUT/$name.png" \
    "$BASE$path" >/dev/null 2>&1 || echo "warn: $name failed"
  # Mobile viewport
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=390,3800 \
    --virtual-time-budget=6000 --screenshot="$OUT/$name-mobile.png" \
    "$BASE$path" >/dev/null 2>&1 || echo "warn: $name mobile failed"
done

echo "shots written to $OUT"
ls -lh "$OUT" | tail -20
