# Manta trains' test harnesses

Everything here runs against the repo as it stands: `docs/` served locally, or
`wrangler dev` running the rooms Worker. Nothing here is served or deployed,
nothing here may be imported by the game, and nothing here is installed into
the repo. Tools go in a scratch directory outside the repo (`MANTA_TOOLS`);
screenshots, logs and wrangler's state go to `MANTA_OUT`, which defaults to a
fresh temp directory.

## Tools, exact versions, and how to install them

Install into a scratch directory, never into the repo:

```sh
export MANTA_TOOLS=/path/to/scratch/manta-tools          # outside the repo
mkdir -p "$MANTA_TOOLS"
export PUPPETEER_CACHE_DIR="$MANTA_TOOLS/puppeteer-cache" # Chrome 153 lands here
npm install --prefix "$MANTA_TOOLS" --no-save --no-package-lock \
  playwright@1.62.1 pngjs@7.0.0 wrangler@4.141.0 puppeteer@25.11.0
```

| tool | version | used for |
|---|---|---|
| Node | v22.22.2 | everything (`node -v`) |
| Python 3 | any 3.x | `python3 -m http.server` serves `docs/` |
| Playwright | 1.62.1 | drives the browser in every harness except `browser/wgpu.mjs` |
| pngjs | 7.0.0 | pixel sampling in `h2`, `def`, `zoom` |
| wrangler | 4.141.0 | `wrangler dev` for room tests, and the deploy dry run |
| puppeteer | 25.11.0 | downloads Chrome 153.0.8010.36; `browser/wgpu.mjs` drives it directly |
| Chromium | 141.0.7390.37 (Playwright build 1194) | the browser every WebGL2 harness was measured on |
| Chrome | 153.0.8010.36 (puppeteer's) | the WebGPU harnesses: `watch`, `wgpu`, `wgpupix`, `gpu` |
| ffmpeg | 6.1.1-3ubuntu5, with libx264 0.164.3108 (Ubuntu's `ffmpeg` and `libx264-164` packages) | encodes the portal preview videos (`tools/manta/media.mjs`, 4C) |

Two browsers, set by path:

```sh
# Chromium 141: preinstalled in some of Claude's cloud containers at
export CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# elsewhere (4C: the 2-core container had build 1243, Chrome 153, there
# instead), Playwright 1.56.0 downloads build 1194, Chromium 141.0.7390.37:
#   PLAYWRIGHT_BROWSERS_PATH="$MANTA_TOOLS/pw" npx -y --prefix "$MANTA_TOOLS/pw156" playwright@1.56.0 install chromium
#   export CHROME="$MANTA_TOOLS/pw/chromium-1194/chrome-linux/chrome"
# (Playwright 1.62.1's own install fetches Chromium 151, not the build the
# WebGL2 harnesses were measured on.)

# Chrome 153, downloaded by the puppeteer install above:
export CHROME153="$PUPPETEER_CACHE_DIR/chrome/linux-153.0.8010.36/chrome-linux64/chrome"
```

Every harness launches whatever `CHROME` names. The WebGL2 harnesses were
measured on Chromium 141 with `--use-gl=angle --use-angle=swiftshader
--ignore-gpu-blocklist`, which has no WebGPU adapter, so the lab falls back to
WebGL2 and says so in its backend chip. For WebGPU, run with
`CHROME=$CHROME153`. The flags the WebGPU harnesses pass are
`--enable-unsafe-webgpu --use-gl=angle --use-angle=swiftshader
--ignore-gpu-blocklist`, plus, in `wgpu.mjs` only,
`--enable-features=Vulkan,UseSkiaRenderer --no-sandbox`. Chromium 141 does
give WebGPU an adapter with those flags, but Three.js r186's WebGPU path throws
there (`GPUTextureViewDescriptor` swizzle), so do not read a WebGPU result off
Chromium 141. A headless browser is never the phone: backend, frame rate and
look are checked on the Pixel 9.

## Running

Every runner is a shell script that captures each PID it starts and kills
by that PID. Ports are picked free at run time unless `PORT` is given. Run
browser harnesses one at a time, and never alongside a Node batch.

**Node suites** (`node/`, about 2 min, four at a time):

```sh
tests/manta/node/run.sh
```

Prints pass/fail per suite, the total, and the fingerprint: the first 8 hex
of the md5 of the PASS/FAIL lines of simtest, simtest2 to 8, simtest10 and
simtest9 with `SET=def` and `SET=big`. simtest11 runs too but stays out of the
fingerprint. `EXTRA=` (empty) skips it.

**Browser harnesses** against `docs/` on a static server:

```sh
tests/manta/lib/serve.sh tests/manta/browser/h2.mjs   # one harness
tests/manta/browser/run.sh                             # all WebGL2 ones in turn, about 12 min
tests/manta/browser/run.sh h2 zoom                     # a chosen few
```

**Room tests** under `wrangler dev`, each client once per delay through a
delay proxy (ordered TCP, RTT/2 ± jitter/2 each way):

```sh
NAMES=1 tests/manta/lib/rooms.sh room-play/playtest.mjs          # all three delays side by side
NAMES=1 ALONE=1 DELAYS="150:50" tests/manta/lib/rooms.sh room-play/playtest.mjs
DIRECT=1 PART=a tests/manta/lib/rooms.sh room-feedback/feedback.mjs
```

`lib/rooms.sh` takes `DELAYS` (default `20:0 150:50 300:100`), `ALONE=1`
(one delay at a time), `DIRECT=1` (no proxy), `NAMES=1` (`--var
TEST_NAMES:1`, which lets tests name and stage rooms), `VARS` (more wrangler
args), `WRANGLER` (default under `MANTA_TOOLS`). Every other variable passes
through to the client. It removes `.wrangler/` from the repo when it exits,
and (4C) prints `[label] client rc=N` for each client it ran. A room the
registry did not make (a test's own name, like `w1` or `c-...`) exists only
with `NAMES=1`: without it the page or client gets a 404 and, for a test
that only counts, can pass having checked nothing.

**The whole suite** (4C), one harness at a time, each under its own
timeout of at most 10 minutes, with a summary line each (name, verdict,
seconds) in `MANTA_OUT/suite/summary.txt`:

```sh
WATCHDOG_X=3 STEP_MS=6 tests/manta/lib/suite.sh             # everything, about 2 hours on 2 cores
WATCHDOG_X=3 tests/manta/lib/suite.sh 'desktop|^gpu$'        # entries whose names match
```

A `serve.sh` or Node entry passes on exit code 0; a `rooms.sh` entry when
every client exited 0 and no watchdog fired. The table at the top of
`lib/suite.sh` is the suite: every harness below with the variables it
needs, the room playtest in parts one delay at a time, the jittery-link
check and the pink manta one delay at a time, desktop one size (or page) a
run, h2 one tier a run, and the art pass one block a run. The portal entry
builds the package first. Measurements without a verdict
(`room-size/cost.mjs`, `browser/pictures.mjs`) are run on their own.

### Slow containers (4C)

Measured on a 2-core Intel Xeon container (2.8 GHz) under SwiftShader: the
lab and feedback pages draw about 1 frame a second at 412x915 at the low
tier (1.1 solo, 1.0 in a room; 1.3 on Chrome 153's WebGPU), 2.9 at 206x458,
and 4.6 with `?fx=off`. The harnesses were written where a page drew several
times that, so on such a machine:

- `WATCHDOG_X` multiplies every harness's own watchdog and `serve.sh`'s
  limit (default 1). Six browser harnesses took 96 to 128 s there against
  watchdogs of 80 to 89 s (s1 126, schemes 96, def 116, rows 104, newocean
  128, zoom 98); the suite ran with `WATCHDOG_X=3`.
- The page-based room tests load the page with `?fx=off` (names, play mode,
  bhits, fbcuts, feedback, labels, budget, switch, watch mode), as do
  `hint.mjs` and `room-radar/radar.mjs`: they test the network, the game and
  the interface, not the look, and at a frame a second a page handles its
  room's messages only between second-long frames, so their real-time
  windows measured the drawing instead (play mode counted 15 corrections in
  20 s, bhits saw no contact frame, the hint's fade had not drawn a frame).
  The look is measured by h2, pictures, artpass and the covers, which keep
  it on.
- `STEP_MS` sets `roomtest.mjs`'s bar for a room step (default 3): the same
  code measured 4.16, 2.45 and 4.43 ms there, so 6.
- `room-six/six.mjs` part 4 (the jittery link) runs alone, one delay at a
  time (`PARTS=4 ALONE=1`): with the other delays alongside it it reached 3
  units; alone, 1.18 to 1.29 at 150:50 and 300:100. Its bar is now 1.5
  (`JITTER_UNITS`), see the file.
- Screenshots of big pages take longer than Playwright's 30 s default: a
  2560x1440 desktop screenshot took 20.7 to 33.0 s, the 300-long train of
  `pictures.mjs` 42 s; those harnesses allow 150 s.
- Every harness's 30 s page timeouts (Playwright's `setDefaultTimeout` and `setDefaultNavigationTimeout`) are 30 s times `WATCHDOG_X`: late in 4C, screenshots here began to wait over 30 s for fonts (`def.mjs`, `zoom.mjs`). A wait that relies on the default is a bar three times looser in the suite here; unset, nothing changes.
- `browser/zoom.mjs` judges the zoom's change per real frame only on frames with no driven step in them, and the death beat's 100 steps one by one (2% a sixtieth): a burst of driven steps runs inside one evaluate, so the real-frame log saw it as one long frame (7.17% per 1/60 s on a 270.9 ms frame, three times). Its wake check ("a wake stays where it was laid through a zoom step") now runs from a short train, turning, and asks that the view widened and the run did not change: until late in 4C it ran straight after the far end, where the zoom already sits on its floor, so lowering `zoomNear` widened nothing, the leader swam on along one heading for up to ten seconds, and the step it caught was the memory shrinking (most likely after a crash into the reef and a restart elsewhere), which left the point outside the square now and then. The short train is moved 1300 units east of the centre first (every laid train starts inside the long spiral's wake), clear water is the darkest of four patches half a square away, and the zoom is brought back in driven steps afterwards, so no real frame eases from 0.6 to 1.5. The per-frame check's message names its worst frame (index, the frame before's length, train length, zoom).
- `room-radar/room.mjs` judges "no line ever streaks across the map" per segment: under `RADAR_RES` (60) plus a burst's swim (470 units a second) over the room time between the two reports that laid it, by the snapshots' own step count. The room catches up to 12 steps in one tick when its ticks run late, so a 5 Hz report here carried up to 0.47 s of swimming and one honest segment measured 157 units against the old flat bar of 150 (4C's fourth full pass, at 20:0). A restart is a new run and starts a new line, so a streak is still any segment over its bound; the joining path keeps 150.
- `room-shark/shark.mjs` measures the whale shark's speed over the room's own clock (each snapshot's time), not per snapshot times 20: the room's ticks ran about 55 ms apart here.
- The suite runs `room-hits/hits.mjs` one delay at a time (`hits-20`, `hits-150`, `hits-300`, `ALONE=1`): with all three side by side the Node client's own loop stalled (contact to flash p95 788 ms at 20:0) and at 300:100 confirmations came after their predictions had expired. The crash run of `bhits.mjs` gets 70 s.
- `room-base/watchmode.mjs` reads the positions after Step once two more frames have been drawn: Step is spent in the page's next frame.
- `browser/raywake.mjs` and `browser/zoom.mjs` allow page loads and screenshots 30 s times `WATCHDOG_X` (a lab page load and a zoom screenshot each took over 30 s once here).
- `room-pink/pink.mjs` gives the burst chase up to 60 s and the room keeps the pink 90 s (`PINK_STAY:90`): over twelve runs here the chase took 2.8 to 19.8 s, and once, at 300:100, outlasted a pink that stayed 40 s. It also judges "cruising at it catches nothing" by no catch event and no jump of the reward in the length: the phone chasing at cruise crashed on the way (length 0) twice in nine runs here, which is not a catch.
- `room-hits/bhits.mjs` plays for `SECS` seconds (22 by default; the suite gives it 40, as a crash run had one contact in 22 s once), and its one-set-piece-per-hit check allows for hits of yours that land off screen, which fire nothing (follow.js counts them).
- `room-names/names.mjs` `PART=clean` reads the board up to ten times, 300 ms apart, until every name whose train is in the top ten is on it: the board is redrawn on its own beat, the trains with every snapshot.
- `room-play/playmode.mjs` judges the page's prediction on at least 40 corrections (80 until 4C; at 20:0 the page here counted 63 to 94 in 20 s) and waits up to 5 s (2 s until 4C) for the room to say you are bursting (at 300:100 it had not within 2 s once in nine runs).
- `room-full/full.mjs` (`MODE=back`) judges a first load by the page's own 5 s (note=full rather than note=slow; the page starts its 5 s when the room starts trying), not by the test's clock from the load event, which also counts the page's modules and first frames: 5.8 s once in 4C's first full pass.
- `browser/def.mjs`'s zero-second step allows the renderer's rounding: under SwiftShader two draws of the same frame differed at 1, 2, 1 and 0 pixels by one level in four runs; the bar is 0.01% of the ocean and two levels, where a shader on the wall clock moves the whole ocean.
- `browser/s1.mjs`'s "animating" check waits for two drawn frames as well as 700 ms between its two shots: at 1 to 2 frames a second two shots could catch the same frame (landscape, once, in 4C's first full pass).

**`__lab.step` and the post pipeline** (4C). Three renders the post
pipeline's scene pass and bloom once per animation frame (its node frame),
and `__lab.step` does not start one, so several steps in one `evaluate`
redraw only the final quad over the scene pass of whichever animation frame
came last; the shadow pass is drawn only by the loop. A harness that reads
pixels after a burst of steps should yield an animation frame
(`requestAnimationFrame`) before the last step, as `classic.mjs` and
`pictures.mjs` (its `settle`) do, and read the canvas back in the same task
as that step (`toDataURL`), not with a screenshot, which waits for the
compositor.

## The harnesses

One line each: what it checks, how to run it, roughly how long.

### Node suites, `node/` (no browser, no server)

- `simtest12.mjs`: the pink manta (4A): appears after the wait, clear of every leader, one at a time; flees at 260 and outruns a cruising leader; caught only by a burst, adding exactly 10 once; a touch without bursting does nothing; greedy bots chase it hardest, timid ones rarely; off, nothing appears. Out of the fingerprint set. About 60 s.
- `simtest13.mjs`: the whale shark (4A, off by default): with it on, it appears every sharkEvery after the last left, stays about 40 s, crosses at its speed and turns at one constant rate per appearance; a straight train laid across its path is cut at the crossing and everything behind becomes debris while the leader swims on; a leader set down on its body crashes (how: shark); bots steer clear of it, measured as crashes into it per bot per five minutes; off, nothing appears. Out of the fingerprint set. About 15 s.
- `simtest.mjs` to `simtest11.mjs`: the simulation's rules, bots, pickups, cuts and the close-up zoom in plain Node, imported straight from `docs/lab/manta/`. Run all with `node/run.sh`; each well under 90 s. `simtest9.mjs` takes `SET=def` or `SET=big`. `disperse.mjs` is a helper `simtest2` imports.

### Browser harnesses, `browser/` (via `lib/serve.sh`; each up to 90 s)

- `h2.mjs`: the four conditions at every tier at the near zoom, with pixel sampling. `TIERS`, `PIN`, `RADIUS`, `MOON`, `SET` env; `BACK=gl` forces the WebGL2 fallback, which is what it measures on Chromium 141 (from 4A the WebGPU attempt there no longer falls back by itself on every build, and the clean-water frame then dies on the swizzle error). About 80 s.
- `s1.mjs`: the lab page's layout, portrait and landscape, panel and drawer. About 30 s.
- `cam.mjs`: the camera sits on your leader and the same-area rule holds. About 40 s.
- `wake.mjs`: a wake stays on the water it was laid on while the camera moves. About 40 s.
- `setpiece.mjs`: one explosion per crash and one burst per cut, on screen. About 60 s.
- `pool.mjs`: every simulated manta is drawn, nothing solid is left over. About 40 s.
- `tidy.mjs`: the growing pool: uploads per frame after growth. About 40 s.
- `schemes.mjs`: each touch scheme steers and bursts through real PointerEvents. About 60 s.
- `probe.mjs`: the page compiles its shaders on WebGL2 with no console errors. About 15 s.
- `def.mjs`: the committed defaults, the scene clock and the step hook; `BACK=gl` as for h2. About 40 s.
- `rows.mjs`: the wild and mantas rows and the ordinary wild count. About 40 s.
- `newocean.mjs`: New ocean in the page. About 40 s.
- `zoom.mjs`: the close-up camera: zoom against length, labels and radar at both ends, a wake through a zoom step, the ease after a cut, a restart's first frame. About 80 s.
- `keys.mjs`: desktop controls (4A): from four headings, every arrow or WASD key and every pair turns the manta towards the matching screen direction at its normal rate; the mouse steers towards the pointer at the near and the far zoom; space and a held button burst; right-click opens no menu. Real key and mouse events, the loop paused and the simulation stepped by hand. About 40 s.
- `hint.mjs`: the controls hint (4A): the mouse-and-keys line on a desktop, the hold-and-double-tap line on a phone, on the lab and feedback pages; visible, fading after five seconds on a real clock, gone at once on the first burst; `?hint=0` keeps it off. About 60 s.
- `bzoom.mjs`: the burst zoom (4A): a burst widens the view 12% with a smoothstep ease out over 0.3 s and back over 0.6 s, the close-up camera untouched, the view the room is told widening with it, reduced motion halving it, the slider at 0 turning it off. About 30 s.
- `desktop.mjs`: the desktop layout (4A) at 1366x768, 1920x1080 and 2560x1440 with a mouse: the feedback page (solo, and the first visit's name panel) and the lab page, nothing overlapping, text at least 13 px, the radar growing with the screen, no overflow; screenshots `desk-<w>x<h>[-name|-lab].png` in `MANTA_OUT`, to be looked at. `SIZE=1920x1080` picks one size and `PART=feed|name|lab` one page; 2560x1440 needs the parts, each about 40 s. (4C: it steps past the first swim's reveal, which hides the board for 1.2 s, before measuring, and sets aside python's 501 to the first visit's POST to the rooms, which the static server cannot answer.)
- `pink.mjs`: the pink manta on screen (4A): drawn in its own slot where the simulation has it, dark from above and pink while it rolls, a pink dot on the radar, a pink light burst where it is caught, ten followers at once. About 40 s.
- `shark.mjs`: the whale shark on screen (4A): off by default with its mesh hidden; turned on through params and set across your bow on a held page, its mesh sits at its body's centre at its heading, it stamps the plankton's light along its body, the radar outlines it in grey, and swimming across its path cuts your train with your leader swimming on. About 40 s.
- `classic.mjs`: pixel-for-pixel comparisons at a fixed seed and step (4A): `?paused=1` holds the page at its first frame and `__lab.step` drives it. `MODE=self` loads one recipe twice and expects identical canvases; `MODE=ref REF=<png>` saves a reference; `MODE=cmp REF=<png> Q=<query>` compares. `STEPS` (45) sixtieths, the last after an animation frame and read back in the same task (4C, see "`__lab.step` and the post pipeline"). About 40 s. (4C: built against `?look=classic`, which 4C removed; used then to show the look unchanged. Across browser launches the frame at seed 7 and 45 steps comes out in one of two states, on the old code and the new alike, so compare like with like: `self` is within one launch.)
- `pictures.mjs`: the pictures (4A stage 6): each scene a seed and a staged moment at 412x915 on WebGL2 at the high tier (first, firstswim, cut, crash, giant, radar, pinkflash, catch, sharkcut), one picture each (until 4C the first six were pairs against `?look=classic`, removed in 4C). Pictures, not checks: only that every page drew without console errors. `SCENES=` picks; output in `MANTA_OUT/pics`. On a 2-core container `giant`'s screenshot alone takes about 42 s (its limit is 150 s), so run the scenes in two or three goes under `HARNESS_TIMEOUT=500`. About 25 s a scene.
- `artpass.mjs` (4A stage 3): the art pass's five changes against reduced flash and motion (until 4C also against `?look=classic`): the cut's kick and slash, the crash's vignette and count-up, the recruit's pop and deposit boost, the burst's hotter wake (from 4C against a cruise at the burst's speed) and the first swim's reveal. `CHANGE=1` to `5`, one block a run. About 40 s a block.
- `spill.mjs` (4B): debris past the wild block is drawn as the block draws it: two identical loose mantas laid in the paused solo lab, one in a block slot and one past the block, sinking half way, glowing half way and plain, and the page's own drawing code dresses both; their size and tint must match. A room's 570 wild mantas leave the block room for 110 scattered at once, so a long crash in a room spills. About 20 s.
- `camera.mjs`: the close-up camera's restart and cut, with no rival trains and a train swimming straight so nothing can crash it: a restart's first frame at the curve for its length, read on that frame; after a cut that halves the train, the view eases back in. About 30 s.
- `raywake.mjs` (4C): the name is Raywake: both pages' `<title>` as served and once up, the first visit's name panel with "Raywake" over the box in portrait, landscape and a very short landscape (screenshots `raywake-name-<w>x<h>.png`), the privacy note, a private room's Share button only where there is a share sheet ("Swim with me in Raywake" and the link), and the name still kept under `manta:name`. About 40 s.
- `best.mjs` (4D part 1): your best kept on the device under `manta:best` (design doc 10.8): a fresh device shows 0; a run to 37 that crashes writes 37 and the death card says "best 37"; a new visit shows it on the stats and score lines; a lower run keeps it; the lab page (whose tests lay long trains) never writes it; with storage blocked the page plays and crashes as normal. About 40 s.
- `card.mjs` (4D part 2): the death card (design doc 10.8, card.js) on the feedback page in solo, the loop paused and stepped by hand: what got you named ("You ran into bot N", "You hit the reef"), the peak counting up from 0 over 0.8 s of the beat's scene time (which the crash's slow motion stretches), a first visit's "New best!", time alive, a cut you landed and your best rank; the train held dead past the beat with "Tap to swim again" up; real taps (and Space with a keyboard) skip the beat and then start the next run, one in the first 0.35 s of a crash doing nothing; reduced flash and motion keeps every word without the pop; the lab page holds nothing; and the card at a pixel ratio of 1 at 800x450 and 1080x607 with a mouse and on 412x915 and 360x800 phones, on screen, unclipped, text at least 13 px (11 on a phone) and clear of the board, radar, score and stats lines (screenshots `card-<w>x<h>.png`, to be looked at). `HARNESS_TIMEOUT=180`; about 2 min.
- `watch.mjs`: the WebGPU error watch: the page's errors and error-watch rows. Run with `CHROME=$CHROME153`; `BACK=gl` for the WebGL2 side. About 30 s.
- `gpu.mjs`: the WebGPU sweep 0 to 650 and a cut to 150, zero page errors. `TIER` env; run with `CHROME=$CHROME153`. About 60 s. (4C: the known headless artefact "Instance dropped in popErrorScope" is counted apart when it comes as a page error too, as it already was as a console line.)
- `wgpu.mjs`: does headless WebGPU draw at all; puppeteer, so `CHROME` is optional. About 30 s.
- `wgpupix.mjs`: can WebGPU pixels be read back headless. `CHROME=$CHROME153`. About 30 s.

### Room tests (via `lib/rooms.sh`; each up to 10 min)

- `room-base/roomtest.mjs`: an ocean room with Node clients, and a step's time inside workerd on the room's own ocean (from 4B: 21 trains, radius 2760, 570 wild; under 3 ms). Its bytes check is the doc's bar from 4C (10.6: median under 10 KB/s per client, 95th percentile under 16); until then it was a tighter 8 KB/s of its own, which a watcher here measured at 6.7 to 8.7 KB/s over five runs. `NAMES=1 DIRECT=1` (its rooms are test names: without `NAMES` four of its checks see no room at all, as they have since 3G's room limits). About 3 min.
- `room-base/devcheck3b.mjs`: the static site and the rooms through wrangler dev: 404s, the origin rule, the edge echo and the "probe" room's echo (pings paced at one every 40 ms, under the rooms' 30 a second) and "who". `DIRECT=1`. About 40 s.
- `room-base/watchmode.mjs`: watch mode in the page. `NAMES=1 DIRECT=1` (its room `w1` is a test name; until 4C the README said `DIRECT=1` alone, which gets a 404 since 3G). Pause holds what is drawn and Step moves it on, after a pause of any length up to a minute (4C fixed the Step: roomview.js now keeps the snapshots the held moment needs). About 60 s.
- `room-play/playtest.mjs`: the play-mode bars (corrections, cuts, bytes, drops, restart) with the phone's own code. `NAMES=1`, `PARTS=corr,cut,bytes,drop,restart`, ideally `ALONE=1`. About 4 min per delay.
- `room-play/playmode.mjs`: play mode in the page through a proxy. `NAMES=1`. About 90 s per delay.
- `room-compact/compact.mjs`: compact snapshots through a proxy. `NAMES=1` (a test-named room; without it every check but the bytes one sees nothing). About 90 s.
- `room-six/six.mjs`: the review's six findings, each a test. `NAMES=1`; `PARTS=1,2,3,5,6` and, alone, `PARTS=4 ALONE=1 DELAYS=...` for the jittery link (4C). About 3 min.
- `room-limits/limits.mjs`: room limits, with test names OFF. `DIRECT=1 VARS="--var CODE_TTL_MS:4000"`. About 60 s.
- `room-feedback/feedback.mjs`: the feedback page `/lab/manta/play/`. `DIRECT=1`, once with `PART=a` and once with `PART=b`; `OFF=1 DIRECT=1 VARS="--var ROOMS_OPEN:false"` for rooms switched off (4B: the plain off note). About 60 s each.
- `room-plays/plays.mjs` (4C): the play counter, the feedback box and the lab panel's plays and messages (design doc 10.6). `MODE=on NAMES=1 DIRECT=1 VARS="--var FEEDBACK_KEY:raywake-test-key"`: the Worker takes /count, /feedback and /plays only by POST from this site; a count is five small numbers (an address, a name or anything else refused); feedback over 500 characters refused, 500 emoji taken; three a day from one address, the fourth refused, another address let in; each is one Worker and one registry request on the budget guard; at 80 percent both rest; the page sends nothing while on screen and one sendBeacon when hidden (v=1, the run, returning yes only for a day kept from an earlier UTC day), nothing more inside 5 minutes of play, one more past them; a room join counted once; the counts in today's row; the feedback box sends, says when it is over 500 characters, refused, resting or unreachable; the lab panel asks nothing until tapped, shows 7 UTC days, says a wrong key is wrong, shows the latest messages as plain text with the right key and remembers it under `manta:feedbackKey`; and no address, user agent or name in any file of the stored state (`PERSIST`, which rooms.sh now passes). `MODE=off DIRECT=1 VARS="--var ROOMS_OPEN:false"`: the box and the panel say rooms are off, a count is refused. Screenshots `plays-feedback-box.png`, `plays-lab-panel.png`. About 2.5 min on, 40 s off.
- `room-feedback/fbcuts.mjs`: the feedback page's "cuts landed" in the staged room. `DIRECT=1`. About 60 s. (4C: it keeps a name on the phone, as since 3J a first visit watches under the name panel and is never seated.)
- `room-pick/pick.mjs`: pickups through the proxy with the phone's own code. `NAMES=1`. About 90 s.
- `room-labels/labels.mjs`: labels over leaders. `DIRECT=1`, `PART=solo|room|crash`. About 60 s each.
- `room-names/names.mjs`: typed names. `DIRECT=1`, `PART=first|clean|change`. About 60 s each. (4C: `PART=change` times the pencil's name socket to socket, from B's WebSocket frame leaving to A's arriving, by the browsers' own frame timestamps, and passes when at most one binary snapshot reached A in between, which is the doc's "within one snapshot": the milliseconds swung from 21 to 227 over six runs here, as two SwiftShader pages starve the room's ticks, so they are reported, not judged. The page's own lag is reported beside them. `PART=first` judges the lobby's bots swimming frame by frame, summed per bot while it stays in view, since a bot read once before and once after had often left the view.)
- `room-names/inplace.mjs`: the first visit plays in place. `DELAYS=20:0`. About 60 s.
- `room-hits/lag.mjs`: the hit lag broken into its parts. `NAMES=1`. About 90 s.
- `room-hits/hits.mjs`: your own hits at once. `NAMES=1`. About 90 s.
- `room-hits/bhits.mjs`: the feedback page in the staged cut room. `DIRECT=1`, `MODE=crash|cut`. About 60 s each.
- `room-bytes/bytes.mjs`: bytes per phone at the far zoom with a 500-long train. `NAMES=1`. About 90 s. (Until 4C this line also asked for a run with `VIEW_W=1077 VIEW_H=2395`, the view widened by the burst zoom. No phone reports that view: since 4A the room is told the base view through a burst (follow.js `baseView`; `bzoom.mjs` checks it), because reporting the wider one measured over the 10 KB/s bar, which is what that run still shows, 12 to 13 KB/s before 4C and after. So it is not run.)
- `room-pink/pink.mjs` (one delay at a time on 2 cores, `ALONE=1`): the pink manta through a room (4A): the snapshot carries it from its appearance, cruising at it catches nothing, bursting at it catches it with the length up by exactly 10 once and the room's event naming the phone, one at a time, bytes within the bar. `NAMES=1 VARS="--var PINK_WAIT:4 --var PINK_STAY:90"` (`PINK_STAY:40` until 4C; the chase now has up to 60 s). About 60 s per delay.
- `room-shark/shark.mjs`: the whale shark through a room (4A): the snapshot carries it from its appearance (flag 64), it moves at its speed on one course whose heading changes between snapshots stay within the wire's one-byte step, the staged room's `?shark=cross` sets it across the seated 40-long train at its appearance and the train is cut there (this phone's length down, the room's cut event with no cutter), a leader driven into its body crashes with the room's crash event naming the phone, its own share of the wire (five bytes a snapshot) and the room's 95th percentile within the bar, the room's median reported. `NAMES=1 VARS="--var SHARK_ON:1 --var SHARK_EVERY:5"`. About 60 s per delay.
- `room-radar/room.mjs`: the radar in a room through the proxy. `NAMES=1`. About 90 s. (4C: a path segment is judged against how far a leader can swim between the two reports that laid it; see "Slow containers".)
- `room-radar/page.mjs`: the radar on the feedback page, and (4B) that it maps the room's whole arena, radius 2760, onto its disc with every train inside it. `DIRECT=1`. About 60 s.
- `room-overflow/overflow.mjs`: overflow rooms: 45 joiners land 20, 20 and 5 (4B: 20 seats a room); a leaver's seat goes to the next joiner; the feedback page and a first visit's Play swim in the fullest room with a seat; the cap holds; every room full, the feedback page goes solo with its note. `DIRECT=1 VARS="--var LIVE_CAP:4"` (the cap lowered so a few dozen phones reach it). About 60 s.
- `portal/portal.mjs`: the portal package (`node tools/manta/package.mjs`), unzipped and served gzipped from another origin under `/game/`, directly and in a cross-origin iframe: first frame and play within 20 s on a 300 ms, 1.5 Mbit/s link; zero requests outside the package and no room connection; WebGPU, WebGL2, and the WebGL2 fallback in an iframe without WebGPU; portal mode (no room buttons, chip, corner press or name box; the privacy note); nothing stored but the `manta:` keys the design doc names (4D: `STORED_OK` in the file); no console errors or horizontal overflow, both orientations; three touch schemes. `ZIP=<the zip> CHROME=$CHROME153 node tests/manta/portal/portal.mjs`, no server needed; `NOGZIP=1` measures the load served uncompressed. About 70 s. (4C: a WebGPU device lost in the first frames now rebuilds on WebGL2, as a first draw that throws does; the direct load accepts that only with the page's note saying so.) From 4C it runs in parts, `PART=load|frames|rules|hz`, all four when unset (about 6 min; the suite runs them as four entries). `frames`: the game read at DPR 1 at 800x450 and 1080x607 with a mouse and at 412x915 and 360x800 as a phone, the board, radar, labels, hint, death card, name chip and the screenshot each inside the window, unclipped and at least the doc's sizes, with `portal-<w>x<h>[-hint|-dead].png` in `MANTA_OUT`. `rules`: straight into a swim under a generated name (no name box), the pencil changing it for the visit and storing nothing, no fullscreen button, no link but the privacy note's, no Play with friends, feedback box or play counter, zero external requests, English only. `hz`: the same seeded swim with the same inputs at 60, 144 and 165 Hz on a virtual clock (the page's `requestAnimationFrame` and `performance.now` replaced before it loads), the step log identical at all three, 60 steps a second, and cruise speed and turn rate per second the same. (4C, `frames`: if your leader crashed into one of the twenty bots in the 1.6 s stepped before measuring, it steps on past the death beat first, and says so; a restart is still off the ten.)
- `room-rank/rank.mjs` (4C): your rank under the board. In Node with roomcore.js: a player's snapshot carries its rank (flag 128, one byte) first and whenever it changes, in the board's order, and a watcher gets none. Solo with 21 trains (`?bots=20`) outside the top ten: the line under the ten, set apart, with rank, name and length; on the board, no line. In the public room: in every snapshot that carries every train's length (the radar's five a second) the rank the room last told matches (a benched player's snapshots, which carry no record of its own, are not judged), and at every redraw of the board the line says that rank. `NAMES=1 DIRECT=1`; `PART=wire|solo|room`. Screenshots `rank-solo.png`, `rank-room.png`. About 70 s.
- `room-radar/radar.mjs`: the radar in the solo lab: a static-server harness, so run it with `lib/serve.sh`. About 60 s. (4C: the range check counts the trains it expects across a radar draw, and only when that count held from just before the draw to just after it: a bot crashing between the drawn count and the expected one failed it once.)
- `room-switch/switch.mjs` (4B): the switches Nathan changes in Cloudflare's dashboard. `MODE=off DIRECT=1 VARS="--var ROOMS_OPEN:false"`: every rooms request refused, the feedback page solo with the plain off note well inside 5 s (a returning player, a first visit, a private room's link), the lab page saying so and no longer trying. `MODE=on DIRECT=1`: `?fake=off` and `?fake=full` give the off and full notes while a phone going straight to lobby still plays, the live cap defaults to 3, wrangler.jsonc keeps dashboard variables and declares neither switch. `MODE=cap2 DIRECT=1 VARS="--var LIVE_CAP:2"`: the variable is read. Needs `CHROME`. About 60 s a mode.
- `room-full/full.mjs` (4B): "every room is full" reaches solo with the plain note after the page has joined, through wrangler dev. `MODE=play DIRECT=1 VARS="--var LIVE_CAP:1"`: lobby full with 20 scripted players, a first visit presses Play on its name panel and goes solo with the full note. `MODE=back DIRECT=1 VARS="--var LIVE_CAP:2"`: a player's private room empties while its page is hidden and another room takes the last live slot; shown again, the page is refused, asks why (`/lab/manta/rooms/status?room=`) and goes solo with the full note instead of reconnecting forever; a first load of that link goes solo with the full note inside 5 s. Needs `CHROME`. About 60 s a mode.
- `room-budget/budget.mjs` (4B): the daily budget guard through wrangler dev, `NAMES=1 DIRECT=1` (the registry's test controls at `/lab/manta/rooms/budget` answer only a local request with `TEST_NAMES`): every message and connection counted exactly and the room's ticking time within 1.5 s, with no request of the guard's own; at 80 percent a new player told rooms are resting until 00:00 UTC while one already in plays on, and the public game saying so; watchers too (the lab page watching turned away, a first visit's name panel solo with the note); the lab panel's "rooms today" line at 50 percent; the feedback page in Sydney's time zone at `?fake=80` (solo, "until 11:00 am") and `?fake=95` in the staged room (the crash, the death card, then solo); the count reset at 00:00 UTC on a moved clock; the guard made to fail with rooms playing on. Needs `CHROME`. About 90 s.
- `room-budget/unit.mjs` (4B): what a room does with the day's budget, in plain Node with the room's own `rooms/ocean.js`: new players refused at 80 percent, one taking back its held manta let in, a level three minutes old or from before midnight ignored, only a fresh room's first hello waiting for the level and nobody when the guard is down, solo after the crash at 95 percent (the crash first, then the note), watchers refused at 80 percent and sent away at 95 so a room of watchers alone stops ticking, `?fake=80` and `?fake=95` for one phone, the milliseconds ticked. `node tests/manta/room-budget/unit.mjs`, about 25 s.
- `room-idle/idle.mjs` (4B): a quiet page no longer keeps its room ticking, through wrangler dev, `NAMES=1 DIRECT=1`: a watcher pinging every second is never closed; the lab page in play mode, hidden (document.hidden faked and the event fired), says it is away and sends nothing, and the room closes its socket about 60 s later; still hidden it does not reconnect; shown again it reconnects at once and is seated; a retry armed while on screen that fires after the page is hidden parks too; a page opened hidden whose first socket fails tries again and joins. Needs `CHROME`. About 2.5 minutes.
- `room-msgs/rate.mjs` (4B): incoming messages per player per second, by type, on four inputs: a scripted thumb on scheme A (slow swings, tremor, a sharp turn every 5 to 9 s, a burst every 3 to 5 s, from a fixed seed), and playtest.mjs's corrections, bytes and staged cut phones. Also how long each burst press took to leave the phone and which step it was stamped for, the corrections to your own leader and the inputs the room said came late. Its `playclient.mjs` uses the phone's own roomplay.js for steering and the page's rule for the view and the ping (or roomplay's own `tick` when it has one). `NAMES=1 tests/manta/lib/rooms.sh room-msgs/rate.mjs`; `PARTS=thumb,corr,bytes,cut`, `MEASURE_S` (60). About 70 s per delay.

- `room-card/unit.mjs` (4D part 2): the death card through a room, in plain Node with the room's own `rooms/ocean.js` (as `room-budget/unit.mjs`): a seated phone swims for the reef until it crashes; the wreck carries what got it (into, how; PROTOCOL 6); with `h:1` in its hello the train holds dead past the beat and `{t:'go'}` brings it back as a new run, without it the train comes back by itself; a held train whose player is benched goes to a bot, which brings it back; a hello with `h:2` is refused. `node tests/manta/room-card/unit.mjs`, about 60 s.

### Room cost in plain Node, `room-size/` (no browser, no server)

- `cost.mjs` (4B): a room's step cost and bytes per phone, with the room's own `rooms/ocean.js` loaded in Node (a copy in `MANTA_OUT`, patched in memory only: imports pointed at `docs/lab/manta/`, the seat count raised to n-1 when it is lower, and timing hooks), on a clock the harness moves 50 ms a tick and a seeded `crypto`. n-1 phones are seated; each step is timed on its own and given an equal share of its tick's snapshots. `SIZE=scaled` (default) sizes the ocean for n mantas (n-1 trains swim: the room's own solo manta is parked out of the water; arena 2000 x sqrt(n/11), 300 x n/11 wild, each to the nearest 10) by serving the room a params.js with those defaults; `SIZE=room` takes the room as it is. `PLAYERS=bot` steers each player as the bot brain would, so trains grow as bots' do; `PLAYERS=brain` sends no inputs, so the room benches every player and the brain drives all n-1 trains inside the timed steps while every phone is still sent its snapshots (the dearest room there is: the step-cost bar is judged on it). `BYTES=1 ZOOM=near|mid|far|burst` counts what each phone is sent and sends, with WebSocket framing (near 257x570, mid 363x806, far 962x2137, burst 1078x2394 on a 412x915 screen); `BREAKDOWN=1` splits the snapshots' bytes by section, over every second and over the dearest 5%. The step cost is only clean with nothing else running: give it the machine. `N=11,21 PLAYERS=bot WARM_S=300 MEASURE_S=120 node tests/manta/room-size/cost.mjs`: about 2 min for those two; n=51 alone takes about 8 min, so give it its own run. Rows go to `MANTA_OUT/room-cost.json` as each n finishes.

