#!/usr/bin/env bash
# screenshot.sh <url> <out.png>  (1920×1080, headless Chrome)
URL="$1"; OUT="$2"
PROFILE=$(mktemp -d /tmp/fw-shot-XXXX)
google-chrome --headless=new --user-data-dir="$PROFILE" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1920,1080 \
  --virtual-time-budget=6000 --run-all-compositor-stages-before-draw --screenshot="$OUT" "$URL" >/dev/null 2>&1
rm -rf "$PROFILE"; echo "$OUT"
