#!/usr/bin/env bash
#
# basemap-extract.sh — reproduce apps/web/public/tiles/providence.pmtiles
#
# Extracts a College Hill / Providence cutout from the latest Protomaps daily
# planet build (https://build.protomaps.com). Daily objects are named
# YYYYMMDD.pmtiles; the R2 bucket has no public listing endpoint as of
# 2026-07-28, so we probe today's date (UTC) and walk backwards. The archives
# support HTTP range requests, which `pmtiles extract` uses — the full planet
# file (~137 GB) is never downloaded.
#
# Result as of build 20260728: 133 tiles, z0-15, ~4.9 MB — small enough to
# commit at apps/web/public/tiles/providence.pmtiles (budget: 15 MB).
#
# If a future extract exceeds the budget (wider bbox, denser data), do NOT
# commit it. Either:
#   1. shrink the bbox below or pass --maxzoom=14 to `pmtiles extract`, or
#   2. host on Cloudflare R2 instead:
#        wrangler r2 object put brownsync-tiles/providence.pmtiles \
#          --file=apps/web/public/tiles/providence.pmtiles
#      expose the bucket on a public domain with CORS (GET + Range headers),
#      then point VITE_PMTILES_URL at
#      https://tiles.<domain>/providence.pmtiles — the web app reads that env
#      var in apps/web/src/map/style.ts and rewrites the style source URL.
#
# Usage: scripts/basemap-extract.sh [YYYYMMDD]
#   YYYYMMDD  optional explicit build date (skips discovery)
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Generously padded around campus (campus proper: -71.410,41.820 -71.393,41.834).
BBOX="-71.445,41.795,-71.36,41.855"
OUT="apps/web/public/tiles/providence.pmtiles"
UA="BrownSync/1.0 (+noah_finkelstein@brown.edu)"
PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
BUDGET_BYTES=$((15 * 1024 * 1024))

if [[ $# -ge 1 ]]; then
  BUILD="$1"
else
  BUILD=""
  for i in 0 1 2 3 4 5 6 7; do
    # BSD (macOS) date first, GNU date fallback.
    d=$(date -u -v "-${i}d" +%Y%m%d 2>/dev/null || date -u -d "-${i} days" +%Y%m%d)
    if curl -fsSI -A "$UA" "https://build.protomaps.com/${d}.pmtiles" >/dev/null 2>&1; then
      BUILD="$d"
      break
    fi
    sleep 1 # scraper etiquette: <= 1 req/s
  done
  if [[ -z "$BUILD" ]]; then
    echo "error: no Protomaps daily build found in the last week" >&2
    exit 1
  fi
fi

echo "extracting bbox ${BBOX} from build ${BUILD} -> ${OUT}"
mkdir -p "$(dirname "$OUT")"
"$PMTILES_BIN" extract "https://build.protomaps.com/${BUILD}.pmtiles" "$OUT" \
  --bbox="$BBOX" --download-threads=1

BYTES=$(wc -c <"$OUT" | tr -d ' ')
echo "wrote ${OUT} (${BYTES} bytes)"
if ((BYTES > BUDGET_BYTES)); then
  echo "WARNING: extract exceeds the 15 MB commit budget." >&2
  echo "Reduce --maxzoom / bbox, or host on R2 (see header comment)." >&2
  exit 2
fi
"$PMTILES_BIN" show "$OUT" | sed -n '1,8p'
