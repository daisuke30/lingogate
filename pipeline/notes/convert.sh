#!/usr/bin/env bash
# LINGO-009: Convert handwritten-note HEIC images to JPEG for transcription.
#
# Source images live in a READ-ONLY location and are NEVER modified/moved.
# Output JPEGs go to pipeline/notes/jpeg/ at ~1400px width. Idempotent:
# skips files whose JPEG already exists (re-runnable, safe to interrupt).
#
# Usage: bash convert.sh
set -euo pipefail

SRC="/Users/Daisuke/Russia/Russian"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/jpeg"
mkdir -p "$OUT"

n=0
skipped=0
for src in "$SRC"/*.HEIC; do
  base="$(basename "$src" .HEIC)"
  dst="$OUT/$base.jpg"
  if [[ -f "$dst" ]]; then
    skipped=$((skipped+1))
    continue
  fi
  # sips reads the read-only source and writes a new JPEG; source untouched.
  sips -s format jpeg --resampleWidth 1400 "$src" --out "$dst" >/dev/null
  n=$((n+1))
done
echo "converted=$n skipped=$skipped total_jpeg=$(ls -1 "$OUT"/*.jpg 2>/dev/null | wc -l | tr -d ' ')"
