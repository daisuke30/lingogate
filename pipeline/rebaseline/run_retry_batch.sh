#!/bin/bash
# LINGO-051: run the structural-failure retry batch through Codex.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BATCH_FILE="$HERE/retry_batch.json"
PROMPT_FILE="$HERE/retry_prompt_template.txt"

PROMPT="$(cat "$PROMPT_FILE")"
INPUT="$(cat "$BATCH_FILE")"
FULL="${PROMPT/__INPUT__/$INPUT}"

mkdir -p "$HERE/rewrite_out"
echo "$FULL" | codex exec --skip-git-repo-check - > "$HERE/rewrite_out/raw_retry.txt" 2>&1
python3 "$HERE/extract_codex_json.py" "$HERE/rewrite_out/raw_retry.txt" > "$HERE/rewrite_out/out_retry.json"
N=$(python3 -c "import json;print(len(json.load(open('$HERE/rewrite_out/out_retry.json'))))" 2>/dev/null || echo "PARSE_FAIL")
echo "retry batch: done, extracted $N entries"
