#!/usr/bin/env bash
# Re-fetch the raw lesson CSVs from Katsuta's Google Sheets (public export links).
# Idempotent: overwrites the CSVs in this directory. Run build_lessons.py afterwards.
set -euo pipefail
cd "$(dirname "$0")"

SHEET1="1W3SuB9-loVU3WiIxbrKGlFNGf7RjqHeqY_2QGqdEQ7Y"   # УРОК lessons (RU/EN pairs)
SHEET2="1VgzDy4UNuWG06ZJmIJCtrc7kSt8fZ23LSnDz8Ru6z98"   # First class 05/08 (vocab / sentences / corrections)

csv() { # <spreadsheet_id> <gid> <outfile>
  curl -sL "https://docs.google.com/spreadsheets/d/$1/export?format=csv&gid=$2" -o "$3"
  echo "wrote $3 ($(wc -l < "$3") lines)"
}

# Sheet 1: single tab
csv "$SHEET1" 0          sheet1_urok.csv

# Sheet 2: three tabs (discovered via /htmlview gid scan)
csv "$SHEET2" 0          sheet2_firstclass.csv
csv "$SHEET2" 1372158929 sheet2_tab2.csv
csv "$SHEET2" 414972680  sheet2_tab3.csv

echo "done. now run: python3 build_lessons.py"
