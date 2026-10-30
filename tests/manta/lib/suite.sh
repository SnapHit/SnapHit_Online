#!/bin/bash
# suite.sh [pattern ...]: the whole suite (4C), one harness at a time, each
# under its own timeout (never more than 10 minutes), with one summary line
# each: name, verdict, seconds. A pattern (an extended regex) picks entries
# by name: tests/manta/lib/suite.sh 'desktop|gpu'. Logs to MANTA_OUT/suite.
#
# Verdicts: a serve.sh or plain Node entry passes on exit code 0; a rooms.sh
# entry passes when every client it ran exited 0 (rooms.sh prints "client
# rc=N" for each) and no WATCHDOG fired. Needs MANTA_TOOLS, CHROME and
# CHROME153 (README.md). The portal entry builds the package first.
#
# Measurements that have no verdict (room-size/cost.mjs, pictures.mjs) are
# not in it; run them on their own.
#
# On a slow machine (README.md, "Slow containers") set WATCHDOG_X, STEP_MS
# and the rest in the environment: every variable passes through to the
# harnesses. The 4C runs on a 2-core container used WATCHDOG_X=3 STEP_MS=6.
H=$(cd "$(dirname "$0")/.." && pwd); ROOT=$(cd "$H/../.." && pwd)
[ -n "$MANTA_TOOLS" ] && [ -n "$CHROME" ] && [ -n "$CHROME153" ] || { echo "suite.sh: MANTA_TOOLS, CHROME and CHROME153 must be set (README.md)"; exit 9; }
export MANTA_OUT=${MANTA_OUT:-$(mktemp -d)}
L=$MANTA_OUT/suite; mkdir -p "$L" || exit 1
SUM=$L/summary.txt; : > "$SUM"
# name | kind (node, serve, rooms, portal) | environment | harness and arguments
read -r -d '' TABLE <<'EOF'
node-suites|run||node/run.sh
simtest12|node||node/simtest12.mjs
simtest13|node||node/simtest13.mjs
budget-unit|node||room-budget/unit.mjs
accept-3|node||accept/accept.mjs 3 0 3
accept-6|node||accept/accept.mjs 6
h2-high|serve|BACK=gl TIERS=high|browser/h2.mjs
h2-medium|serve|BACK=gl TIERS=medium|browser/h2.mjs
h2-low|serve|BACK=gl TIERS=low|browser/h2.mjs
s1|serve|HARNESS_TIMEOUT=200|browser/s1.mjs
cam|serve||browser/cam.mjs
wake|serve||browser/wake.mjs
setpiece|serve||browser/setpiece.mjs
pool|serve||browser/pool.mjs
tidy|serve||browser/tidy.mjs
schemes|serve||browser/schemes.mjs
probe|serve||browser/probe.mjs
def|serve|BACK=gl|browser/def.mjs
rows|serve||browser/rows.mjs
newocean|serve||browser/newocean.mjs
zoom|serve|HARNESS_TIMEOUT=200|browser/zoom.mjs
keys|serve||browser/keys.mjs
hint|serve||browser/hint.mjs
bzoom|serve||browser/bzoom.mjs
desktop-1366|serve|SIZE=1366x768|browser/desktop.mjs
desktop-1920|serve|SIZE=1920x1080|browser/desktop.mjs
desktop-2560-feed|serve|SIZE=2560x1440 PART=feed|browser/desktop.mjs
desktop-2560-name|serve|SIZE=2560x1440 PART=name|browser/desktop.mjs
desktop-2560-lab|serve|SIZE=2560x1440 PART=lab|browser/desktop.mjs
pink|serve||browser/pink.mjs
shark|serve||browser/shark.mjs
classic-self|serve|MODE=self|browser/classic.mjs
spill|serve||browser/spill.mjs
raywake|serve|HARNESS_TIMEOUT=200|browser/raywake.mjs
artpass-1|serve||browser/artpass.mjs
artpass-2|serve|CHANGE=2|browser/artpass.mjs
artpass-3|serve|CHANGE=3|browser/artpass.mjs
artpass-4|serve|CHANGE=4|browser/artpass.mjs
artpass-5|serve|CHANGE=5|browser/artpass.mjs
camera|serve||browser/camera.mjs
radar|serve||room-radar/radar.mjs
watch|serve|CHROME=$CHROME153|browser/watch.mjs
watch-gl|serve|CHROME=$CHROME153 BACK=gl|browser/watch.mjs
gpu|serve|CHROME=$CHROME153 HARNESS_TIMEOUT=200|browser/gpu.mjs
wgpu|serve||browser/wgpu.mjs
wgpupix|serve|CHROME=$CHROME153|browser/wgpupix.mjs
portal|portal|CHROME=$CHROME153|portal/portal.mjs
roomtest|rooms|NAMES=1 DIRECT=1|room-base/roomtest.mjs
devcheck3b|rooms|DIRECT=1|room-base/devcheck3b.mjs
watchmode|rooms|NAMES=1 DIRECT=1|room-base/watchmode.mjs
playtest-corr-cut-20|rooms|NAMES=1 ALONE=1 DELAYS=20:0 PARTS=corr,cut|room-play/playtest.mjs
playtest-corr-cut-150|rooms|NAMES=1 ALONE=1 DELAYS=150:50 PARTS=corr,cut|room-play/playtest.mjs
playtest-corr-cut-300|rooms|NAMES=1 ALONE=1 DELAYS=300:100 PARTS=corr,cut|room-play/playtest.mjs
playtest-bytes-drop-20|rooms|NAMES=1 ALONE=1 DELAYS=20:0 PARTS=bytes,drop|room-play/playtest.mjs
playtest-bytes-drop-150|rooms|NAMES=1 ALONE=1 DELAYS=150:50 PARTS=bytes,drop|room-play/playtest.mjs
playtest-bytes-drop-300|rooms|NAMES=1 ALONE=1 DELAYS=300:100 PARTS=bytes,drop|room-play/playtest.mjs
playtest-restart|rooms|NAMES=1 ALONE=1 PARTS=restart|room-play/playtest.mjs
playmode-20|rooms|NAMES=1 DELAYS=20:0|room-play/playmode.mjs
playmode-150|rooms|NAMES=1 DELAYS=150:50|room-play/playmode.mjs
playmode-300|rooms|NAMES=1 DELAYS=300:100|room-play/playmode.mjs
compact|rooms|NAMES=1|room-compact/compact.mjs
six|rooms|NAMES=1 PARTS=1,2,3,5,6|room-six/six.mjs
six-jitter-20|rooms|NAMES=1 PARTS=4 ALONE=1 DELAYS=20:0|room-six/six.mjs
six-jitter-150|rooms|NAMES=1 PARTS=4 ALONE=1 DELAYS=150:50|room-six/six.mjs
six-jitter-300|rooms|NAMES=1 PARTS=4 ALONE=1 DELAYS=300:100|room-six/six.mjs
limits|rooms|DIRECT=1 VARS=--var\ CODE_TTL_MS:4000|room-limits/limits.mjs
feedback-a|rooms|DIRECT=1 PART=a|room-feedback/feedback.mjs
feedback-b|rooms|DIRECT=1 PART=b|room-feedback/feedback.mjs
feedback-off|rooms|OFF=1 DIRECT=1 VARS=--var\ ROOMS_OPEN:false|room-feedback/feedback.mjs
fbcuts|rooms|DIRECT=1|room-feedback/fbcuts.mjs
pick|rooms|NAMES=1|room-pick/pick.mjs
labels-solo|rooms|DIRECT=1 PART=solo|room-labels/labels.mjs
labels-room|rooms|DIRECT=1 PART=room|room-labels/labels.mjs
labels-crash|rooms|DIRECT=1 PART=crash|room-labels/labels.mjs
names-first|rooms|DIRECT=1 PART=first|room-names/names.mjs
names-clean|rooms|DIRECT=1 PART=clean|room-names/names.mjs
names-change|rooms|DIRECT=1 PART=change|room-names/names.mjs
inplace|rooms|DELAYS=20:0|room-names/inplace.mjs
lag|rooms|NAMES=1|room-hits/lag.mjs
hits|rooms|NAMES=1|room-hits/hits.mjs
bhits-crash|rooms|DIRECT=1 MODE=crash|room-hits/bhits.mjs
bhits-cut|rooms|DIRECT=1 MODE=cut|room-hits/bhits.mjs
bytes|rooms|NAMES=1|room-bytes/bytes.mjs
room-pink-20|rooms|NAMES=1 ALONE=1 DELAYS=20:0 VARS=--var\ PINK_WAIT:4\ --var\ PINK_STAY:40|room-pink/pink.mjs
room-pink-150|rooms|NAMES=1 ALONE=1 DELAYS=150:50 VARS=--var\ PINK_WAIT:4\ --var\ PINK_STAY:40|room-pink/pink.mjs
room-pink-300|rooms|NAMES=1 ALONE=1 DELAYS=300:100 VARS=--var\ PINK_WAIT:4\ --var\ PINK_STAY:40|room-pink/pink.mjs
room-shark|rooms|NAMES=1 VARS=--var\ SHARK_ON:1\ --var\ SHARK_EVERY:5|room-shark/shark.mjs
room-radar|rooms|NAMES=1|room-radar/room.mjs
radar-page|rooms|DIRECT=1|room-radar/page.mjs
overflow|rooms|DIRECT=1 VARS=--var\ LIVE_CAP:4|room-overflow/overflow.mjs
switch-off|rooms|MODE=off DIRECT=1 VARS=--var\ ROOMS_OPEN:false|room-switch/switch.mjs
switch-on|rooms|MODE=on DIRECT=1|room-switch/switch.mjs
switch-cap2|rooms|MODE=cap2 DIRECT=1 VARS=--var\ LIVE_CAP:2|room-switch/switch.mjs
full-play|rooms|MODE=play DIRECT=1 VARS=--var\ LIVE_CAP:1|room-full/full.mjs
full-back|rooms|MODE=back DIRECT=1 VARS=--var\ LIVE_CAP:2|room-full/full.mjs
budget|rooms|NAMES=1 DIRECT=1|room-budget/budget.mjs
idle|rooms|NAMES=1 DIRECT=1|room-idle/idle.mjs
rate|rooms|NAMES=1|room-msgs/rate.mjs
rank|rooms|NAMES=1 DIRECT=1|room-rank/rank.mjs
EOF
pass=0; fail=0
while IFS='|' read -r NAME KIND ENVS TARGET; do
  [ -n "$NAME" ] || continue
  if [ $# -gt 0 ]; then hit=0; for p in "$@"; do echo "$NAME" | grep -Eq -- "$p" && hit=1; done; [ $hit = 1 ] || continue; fi
  LOG=$L/$NAME.log; T0=$(date +%s)
  # Environment entries are word-split as a shell would, so VARS can carry spaces.
  E=""; [ -n "$ENVS" ] && E=$(eval "printf '%q ' $ENVS")
  case $KIND in
    run)    (cd "$ROOT" && eval "env $E timeout 600 $H/$TARGET") > "$LOG" 2>&1; RC=$? ;;
    node)   (cd "$ROOT" && eval "env $E timeout 600 node $H/$TARGET") > "$LOG" 2>&1; RC=$? ;;
    serve)  (cd "$ROOT" && eval "env $E timeout 600 $H/lib/serve.sh $H/$TARGET") > "$LOG" 2>&1; RC=$? ;;
    portal) Z=$(cd "$ROOT" && node tools/manta/package.mjs "$MANTA_OUT" 2>>"$LOG" | sed -n 's/.*"zip": "\(.*\)".*/\1/p')
            (cd "$ROOT" && eval "env $E ZIP=$Z timeout 600 node $H/$TARGET") >> "$LOG" 2>&1; RC=$? ;;
    rooms)  (cd "$ROOT" && eval "env $E CLIENT_TIMEOUT=560 timeout 600 $H/lib/rooms.sh $TARGET") > "$LOG" 2>&1; RC=$?
            n=$(grep -c 'client rc=' "$LOG"); bad=$(grep 'client rc=' "$LOG" | grep -vc 'client rc=0$')
            if [ "$RC" = 0 ] && [ "$n" -gt 0 ] && [ "$bad" = 0 ] && ! grep -q WATCHDOG "$LOG"; then RC=0; else RC=1; fi ;;
  esac
  S=$(( $(date +%s) - T0 ))
  if [ "$RC" = 0 ]; then V=pass; pass=$((pass+1)); else V="FAIL rc=$RC"; fail=$((fail+1)); fi
  printf "%-26s %-10s %4ss  %s\n" "$NAME" "$V" "$S" "$(grep -c '  FAIL  ' "$LOG") FAIL lines" | tee -a "$SUM"
done <<< "$TABLE"
echo "suite: $pass passed, $fail failed; logs in $L" | tee -a "$SUM"
[ $fail = 0 ]
