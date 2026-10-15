#!/bin/bash
# rooms.sh <dir/client.mjs> [more clients]: start wrangler dev on the repo (the
# rooms Worker and the static site, as deployed), put a delay proxy in front of
# it for each delay, run each client once per delay, stop everything by PID.
#
#   DELAYS   "20:0 150:50 300:100" (RTT:jitter in ms; one proxy each)
#   ALONE=1  run the delays one after another instead of side by side
#   DIRECT=1 no proxies: clients talk to wrangler dev directly
#   NAMES=1  --var TEST_NAMES:1 (lets tests name and stage rooms)
#   VARS     extra wrangler args, e.g. "--var CODE_TTL_MS:4000"
#   PORT     wrangler dev port (default: a free one)
#   WRANGLER path to wrangler's bin/wrangler.js (default: under MANTA_TOOLS)
#   MANTA_OUT logs and screenshots (default: a fresh temp dir)
# Every other variable (PARTS, PART, MODE, SKIPRAW...) passes through to the client.
H=$(cd "$(dirname "$0")/.." && pwd); ROOT=$(cd "$H/../.." && pwd)
[ -n "$MANTA_TOOLS" ] || { echo "rooms.sh: MANTA_TOOLS not set (README.md)"; exit 9; }
WRANGLER=${WRANGLER:-$MANTA_TOOLS/node_modules/wrangler/bin/wrangler.js}
[ -f "$WRANGLER" ] || { echo "rooms.sh: no wrangler at $WRANGLER"; exit 9; }
export MANTA_OUT=${MANTA_OUT:-$(mktemp -d)}; mkdir -p "$MANTA_OUT" || exit 1
free () { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
PORT=${PORT:-$(free)}
TAG=$(date +%H%M%S)-$$
P=$(mktemp -d) || exit 1
EXTRA=""; [ -n "$NAMES" ] && EXTRA="--var TEST_NAMES:1"
cd "$ROOT" || exit 1
WRANGLER_SEND_METRICS=false CI=1 timeout 600 node "$WRANGLER" dev --port "$PORT" --ip 127.0.0.1 --persist-to "$P" $EXTRA $VARS > "$MANTA_OUT/dev-$TAG.log" 2>&1 &
WPID=$!; PIDS=""
cleanup () { for p in $PIDS; do kill "$p" 2>/dev/null; done; kill "$WPID" 2>/dev/null; sleep 2; kill -0 "$WPID" 2>/dev/null && kill -9 "$WPID"; wait 2>/dev/null; rm -rf -- "${P:?}"; D="$ROOT/.wrangler"; [ -d "$D" ] && rm -rf -- "${D:?}"; }
trap cleanup EXIT
# Ready when the echo answers: 426 (wants a WebSocket), or, with rooms switched
# off (VARS="--var ROOMS_OPEN:false", 4B), 503 "rooms are off".
up=0; for i in $(seq 1 60); do c=$(curl -s -w ' %{http_code}' --max-time 2 "http://127.0.0.1:$PORT/lab/manta/rooms/echo" 2>/dev/null); case "$c" in *' 426'|'rooms are off 503') up=1; break;; esac; sleep 1; done
echo "rooms.sh: wrangler dev ready=$up (pid $WPID) port $PORT, output $MANTA_OUT"; [ $up = 1 ] || exit 1
run1 () { # run1 <client> <port> <label> <log>
  (cd "$(dirname "$1")" && PORT=$2 LABEL="$3" timeout ${CLIENT_TIMEOUT:-590} node "$(basename "$1")" > "$4" 2>&1); }
for C in "$@"; do
  case "$C" in /*) ;; *) C="$H/$C";; esac
  [ -f "$C" ] || { echo "rooms.sh: no such client $C"; continue; }
  N=$(basename "$(dirname "$C")")-$(basename "$C" .mjs)
  if [ -n "$DIRECT" ]; then
    run1 "$C" "$PORT" "direct" "$MANTA_OUT/$N-$TAG.log"; grep -E "PASS|FAIL|failures|WATCHDOG|Error|^\[" "$MANTA_OUT/$N-$TAG.log" | cut -c1-400; continue
  fi
  TP=""
  for spec in ${DELAYS:-20:0 150:50 300:100}; do
    LP=$(free)
    LISTEN=$LP UPSTREAM=$PORT RTT=${spec%%:*} JITTER=${spec##*:} timeout 600 node "$H/lib/delayproxy.mjs" > /dev/null 2>&1 & PX=$!; PIDS="$PIDS $PX"
    for i in $(seq 1 20); do (exec 3<>/dev/tcp/127.0.0.1/$LP) 2>/dev/null && break; sleep 0.25; done
    LOG="$MANTA_OUT/$N-${spec%%:*}-$TAG.log"
    if [ -n "$ALONE" ]; then run1 "$C" "$LP" "rtt $spec" "$LOG"; kill "$PX" 2>/dev/null
    else run1 "$C" "$LP" "rtt $spec" "$LOG" & TP="$TP $!"; fi
  done
  [ -n "$TP" ] && wait $TP
  for spec in ${DELAYS:-20:0 150:50 300:100}; do echo "-- $N rtt $spec"; grep -E "PASS|FAIL|failures|WATCHDOG|Error|^\[|95th" "$MANTA_OUT/$N-${spec%%:*}-$TAG.log" | cut -c1-400; done
done
echo "rooms.sh: reloads $(grep -c 'Reloading local server' "$MANTA_OUT/dev-$TAG.log"); runtime errors $(grep -c -i -E 'uncaught|✘ \[ERROR\]' "$MANTA_OUT/dev-$TAG.log"); non-rooms worker lines $(grep 'rooms worker' "$MANTA_OUT/dev-$TAG.log" | grep -v '/lab/manta/rooms/' | wc -l)"
