#!/usr/bin/env bash
# LINGO-020 工程1 — fetch the OpenSubtitles Russian frequency list.
# Idempotent: re-running just re-downloads the same file.
set -euo pipefail
cd "$(dirname "$0")"

URL="https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt"
curl -sSL --max-time 120 "$URL" -o ru_50k.txt
wc -l ru_50k.txt
echo "fetched: $URL"
