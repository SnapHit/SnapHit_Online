#!/bin/bash
# serve.sh <harness.mjs> [args]: serve docs/ on a free local port, run one
# browser harness against it with PORT set, then stop the server by its PID.
# Output (screenshots) goes to MANTA_OUT, default a fresh temp dir.
H=$(cd "$(dirname "$0")/.." && pwd); ROOT=$(cd "$H/../.." && pwd)
[ -n "$MANTA_TOOLS" ] || { echo "serve.sh: MANTA_TOOLS not set (README.md)"; exit 9; }
[ -n "$CHROME" ] || { echo "serve.sh: CHROME not set (README.md)"; exit 9; }
export MANTA_OUT=${MANTA_OUT:-$(mktemp -d)}
export SESSION_AFTER=${SESSION_AFTER:-"2026-09-23 02:50 UTC"}
SCRIPT=$1; shift
case "$SCRIPT" in /*) ;; *) SCRIPT="$PWD/$SCRIPT";; esac
[ -f "$SCRIPT" ] || { echo "serve.sh: no such harness $SCRIPT"; exit 9; }
PORT=${PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')}
export PORT
W=$(mktemp -d) || exit 9
python3 -m http.server "$PORT" -d "$ROOT/docs" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; rm -rf -- "${W:?}"' EXIT
up=0; for i in $(seq 1 20); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/lab/manta/index.html" && { up=1; break; }; sleep 0.5; done
[ $up = 1 ] || { echo "serve.sh: nothing serving on $PORT"; exit 8; }
echo "serve.sh: $(basename "$SCRIPT") on port $PORT (server pid $SRV), output $MANTA_OUT"
(cd "$W" && timeout ${HARNESS_TIMEOUT:-90} node "$SCRIPT" "$@")
RC=$?
echo "rc=$RC"
exit $RC