Each room test directory carries its own `playclient.mjs`, the scripted phone
as it was when that test was written. They differ; do not merge them without
re-running every test that imports one.

### Acceptance tests, `accept/` (no browser, no server)

- `accept.mjs`: the design doc's acceptance tests 3, 4 and 6 against the real simulation, moved out of `docs/` in 3O; the recorded sweeps are `accept-sweeps.txt` and `accept-3e.txt`. `node tests/manta/accept/accept.mjs 3 0 3` (three seeds, about 45 s); `6` takes a second; the full sweeps take far longer than 90 s.

### Shared

- `lib/serve.sh`: serves `docs/` on a free port and runs one harness with `PORT` set.
- `lib/rooms.sh`: wrangler dev, delay proxies and clients, as above.
- `lib/delayproxy.mjs`: the delay proxy. `LISTEN`, `UPSTREAM`, `RTT`, `JITTER` env.
- `lib/tools.mjs`: resolves Playwright and pngjs from `MANTA_TOOLS`.

## Portal media (4C)

`tools/manta/media.mjs` renders the portal covers and preview videos from
the game itself (design doc 10.7); it is a tool, not a harness, and its
output goes to the directory it is given, never the repo:

```sh
node tools/manta/media.mjs covers  "$OUT"   # raywake-cover-1920x1080.png, -800x1200.png, -800x800.png (about 3 min)
node tools/manta/media.mjs video16 "$OUT"   # raywake-preview-1920x1080.mp4
node tools/manta/media.mjs video23 "$OUT"   # raywake-preview-1080x1620.mp4
node tools/manta/media.mjs plan    "$OUT"   # the video's steering run without frames: lengths, deaths, crashes and cuts
```

