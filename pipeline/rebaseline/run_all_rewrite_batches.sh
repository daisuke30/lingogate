#!/bin/bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
for pair_start in 003 005 007 009 011 013; do
  case $pair_start in
    003) pair=(003 004) ;;
    005) pair=(005 006) ;;
    007) pair=(007 008) ;;
    009) pair=(009 010) ;;
    011) pair=(011 012) ;;
    013) pair=(013 014) ;;
  esac
  echo "=== launching pair: ${pair[*]} ==="
  pids=()
  for i in "${pair[@]}"; do
    bash run_rewrite_batch.sh "$i" > rewrite_out/log_$i.txt 2>&1 &
    pids+=($!)
  done
  wait "${pids[@]}"
  echo "=== pair ${pair[*]} done ==="
done
echo "ALL BATCHES DONE"
