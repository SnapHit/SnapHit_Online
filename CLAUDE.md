# Working on this repository

You are editing a live site. **snap-hit.online** deploys automatically from
`main` via Cloudflare Workers Static Assets. A merged pull request is in front
of the public within a minute.

Read `NOTES.md` before changing anything visual or audible. It records why
things are the way they are, including a good number of attempts that failed
and how they were caught. Most "obvious improvements" here have already been
tried and rejected for a reason.

---

## Do not break these

**Zero external requests.** Not one. No CDN, no web font, no analytics, no
third-party script, no remote image. Everything is inline or same-origin.
Verify by loading the page and asserting the off-origin request count is zero.

**No build step and no Worker script.** `wrangler.jsonc` has no `main` field.
That absence is the entire cost model: static asset requests are free and
unlimited; adding a script makes them billable Worker invocations. A framework
or bundler also breaks the "one self-contained file per game" rule.

**One self-contained file per game.** Each file in `docs/play/` carries its own
markup, styles, script and assets. No shared runtime, no imports, no build.

**One written exception to that rule.** Manta trains lives in
`docs/lab/manta/` and is built on Three.js, because a WebGPU game cannot be one
hand-written file. The exception is bounded: that folder, plus the library
vendored at `docs/vendor/three/r186/`. Still no build step, still no Worker
script, still zero external requests. Every other game stays one file. See
"Manta trains and the lab" below.

**The two cabinet games are copies.** `hurtle.html` and `beakdown.html` mirror
games that live at hurtle.site and beakdown.fun. Each carries a canonical tag
pointing home so the copy does not compete in search. **Never remove those
tags.** They are served same-origin so the gyroscope works inside an iframe,
which a cross-origin frame will not allow. Changing them forks them from
upstream, so prefer fixing the container over fixing the game.

**Nothing loads until asked.** Each cabinet shows a card until tapped, and a
shared IntersectionObserver unloads any game scrolled out of view. The hero
game parks itself when it leaves the screen.

**On-device storage is allowed, namespaced and versioned.** `localStorage` and
IndexedDB make no network request, so they do not touch the zero-requests rule.
Prefix every key with its game (`manta:`), change the key name when the meaning
of the value changes so a stale preference cannot stick, wrap reads and writes
in try/catch, and let the game run normally when storage is blocked or full.

---

## Manta trains and the lab

Manta trains is the game in development: a top-down WebGPU game on Three.js.
Its design doc is `manta-trains-design.md` in the repo root, which is never
served. That doc is the source of truth for the rules, the look and the build
plan, and the same version sits in the Claude project the briefs come from.
Read the sections a brief names before touching anything under `docs/lab/`.
When a brief changes that doc, apply its edits exactly as written and check the
hash the brief gives you, so the two copies cannot drift.

**The lab page is not part of the site.** `docs/lab/manta/` is a standalone
prototype: no link from the shelf, no entry in the `GAMES` array, nothing in
`docs/sitemap.xml`, and `<meta name="robots" content="noindex, nofollow">` in
the head. It is not embedded in a cabinet until launch, and nothing else on the
site may depend on it.

**Three.js is vendored, pinned and never edited.** `docs/vendor/three/r186/`
holds an unmodified copy of npm `three` 0.186.0 with its `LICENSE`, loaded
same-origin through an import map. Never a CDN, never a bundler, never an edit
in place. To upgrade, add a new versioned folder beside it and switch the
import map, so a rollback is one line.

**Check Three.js and TSL names against the vendored files, not memory.** The
API moves between releases and online examples are usually written against a
different one: in r186, `PostProcessing` is now `RenderPipeline`. The build
ships unminified with its own JSDoc, so the answer is already in the repo.

**Both backends, every time.** WebGPURenderer uses WebGPU where it exists and
falls back to WebGL2. Every lab page shows which backend is running and accepts
`?backend=webgl2` to force the fallback. A change verified on one backend is
not verified.

---

## Cost control, which matters here

```
docs/play/hurtle.html    187 KB   ~46k tokens
docs/play/snaphit.html   118 KB   ~29k tokens
docs/play/beakdown.html   58 KB   ~14k tokens
docs/index.html           58 KB   ~14k tokens
```

**Do not read a game file end to end.** Grep for the region you need. Most work
is in `docs/index.html`. Adding a game to the shelf is one entry in the `GAMES`
array near the bottom of `index.html` plus one new file in `docs/play/`.

**Never read a vendored library end to end.** It would fill a session several
times over. Grep it, or read the JSDoc above the symbol you need.

```
docs/vendor/three/r186/three.webgpu.js   2.2 MB   ~560k tokens
docs/vendor/three/r186/three.core.js     1.4 MB   ~360k tokens
```

---

## Where things are

```
docs/index.html          the page: hero, cabinets, studio card, Novlr, footer
docs/play/snaphit.html   the hero game, framed by the page
docs/play/hurtle.html    Hurtle, framed in a cabinet
docs/play/beakdown.html  Beakdown, framed in a cabinet
docs/404.html            same materials as the site
docs/og.jpg              share card, referenced absolutely
docs/lab/manta/          Manta trains prototype. Unlinked, noindex.
docs/vendor/three/r186/  Three.js, vendored unmodified. Do not edit.
wrangler.jsonc           deploy config. Do not add "main".
NOTES.md                 the build record
manta-trains-design.md   Manta trains: rules, look, build plan. Not served.
```

