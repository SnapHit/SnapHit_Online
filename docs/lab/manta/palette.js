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
  { key: 'lime',   hex: 0xc8ff3c, cool: false },
  { key: 'coral',  hex: 0xff6f4d, cool: false },
  { key: 'orange', hex: 0xff9a3c, cool: false },
  { key: 'red',    hex: 0xff4d5e, cool: false },
  { key: 'violet', hex: 0xa07bff, cool: true  },
  { key: 'purple', hex: 0xc46bff, cool: true  },
  { key: 'azure',  hex: 0x3aa8ff, cool: true  },
];
/* The cool-only wild set swaps the four warm hues for one turquoise, so the
   switch compares like with like rather than simply removing colours. */
export const TURQUOISE = { key: 'turquoise', hex: 0x3cf0d0, cool: true };

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
export function deal ({ seed, pinned, coolWild, rivals, wilds }) {
  const next = rng(seed);
  const all = PALETTE.slice();
  let mine = null;
  if (pinned) mine = all.find(c => c.key === pinned) || null;
  if (!mine) mine = all[Math.floor(next() * all.length) % all.length];

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

  return { mine, rivals: rivalColours, wilds: wildColours };
}
