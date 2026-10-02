#!/bin/bash
# run.sh [harness ...]: every browser harness, one at a time, each on its own
# server and port. Logs to MANTA_OUT (default a fresh temp dir).
H=$(cd "$(dirname "$0")/.." && pwd)
export MANTA_OUT=${MANTA_OUT:-$(mktemp -d)}
L=$MANTA_OUT/browser-logs; mkdir -p "$L" || exit 1
for h in ${@:-h2 s1 cam wake setpiece pool tidy schemes probe def rows newocean zoom}; do
  "$H/lib/serve.sh" "$H/browser/$h.mjs" > "$L/$h.log" 2>&1
  printf "%-9s rc=%s pass %3s fail %s\n" $h "$(grep -o 'rc=[0-9]*' "$L/$h.log" | tail -1 | cut -d= -f2)" "$(grep -c '  PASS  ' "$L/$h.log")" "$(grep -c '  FAIL  ' "$L/$h.log")"
done
grep -h "  FAIL  \|WATCHDOG\|no ready" "$L"/*.log | cut -c1-250
echo "logs in $L"
