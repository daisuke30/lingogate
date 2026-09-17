#!/bin/bash
# LINGO-051: run one rewrite batch through Codex.
# Usage: run_rewrite_batch.sh <batch_index e.g. 000>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDX="$1"
BATCH_FILE="$HERE/rewrite_batches/batch_${IDX}.json"
PROMPT_FILE="$HERE/rewrite_prompt_template.txt"

if [ ! -f "$BATCH_FILE" ]; then
  echo "no such batch file: $BATCH_FILE" >&2
  exit 1
fi

PROMPT="$(cat "$PROMPT_FILE")"
INPUT="$(cat "$BATCH_FILE")"
FULL="${PROMPT/__INPUT__/$INPUT}"

mkdir -p "$HERE/rewrite_out"
echo "$FULL" | codex exec --skip-git-repo-check - > "$HERE/rewrite_out/raw_${IDX}.txt" 2>&1
python3 "$HERE/extract_codex_json.py" "$HERE/rewrite_out/raw_${IDX}.txt" > "$HERE/rewrite_out/out_${IDX}.json"
N=$(python3 -c "import json;print(len(json.load(open('$HERE/rewrite_out/out_${IDX}.json'))))" 2>/dev/null || echo "PARSE_FAIL")
echo "batch $IDX: done, extracted $N entries"
