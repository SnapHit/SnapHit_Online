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

**The two cabinet games are copies.** `hurtle.html` and `beakdown.html` mirror
games that live at hurtle.site and beakdown.fun. Each carries a canonical tag
pointing home so the copy does not compete in search. **Never remove those
tags.** They are served same-origin so the gyroscope works inside an iframe,
which a cross-origin frame will not allow. Changing them forks them from
upstream, so prefer fixing the container over fixing the game.

**Nothing loads until asked.** Each cabinet shows a card until tapped, and a
shared IntersectionObserver unloads any game scrolled out of view. The hero
game parks itself when it leaves the screen.

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

---

## Where things are

```
docs/index.html          the page: hero, cabinets, studio card, Novlr, footer
docs/play/snaphit.html   the hero game, framed by the page
docs/play/hurtle.html    Hurtle, framed in a cabinet
docs/play/beakdown.html  Beakdown, framed in a cabinet
docs/404.html            same materials as the site
docs/og.jpg              share card, referenced absolutely
wrangler.jsonc           deploy config. Do not add "main".
NOTES.md                 the build record
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
