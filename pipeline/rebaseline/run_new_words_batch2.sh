#!/bin/bash
# LINGO-051: generate gloss/aspect/gender data for the SECOND new-word batch
# (words discovered as missing during the subject-rewrite pass) via Codex.
# Usage: run_new_words_batch2.sh <verb|noun|adj|adv>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POS="$1"
BATCH_FILE="$HERE/new_words_batch2_${POS}.json"
PROMPT_FILE="$HERE/new_${POS}_prompt_template.txt"

if [ ! -f "$BATCH_FILE" ]; then
  echo "no such batch file: $BATCH_FILE" >&2
  exit 1
fi

PROMPT="$(cat "$PROMPT_FILE")"
INPUT="$(cat "$BATCH_FILE")"
FULL="${PROMPT/__INPUT__/$INPUT}"

echo "$FULL" | codex exec --skip-git-repo-check - > "$HERE/new_words2_raw_${POS}.txt" 2>&1
python3 "$HERE/extract_codex_json.py" "$HERE/new_words2_raw_${POS}.txt" > "$HERE/new_words2_out_${POS}.json"
echo "batch2 $POS: codex exec done, extracted $(python3 -c "import json;print(len(json.load(open('$HERE/new_words2_out_${POS}.json'))))") entries"
