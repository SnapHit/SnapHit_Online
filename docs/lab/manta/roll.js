/* What the deal rolled, in one line a phone can show and a person can read.
 *
 * Your colour and the seed, the rivals' colours, and the LIVING wild mantas
 * as a count per colour. Never one entry per slot: the instance buffer has
 * hundreds of wild slots, most of them empty at any moment, and listing them
 * put hundreds of colour words into the panel and then into the Copy report
 * — the same bug Copy values had, in the other place that printed the deal.
 *
 * Both the panel's row and Copy values read this, so they cannot disagree.
 */
const tally = keys => {
  const m = new Map();
  for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => k + ' ×' + v).join(', ');
};

/* ORDINARY WILD AND DEBRIS, counted apart (3A). One "wild alive" number
   mixed the ambient population with crash debris, so a phone read "wild
   alive 46" against a wild count of 20 and it looked like a bug. Ordinary
   is every living wild manta that is not loose, at ANY index, so a surplus
   anywhere shows; debris is everything loose, glowing or sinking. The two
   add up to everything alive in the water. The panel, Copy values and the
   Copy report all read this one line. */
export function wildSplit (sim) {
  let ordinary = 0, debris = 0;
  for (const w of sim.wild) {
    if (!w || !w.alive) continue;
    if (w.loose) debris++; else ordinary++;
  }
  const target = sim.params.wildCount;
  return { ordinary, target, debris,
    text: 'wild ' + ordinary + ' of ' + target + '  \u00b7  debris ' + debris };
}

export function rollSummary (mantas, sim) {
  const c = mantas && mantas.colours;
  if (!c) return null;
  const head = c.mine.key + '  ·  seed ' + mantas.seed;
  const rivals = 'rivals ' + (c.rivals.length ? tally(c.rivals.map(r => r.key)) : 'none');
  /* A living wild manta at index i wears the colour the deal gave slot i. */
  let wild = 'wild ?';
  if (sim) {
    const alive = [];
    for (let i = 0; i < sim.wild.length && i < c.wilds.length; i++) {
      const w = sim.wild[i];
      if (w && w.alive && !w.loose) alive.push(c.wilds[i].key);
    }
    wild = wildSplit(sim).text + (alive.length ? '  \u00b7  wild colours ' + tally(alive) : '');
  }
  return { head, rivals, wild };
}
