/* What each manta is wearing, and how bright it burns.
 *
 * palette.js says which seven colours exist and what level each one renders
 * at; this puts them on the mantas. It owns the roll, the per-instance tint
 * buffer and the brightness scale the cut fades, and it is the only thing
 * that writes aTint — so a flash cannot drift a hue and a colour change
 * cannot be undone by the next flash.
 */
import { PALETTE, deal, levelFor, levelForYours } from './palette.js';
import { P, onParam } from './params.js';

/* Every manta is bright and saturated: v1.8 retires the dark wild manta
   along with the conditions that needed it. One base level for everyone —
   scaled per colour, because the seven hues are not equally bright and a flat
   level leaves the dim ones failing condition 3 (see levelFor in palette.js)
   — and your train burns hotter on top of that. */
const BASE_LEVEL = 0.62;
/* Your train is at least 1.4 times the same colour at the base level, and it
   is lifted towards white as well: a saturated hue at full value has nowhere
   brighter to go in its own channels, so the extra has to come out of the
   saturation or it does not come out at all. */
const YOURS_GAIN = 1.55;
const YOURS_WHITE = 0.22;

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function tint (hex, level) {
  /* Written as sRGB hex and converted here, for the same reason the ocean
     uses color(): the renderer's working space is linear, and a hex used raw
     comes out about four times too bright. */
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return [srgbToLinear(r) * level, srgbToLinear(g) * level, srgbToLinear(b) * level];
}

const LUM = t => 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];

/* The level every manta that is not in your train uses, per colour. */
const baseTintFor = hex => tint(hex, levelFor(hex, BASE_LEVEL));

/* A saturated hue at full value cannot get brighter in its own channels, so
   your train's extra comes out of the saturation too — and now that the dim
   hues carry a level of their own, some of them ask for more than a channel
   has left. Nothing is allowed to sit above 1 and be clipped, because
   clipping a channel moves the HUE, which 7.2 forbids: the colour is scaled
   back inside the range and the luminance that costs is paid back as white,
   by solving for it rather than guessing. */
export function yoursTint (hex) {
  const t = tint(hex, levelForYours(hex, BASE_LEVEL) * YOURS_GAIN);
  const want = LUM(t);
  const over = Math.max(1, t[0], t[1], t[2]);
  const scaled = t.map(v => v / over);
  const top = Math.max(scaled[0], scaled[1], scaled[2]);
  const have = LUM(scaled);
  /* w whitens each channel towards the peak, which lifts the luminance from
     `have` towards `top`. Solve w for the luminance the gain asked for, and
     never go below the 22% that was already there. */
  const solved = top > have ? (Math.min(want, top) - have) / (top - have) : 0;
  const w = Math.min(1, Math.max(YOURS_WHITE, solved));
  return scaled.map(v => v + (top - v) * w);
}

/* How much hotter your train burns than the same colour would at the level
   every other manta uses. Condition 1, exactly, and measured from the tints
   rather than from a picture of them, because that is what it is about. */
export function gainFor (key) {
  const c = PALETTE.find(x => x.key === key);
  if (!c) return null;
  return LUM(yoursTint(c.hex)) / LUM(tint(c.hex, levelFor(c.hex, BASE_LEVEL)));
}

export function createColours ({ COUNT, roles, aTint, rivals, wilds }) {
  /* The deal. A seed per load, ?seed= to reproduce one, ?player= to pin the
     roll for a test. */
  const query = new URLSearchParams(location.search);
  const seedParam = parseInt(query.get('seed'), 10);
  let seed = Number.isFinite(seedParam) ? seedParam : (Math.random() * 0xffffffff) >>> 0;
  let pinned = query.get('player');
  let dealt = null;

  /* The identity colour each manta was given. Brightness is scaled against
     this rather than against whatever is in the buffer, so a flash and a fade
     cannot drift the hue: the cut changes how bright a manta is, never which
     colour it is. 7.2 forbids relying on hue alone, and the inverse matters
     just as much — the hue has to survive the effect. */
  const baseTint = roles.map(() => [0, 0, 0]);
  const tintScale = new Float32Array(COUNT).fill(1);

  function applyTint (i) {
    const t = baseTint[i], k = tintScale[i];
    aTint.setXYZ(i, t[0] * k, t[1] * k, t[2] * k);
    aTint.needsUpdate = true;
  }

  function rollColours (newSeed) {
    if (newSeed !== undefined) seed = newSeed >>> 0;
    dealt = deal({ seed, pinned, coolWild: P.coolWild >= 0.5, rivals, wilds });
    for (let i = 0; i < COUNT; i++) {
      const r = roles[i];
      let t;
      if (r.kind === 'train') t = yoursTint(dealt.mine.hex);
      else if (r.kind === 'rival') t = baseTintFor(dealt.rivals[r.rival].hex);
      else t = baseTintFor(dealt.wilds[r.idx].hex);
      r.tint = t;
      baseTint[i] = t.slice();
      applyTint(i);
    }
  }

  function setTintScale (i, k) {
    const t = baseTint[i];
    tintScale[i] = k;
    aTint.setXYZ(i, t[0] * k, t[1] * k, t[2] * k);
    aTint.needsUpdate = true;
  }

  /* 0 is the random roll; 1 to 7 pin one of the palette's colours. */
  function pinnedFromParam () {
    const n = Math.round(P.player);
    return n >= 1 && n <= PALETTE.length ? PALETTE[n - 1].key : (query.get('player') || null);
  }

  rollColours();
  onParam(key => { if (key === 'coolWild' || key === 'player') { pinned = pinnedFromParam(); rollColours(); } });

  return {
    rollColours,
    reroll: () => rollColours((Math.random() * 0xffffffff) >>> 0),
    setTintScale,
    getTintScale: i => tintScale[i],
    gainFor,
    get colours () { return dealt; },
    get seed () { return seed; },
  };
}
