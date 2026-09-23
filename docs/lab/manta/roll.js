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

export function rollSummary (mantas, sim) {
  const c = mantas && mantas.colours;
  if (!c) return null;
  const head = c.mine.key + '  ·  seed ' + mantas.seed;
  const rivals = 'rivals ' + (c.rivals.length ? tally(c.rivals.map(r => r.key)) : 'none');
  /* A living wild manta at index i wears the colour the deal gave slot i. */
  let wild = 'wild alive ?';
  if (sim) {
    const alive = [];
    for (let i = 0; i < sim.wild.length && i < c.wilds.length; i++) {
      const w = sim.wild[i];
      if (w && w.alive) alive.push(c.wilds[i].key);
    }
    wild = 'wild alive ' + alive.length + (alive.length ? ': ' + tally(alive) : '');
  }
  return { head, rivals, wild };
}
