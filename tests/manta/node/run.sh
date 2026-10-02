#!/bin/bash
# run.sh: every Node suite, at most four at once, each in its own temp dir.
# Prints pass/fail per suite and the fingerprint (simtest11 is run but kept
# out of the fingerprint, as before). Logs to MANTA_OUT/node-logs.
H=$(cd "$(dirname "$0")" && pwd)
export MANTA_OUT=${MANTA_OUT:-$(mktemp -d)}
R=$MANTA_OUT/node-logs; mkdir -p "$R" || exit 1
W=$(mktemp -d) || exit 1; trap 'rm -rf -- "${W:?}"' EXIT
FP="simtest simtest2 simtest3 simtest4 simtest5 simtest6 simtest7 simtest8 simtest10"
EXTRA=${EXTRA-simtest11}
n=0; for f in $FP $EXTRA; do mkdir -p "$W/$f"; ( cd "$W/$f" && timeout 90 node "$H/$f.mjs" > "$R/$f.log" 2>&1 ) & n=$((n+1)); [ $((n % 4)) = 0 ] && wait; done; wait
mkdir -p "$W/d" "$W/b"
( cd "$W/d" && SET=def timeout 90 node "$H/simtest9.mjs" > "$R/t9-def.log" 2>&1 ) & ( cd "$W/b" && SET=big timeout 90 node "$H/simtest9.mjs" > "$R/t9-big.log" 2>&1 ) & wait
for f in $FP t9-def t9-big $EXTRA; do printf "%-9s pass %3s fail %s\n" $f $(grep -c "  PASS  " "$R/$f.log") $(grep -c "  FAIL  " "$R/$f.log"); done
grep -h "  FAIL  " "$R"/*.log | cut -c1-220
L=$(for f in $FP t9-def t9-big; do echo "$R/$f.log"; done)
ALL=$(for f in $FP t9-def t9-big $EXTRA; do echo "$R/$f.log"; done)
echo "all suites: pass $(cat $ALL | grep -c '^  PASS  ') fail $(cat $ALL | grep -c '^  FAIL  ')"
echo "fingerprint set: pass $(cat $L | grep -c '^  PASS  ') fail $(cat $L | grep -c '^  FAIL  ') fingerprint $(cat $L | grep -E '^  (PASS|FAIL)  ' | md5sum | cut -c1-8)"
echo "logs in $R"
