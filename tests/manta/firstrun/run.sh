#!/bin/bash
# run.sh: firstrun.mjs on both cores, one chunk. Each process gets its own
# seed; the JSON goes to $OUT/<mode>-<seed>.json, then the table for every
# file in $OUT is printed. A chunk of RUNS=60 per process took about 8
# minutes for MODE=after on a 2-core container (4D), so a full measurement
# of 2,000 runs is several chunks with different SEEDS.
#   OUT=dir MODE=after RUNS=60 SEEDS="1 2" tests/manta/firstrun/run.sh
H=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:?set OUT to a directory outside the repo}; mkdir -p "$OUT" || exit 1
MODE=${MODE:-after}; SEEDS=${SEEDS:-"1 2"}
pids=()
for s in $SEEDS; do
  ( MODE=$MODE SEED=$s timeout 590 node --max-semi-space-size=64 "$H/firstrun.mjs" > "$OUT/$MODE-$s.json.part" && mv "$OUT/$MODE-$s.json.part" "$OUT/$MODE-$s.json" ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
rm -f "$OUT"/*.part
node "$H/firstrun.mjs" sum "$OUT"/*.json
