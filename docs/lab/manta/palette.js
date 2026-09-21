/* Who wears what, and the roll that decides it.
 *
 * Doc v1.8's palette: seven bright saturated hues. Pink is NOT in it — it is
 * reserved for the pink manta, so its flash stays the rarest colour on screen.
 * No warm/cool split in the list itself; the drawer's switch narrows it.
 *
 * Your colour is rolled at the start of each run and is YOURS ALONE that run:
 * everyone else is dealt from what is left, so nothing on screen can be
 * mistaken for you. A wild manta only ever takes your colour by joining your
 * train.
 */
export const PALETTE = [
  { key: 'lime',    hex: 0xc8ff3c, cool: false },
  { key: 'orange',  hex: 0xff9a3c, cool: false, warm: true },
  /* Scarlet is for rivals and wild mantas only. Your train burns 1.4 times
     hotter than its colour at everyone else's level, and a red that is
     lightened that far is pink whatever the saturation floor does — so the
     roll never deals it to you. 7.2 keeps pink for the pink manta. */
  { key: 'scarlet', hex: 0xff3b30, cool: false, warm: true, player: false },
  { key: 'violet',  hex: 0xa07bff, cool: true  },
  { key: 'purple',  hex: 0xc46bff, cool: true  },
  { key: 'azure',   hex: 0x3aa8ff, cool: true  },
  /* Green replaces coral, which sat at hue 12 and read pink the moment
     anything lightened it. At hue 137 this is clear of lime and of azure. */
  { key: 'green',   hex: 0x3ddc84, cool: false },
];
/* The cool-only wild set swaps the four warm hues for one turquoise, so the
   switch compares like with like rather than simply removing colours. */
export const TURQUOISE = { key: 'turquoise', hex: 0x3cf0d0, cool: true };

/* ------------------------------------------------- how bright each one is

   THE SEVEN ARE NOWHERE NEAR EQUALLY BRIGHT, and at one flat level that
   shows. In the renderer's linear working space lime measures 0.841 and red
   0.274 — a spread of 3.1 — so a red or violet manta drifting through the
   player's wake read 1.60 times its surroundings where 7.2 asks for 2.0,
   while the same check over a lime manta read 2.6. The condition is about
   every manta, so the dim hues carry their own level.

   The band below does both: it lifts the dim hues to a floor and holds the
   bright ones under a ceiling. */
const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/* Relative luminance, linear, the same weights the conditions are measured
   with. */
export function luminance (hex) {
  const r = toLinear(((hex >> 16) & 255) / 255);
  const g = toLinear(((hex >> 8) & 255) / 255);
  const b = toLinear((hex & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* THE BAND EVERY OTHER MANTA SITS IN, in luminance, and why there is one.

   A floor, because the dim hues at one flat level failed condition 3: a red
   or violet manta inside the player's wake read 1.60 times its surroundings
   where 7.2 asks for 2.0, while lime read 2.6.

   A ceiling, because 7.2 also says your train "burns hotter than any other
   manta", and that does NOT follow from condition 1, which compares your
   train with its OWN colour. Measured: with the floor alone, a lime rival at
   0.52 out-glowed an azure player train at 0.40 — 0.96 times, the wrong way
   round — because lime is three times the luminance of red before anything
   is applied. The ceiling puts every other manta in one narrow band so the
   train above it is yours whatever it rolled.

   Both are inside every hue's own saturated range, so nothing here whitens a
   rival or a wild manta: the levels come out between 0.36 and 0.91. Only
   your train, which sits above the band, ever runs out of room. */
export const BAND_LO = 0.248;
export const BAND_HI = 0.280;

/* The level to render this colour at so it lands in the band. `flat` is the
   one level everything used before there was a band. */
export function levelFor (hex, flat) {
  const L = luminance(hex);
  return Math.min(BAND_HI, Math.max(BAND_LO, L * flat)) / L;
}

/* Your train takes the floor but not the ceiling: it is the one thing that
   is allowed to be as bright as its hue can go, which is what keeps a lime
   train looking like the one Nathan tuned the bloom against. */
export function levelForYours (hex, flat) {
  const L = luminance(hex);
  return Math.max(BAND_LO, L * flat) / L;
}

/* mulberry32: small, fast, and good enough that a seed reproduces a run
   exactly, which is the only property a test needs from it. */
export function rng (seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The deal. Your colour first, then everyone else from what is left; wild
   mantas may repeat a colour once the deck runs out, rivals never do. */
export function deal ({ seed, pinned, coolWild, rivals, wilds, train = 0 }) {
  const next = rng(seed);
  const all = PALETTE.slice();
  /* The colours your train may roll. Scarlet is not one of them. */
  const mineable = all.filter(c => c.player !== false);
  let mine = null;
  if (pinned) mine = all.find(c => c.key === pinned) || null;
  if (!mine) mine = mineable[Math.floor(next() * mineable.length) % mineable.length];

  const rest = all.filter(c => c.key !== mine.key);
  /* Shuffled with the same generator, so one seed fixes the whole table. */
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
  }
  const rivalColours = [];
  for (let i = 0; i < rivals; i++) rivalColours.push(rest[i % rest.length]);

  /* Wild mantas draw from what is left after the rivals, narrowed by the
     switch. Never your colour: the deck they draw from excludes it. */
  let pool = rest.slice(rivals);
  if (coolWild) pool = pool.filter(c => c.cool).concat([TURQUOISE]);
  if (!pool.length) pool = rest.slice();
  const wildColours = [];
  for (let i = 0; i < wilds; i++) wildColours.push(pool[i % pool.length]);

  /* Every manta in YOUR train also owns a wild colour of its own, drawn from
     the same pool. It is not worn while the manta is in the train — that
     wears your colour — but 7.2 says a manta cut loose "glows in that colour
     while it's up for grabs, until its own colour returns", so it has to
     have one to return to. Never your colour, for the same reason nobody
     else's is. */
  const trainColours = [];
  for (let i = 0; i < train; i++) trainColours.push(pool[(i + wilds) % pool.length]);

  return { mine, rivals: rivalColours, wilds: wildColours, train: trainColours };
}
