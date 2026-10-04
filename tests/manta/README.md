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

Two browsers, set by path:

```sh
# Chromium 141: preinstalled in Claude's cloud containers at
export CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# elsewhere: PLAYWRIGHT_BROWSERS_PATH="$MANTA_TOOLS/pw" npx --prefix "$MANTA_TOOLS" playwright install chromium
# and point CHROME at the chrome binary it reports.

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
through to the client. It removes `.wrangler/` from the repo when it exits.

## The harnesses

One line each: what it checks, how to run it, roughly how long.

### Node suites, `node/` (no browser, no server)

- `simtest.mjs` to `simtest11.mjs`: the simulation's rules, bots, pickups, cuts and the close-up zoom in plain Node, imported straight from `docs/lab/manta/`. Run all with `node/run.sh`; each well under 90 s. `simtest9.mjs` takes `SET=def` or `SET=big`. `disperse.mjs` is a helper `simtest2` imports.

### Browser harnesses, `browser/` (via `lib/serve.sh`; each up to 90 s)

- `h2.mjs`: the four conditions at every tier at the near zoom, with pixel sampling. `TIERS`, `PIN`, `RADIUS`, `MOON`, `SET` env. About 80 s.
- `s1.mjs`: the lab page's layout, portrait and landscape, panel and drawer. About 30 s.
- `cam.mjs`: the camera sits on your leader and the same-area rule holds. About 40 s.
- `wake.mjs`: a wake stays on the water it was laid on while the camera moves. About 40 s.
- `setpiece.mjs`: one explosion per crash and one burst per cut, on screen. About 60 s.
- `pool.mjs`: every simulated manta is drawn, nothing solid is left over. About 40 s.
- `tidy.mjs`: the growing pool: uploads per frame after growth. About 40 s.
- `schemes.mjs`: each touch scheme steers and bursts through real PointerEvents. About 60 s.
- `probe.mjs`: the page compiles its shaders on WebGL2 with no console errors. About 15 s.
- `def.mjs`: the committed defaults, the scene clock and the step hook. About 40 s.
- `rows.mjs`: the wild and mantas rows and the ordinary wild count. About 40 s.
- `newocean.mjs`: New ocean in the page. About 40 s.
- `zoom.mjs`: the close-up camera: zoom against length, labels and radar at both ends, a wake through a zoom step, the ease after a cut, a restart's first frame. About 80 s.
- `keys.mjs`: desktop controls (4A): from four headings, every arrow or WASD key and every pair turns the manta towards the matching screen direction at its normal rate; the mouse steers towards the pointer at the near and the far zoom; space and a held button burst; right-click opens no menu. Real key and mouse events, the loop paused and the simulation stepped by hand. About 40 s.
- `hint.mjs`: the controls hint (4A): the mouse-and-keys line on a desktop, the hold-and-double-tap line on a phone, on the lab and feedback pages; visible, fading after five seconds on a real clock, gone at once on the first burst; `?hint=0` keeps it off. About 60 s.
- `bzoom.mjs`: the burst zoom (4A): a burst widens the view 12% with a smoothstep ease out over 0.3 s and back over 0.6 s, the close-up camera untouched, the view the room is told widening with it, reduced motion halving it, the slider at 0 turning it off. About 30 s.
- `desktop.mjs`: the desktop layout (4A) at 1366x768, 1920x1080 and 2560x1440 with a mouse: the feedback page (solo, and the first visit's name panel) and the lab page, nothing overlapping, text at least 13 px, the radar growing with the screen, no overflow; screenshots `desk-<w>x<h>[-name|-lab].png` in `MANTA_OUT`, to be looked at. `SIZE=1920x1080` picks one size and `PART=feed|name|lab` one page; 2560x1440 needs the parts, each about 40 s.
- `classic.mjs`: pixel-for-pixel comparisons at a fixed seed and step (4A): `?paused=1` holds the page at its first frame and `__lab.step` drives it. `MODE=self` loads one recipe twice and expects identical canvases; `MODE=ref REF=<png>` saves a reference; `MODE=cmp REF=<png> Q=look=classic` compares. `STEPS` (45) sixtieths. About 40 s.
- `camera.mjs`: the close-up camera's restart and cut, with no rival trains and a train swimming straight so nothing can crash it: a restart's first frame at the curve for its length, read on that frame; after a cut that halves the train, the view eases back in. About 30 s.
- `watch.mjs`: the WebGPU error watch: the page's errors and error-watch rows. Run with `CHROME=$CHROME153`; `BACK=gl` for the WebGL2 side. About 30 s.
- `gpu.mjs`: the WebGPU sweep 0 to 650 and a cut to 150, zero page errors. `TIER` env; run with `CHROME=$CHROME153`. About 60 s.
- `wgpu.mjs`: does headless WebGPU draw at all; puppeteer, so `CHROME` is optional. About 30 s.
- `wgpupix.mjs`: can WebGPU pixels be read back headless. `CHROME=$CHROME153`. About 30 s.

### Room tests (via `lib/rooms.sh`; each up to 10 min)

- `room-base/roomtest.mjs`: an ocean room with Node clients. `DIRECT=1`. About 3 min.
- `room-base/devcheck3b.mjs`: the static site and the rooms through wrangler dev: 404s, the origin rule, the edge echo and the "probe" room's echo (pings paced at one every 40 ms, under the rooms' 30 a second) and "who". `DIRECT=1`. About 40 s.
- `room-base/watchmode.mjs`: watch mode in the page. `DIRECT=1`. About 60 s.
- `room-play/playtest.mjs`: the play-mode bars (corrections, cuts, bytes, drops, restart) with the phone's own code. `NAMES=1`, `PARTS=corr,cut,bytes,drop,restart`, ideally `ALONE=1`. About 4 min per delay.
- `room-play/playmode.mjs`: play mode in the page through a proxy. `NAMES=1`. About 90 s per delay.
- `room-compact/compact.mjs`: compact snapshots through a proxy. About 90 s.
- `room-six/six.mjs`: the review's six findings, each a test. `NAMES=1`. About 3 min.
- `room-limits/limits.mjs`: room limits, with test names OFF. `DIRECT=1 VARS="--var CODE_TTL_MS:4000"`. About 60 s.
- `room-feedback/feedback.mjs`: the feedback page `/lab/manta/play/`. `DIRECT=1`, once with `PART=a` and once with `PART=b`. About 60 s each.
- `room-feedback/fbcuts.mjs`: the feedback page's "cuts landed" in the staged room. `DIRECT=1`. About 60 s.
- `room-pick/pick.mjs`: pickups through the proxy with the phone's own code. `NAMES=1`. About 90 s.
- `room-labels/labels.mjs`: labels over leaders. `DIRECT=1`, `PART=solo|room|crash`. About 60 s each.
- `room-names/names.mjs`: typed names. `DIRECT=1`, `PART=first|clean|change`. About 60 s each.
- `room-names/inplace.mjs`: the first visit plays in place. `DELAYS=20:0`. About 60 s.
- `room-hits/lag.mjs`: the hit lag broken into its parts. `NAMES=1`. About 90 s.
- `room-hits/hits.mjs`: your own hits at once. `NAMES=1`. About 90 s.
- `room-hits/bhits.mjs`: the feedback page in the staged cut room. `DIRECT=1`, `MODE=crash|cut`. About 60 s each.
- `room-bytes/bytes.mjs`: bytes per phone at the far zoom with a 500-long train. `NAMES=1`. About 90 s. With the burst zoom (4A) the widest view a phone reports is 12% wider: `VIEW_W=1077 VIEW_H=2395 NAMES=1 ...` checks the limits there.
- `room-radar/room.mjs`: the radar in a room through the proxy. `NAMES=1`. About 90 s.
- `room-radar/page.mjs`: the radar on the feedback page. `DIRECT=1`. About 60 s.
- `room-overflow/overflow.mjs`: overflow rooms: 25 joiners land 10, 10 and 5; a leaver's seat goes to the next joiner; the feedback page and a first visit's Play swim in the fullest room with a seat; the cap holds; every room full, the feedback page goes solo with its note. `DIRECT=1 VARS="--var LIVE_CAP:4"` (the cap lowered so a few dozen phones reach it). About 60 s.
- `portal/portal.mjs`: the portal package (`node tools/manta/package.mjs`), unzipped and served gzipped from another origin under `/game/`, directly and in a cross-origin iframe: first frame and play within 20 s on a 300 ms, 1.5 Mbit/s link; zero requests outside the package and no room connection; WebGPU, WebGL2, and the WebGL2 fallback in an iframe without WebGPU; portal mode (no room buttons, chip, corner press or name box; label "you"; the privacy note); nothing stored; no console errors or horizontal overflow, both orientations; three touch schemes. `ZIP=<the zip> CHROME=$CHROME153 node tests/manta/portal/portal.mjs`, no server needed; `NOGZIP=1` measures the load served uncompressed. About 70 s.
- `room-radar/radar.mjs`: the radar in the solo lab: a static-server harness, so run it with `lib/serve.sh`. About 60 s.

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

## The deploy dry run

Any commit touching `rooms/`, `wrangler.jsonc` or a simulation module the Worker
imports passes this first, from the repo root:

```sh
node "$MANTA_TOOLS/node_modules/wrangler/bin/wrangler.js" deploy --dry-run --outdir "$MANTA_OUT/dry"
```

and nothing from `tests/` may appear in the bundle.
