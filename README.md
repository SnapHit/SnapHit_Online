# SnapHit Studios

The homepage for **snap-hit.online**. A playable arcade game is the hero;
clearing it reveals a shelf of cabinets, each holding a real game.

**Instant. Play.** No ads, no sign-in, nothing to install.

---

## What is here

```
docs/                     everything that gets served
  index.html              the page
  play/snaphit.html       the hero game, framed by the page
  play/hurtle.html        Hurtle, framed in a cabinet
  play/beakdown.html      Beakdown, framed in a cabinet
  404.html  robots.txt  sitemap.xml
  og.jpg  icon.png  apple-touch-icon.png  studio.jpg
NOTES.md                  the build record: why things are the way they are
```

Nothing outside `docs/` is served.

## Publishing

**GitHub Pages.** Settings → Pages → Deploy from a branch → `main` / `/docs`.
Everything is relative, so it works from a project subpath
(`username.github.io/repo/`) without changes.

**Cloudflare.** Point the assets directory at `./docs`. Add no Worker script:
static asset requests are free and unlimited, and the absence of a script is
the entire cost model.

## Ground rules

- **One self-contained file per game.** No build step, no dependencies, no
  framework, no assets.
- **Zero external requests.** Not one. No CDN, no fonts, no analytics.
- **Nothing loads until it is asked for.** Each cabinet shows a card until
  tapped, and any game scrolled out of view is unloaded.
- **Sound is on but silent until you touch the page**, because browsers will
  not start audio before a gesture. It can be turned off and the choice sticks.

## The two games in cabinets

`hurtle.html` and `beakdown.html` are copies of games that live at
**hurtle.site** and **beakdown.fun**. They are served from this origin so the
gyroscope works inside an iframe, which a cross-origin frame will not allow.
Each carries a canonical tag pointing home, so neither copy competes with the
real site in search. Do not remove those tags.
