#!/bin/bash
# LINGO-025: run one aspect-generation batch through Codex, write raw output.
# Usage: run_codex_batch.sh <batch_num e.g. 01>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N="$1"
BATCH_FILE="$HERE/aspect_batches/batch_${N}.json"
OUT_FILE="$HERE/aspect_batches/out_${N}.json"

if [ ! -f "$BATCH_FILE" ]; then
  echo "no such batch file: $BATCH_FILE" >&2
  exit 1
fi

PROMPT="$(cat "$HERE/aspect_prompt_template.txt")"
INPUT="$(cat "$BATCH_FILE")"
FULL="${PROMPT/__INPUT__/$INPUT}"

echo "$FULL" | codex exec --skip-git-repo-check - > "$HERE/aspect_batches/raw_${N}.txt" 2>&1
python3 "$HERE/extract_codex_json.py" "$HERE/aspect_batches/raw_${N}.txt" > "$HERE/aspect_batches/out_${N}.json"
echo "batch $N: codex exec done, extracted $(python3 -c "import json;print(len(json.load(open('$HERE/aspect_batches/out_${N}.json'))))") entries"
