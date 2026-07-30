#!/bin/sh
set -eu

ios_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$ios_root/../.." && pwd)

compare() {
  source_path=$1
  snapshot_path=$2
  if ! cmp -s "$source_path" "$snapshot_path"; then
    echo "Snapshot drift: $snapshot_path differs from $source_path" >&2
    return 1
  fi
}

verify_sha256() {
  snapshot_path=$1
  expected=$2
  actual=$(shasum -a 256 "$snapshot_path" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    echo "Snapshot hash mismatch: $snapshot_path expected $expected, got $actual" >&2
    return 1
  fi
}

compare "$repo_root/apps/web/public/tiles/providence.pmtiles" "$ios_root/Resources/providence.pmtiles"
compare "$repo_root/map/style.json" "$ios_root/Resources/style.json"
compare "$repo_root/db/seeds/campus_buildings.geojson" "$ios_root/Resources/campus-buildings.geojson"
compare "$repo_root/db/seeds/campus_landmarks.geojson" "$ios_root/Resources/campus-landmarks.geojson"
compare "$repo_root/packages/contract/openapi.json" "$ios_root/packages/BrownSyncAPI/Sources/BrownSyncAPI/openapi.json"

verify_sha256 "$ios_root/Resources/glyphs/Noto Sans Regular/0-255.pbf" "62c6d49b15fa836eb6aa45e259c7ca6762f44b011b09e47776efbe4a6db1b397"
verify_sha256 "$ios_root/Resources/glyphs/Noto Sans Medium/0-255.pbf" "ba2f0118dd024e3041b158e5f9eb49bc0a658019f53f458e9f5c0b8efcd79b91"
verify_sha256 "$ios_root/Resources/glyphs/OFL.txt" "7713cfc8e3c36d5ec4aa3d6cffe7500a1b3310f8a86d914b8ea09c2a9dee7c2d"

echo "iOS source snapshots match canonical repo inputs."