It needs `MANTA_TOOLS` and `CHROME` (Chromium 141, as above) and, for the
videos, ffmpeg. The videos are drawn frame by frame on a fixed clock (the
lab page with `?paused=1`, stepped a thirtieth of a second per frame) and
each frame read back from the canvas as PNG; ffmpeg then encodes the PNGs
at 30 frames a second. The encoder used for 4C's videos: ffmpeg
6.1.1-3ubuntu5 (Ubuntu 24.04) with libx264 0.164.3108, `-c:v libx264
-preset slow -crf 20 -pix_fmt yuv420p -profile:v high -movflags +faststart
-an` (silent, H.264 High, yuv420p, the index at the front). The game's own
slow motion at a crash or a cut (`cut.update` in main.js) is in the video
as a player sees it: nothing is sped up or slowed down by the tool.

What 4C's videos show, checked frame 0 against the cover's raw frame
(byte-identical, both shapes) and every twentieth frame as contact
sheets: you live all 18 s with about 40 behind you, a blue bot's train
crosses close at 3 to 5 s, and from about 6 s the autopilot keeps to open
water inside the reef, whose warm glow fills one side of the frame. The
landscape video meets the orange train again near the end; the portrait
one is a quieter swim along the reef. The two part ways after about 6 s
although the seed, steps and keys are the same: the size of the page
changes what the game does, most likely because its slow motion at a
crash or a cut plays only when that is on screen (not chased further).
For the same reason `plan`, which runs at 240x135, foretells the opening
seconds but not the rest of a video (its run had the orange train
crashing into your body at about 4.9 s; the videos do not show that).

## The deploy dry run

Any commit touching `rooms/`, `wrangler.jsonc` or a simulation module the Worker
imports passes this first, from the repo root:

```sh
node "$MANTA_TOOLS/node_modules/wrangler/bin/wrangler.js" deploy --dry-run --outdir "$MANTA_OUT/dry"
```

and nothing from `tests/` may appear in the bundle.