---

## Invariants that look arbitrary and are not

Each of these was arrived at by measurement or by a bug. Changing one without
reading why will reintroduce something that took several attempts to kill.

**The expand mechanic styles the phone in place.** It never moves the iframe in
the DOM, because moving an iframe reloads it and destroys a run in progress.
Anything that "tidies this up" by re-parenting the element is wrong.

**The unload observer is shared and never unobserves.** One observer for all
cabinets. The callback throws the record away unread and judges every frame on
its current rectangle, because a record says what changed when it was queued,
not what is true when it is delivered. The sweep is deferred two animation
frames so the page has settled. Per-frame observers with `unobserve` on the way
out is the bug this replaced: a cabinet played twice ran off screen forever.

**Expanding deliberately does not take keyboard focus.** Pulling focus to the
close button stopped a desktop player's arrow keys reaching the game, and
Hurtle clears its steering state on blur. `unzoom()`'s `g.focus()` is
load-bearing in the other direction: it scrolls the cabinet back into view.

**Escape is deliberately not bound inside the frame.** Both games already use
Escape to pause. The keyboard exit is Tab out of the frame, plus Escape while
the parent holds focus.

**The wordmark is a baked SVG path, not text.** Letter outlines from Poppins
Bold with overlapping contours merged, so a stroke traces only the silhouette.
Set as type it reintroduces a seam at every letter junction: a capital T is a
crossbar and a stem laid over each other, and stroking type draws both. White
fill, orange stroke, glow behind. Defined once as `<symbol id="wm">`, mirrored
as a `Path2D` in the game. In canvas: **stroke first, then fill.**

**Sound is on by default but silent until a tap.** Browsers will not start
audio before a gesture. The AudioContext is not created until the first pointer
event. Correct, not a bug.

**`/play/hurtle.html` returns a 307** to `/play/hurtle`. That is
`html_handling: auto-trailing-slash`. Measured at about 10ms off an
already-open edge connection. Left alone deliberately.

**`og:image` and the canonical are absolute** to snap-hit.online. Correct even
when viewed from a preview URL.

---

## Verifying a change

**Run it. Do not read it.** The single most common failure on this project is
code that is correct and a render that is wrong. Every one of those was caught
by a browser and none by reading.

A headless browser is available in this environment. Serve `docs/` over local
HTTP and drive it. Some things that have actually bitten:

- CSS applied correctly while the element painted nothing, because a quoted
  font name inside a same-quoted HTML attribute closed it early.
- A wordmark that measured as "hollow" in the stylesheet and rendered solid,
  because a shadow blur wider than the gap welded the letters together.
- An unload that fired on a stale rectangle and killed a cabinet the player
  was looking at.

Useful measurements rather than eyeballing: count off-origin requests, sample
pixels in a region and report the proportion of ink, walk a line across a glyph
and count how many times it crosses a stroke, count separated letter blobs in a
vertical projection.

**`html { scroll-behavior: smooth }` will break a browser test** that scrolls
and measures immediately. Scroll with `behavior: 'instant'` in tests.

**A headless browser cannot tell you what a phone does.** It runs the code, not
this phone's GPU. Which backend is live, whether the WebGL2 fallback holds,
frame rate and anything about how it looks have to be checked on Nathan's
Pixel 9 in Chrome and reported back by him. End a session by saying exactly
what he should open and what he should see.

**Say what you measured, not that you changed it.** If something could not be
verified without a real device, say so plainly rather than presenting a guess
as a finding.

---

## Working style

**Commit directly to `main`.** Do not push a branch and do not open a pull
request unless explicitly asked. `main` deploys to snap-hit.online
automatically, so whatever you commit is public within about a minute.

**That makes verification the only safety net, so it is not optional.** There
is no review step between your commit and the live site. Verify in a browser
BEFORE you commit, not after. If you cannot verify a change, do not commit it:
say what you would have done, say what you could not test, and stop.

**One change per commit.** If a commit turns out to be wrong it has to be
revertable on its own, from a phone, by someone who is not at a computer.

**Never leave the site broken.** If a change is half finished at the end of a
session, do not commit it. A working site with the bug still in it beats a
broken site with the fix half applied.

**The commit message is now the only record.** There is no pull request
description to explain the reasoning. Say what changed, why, and what you
measured. "Fix observer" is useless in six months; "Share one observer and
judge frames by live rectangle, so a revived frame can unload again — verified
unload #2 in headless Chromium" is not.

**Investigate before patching when asked to.** A diagnosis that rules out three
hypotheses is worth more than a fix for the wrong cause.

**Stop and report if a requirement conflicts with something already in the
code.** That has already saved this project once, when a brief asked for Escape
to close the expanded view and both games were already using Escape to pause.

## If you break the live site

Do not panic and do not start layering fixes on top. Revert the single commit
that caused it, push, and confirm the site is back. Then work out what went
wrong. A live site restored in one minute is worth more than a clever fix
twenty minutes later.
