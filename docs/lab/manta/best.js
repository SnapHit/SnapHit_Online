/* YOUR BEST (4D, design doc 10.8): the longest peak you have reached, kept
 * on this device under manta:best, so it carries over between visits. The
 * feedback page and the portal package keep it (follow.js keepBest); the
 * lab page, whose tests lay trains of hundreds at once, never reads or
 * writes it.
 *
 * On-device storage only, as CLAUDE.md allows: no request, the key
 * prefixed with the game, every read and write in try/catch, and the game
 * plays on as normal (a best for this visit only) when storage is blocked
 * or full. The value is a whole number; anything else reads as 0.
 */
export const BEST_KEY = 'manta:best';

export function readBest () {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(100000, Math.floor(v)) : 0;
  } catch (_) { return 0; }
}

/* Kept in memory and written only when it rises, at most once a second
   while a run climbs, and at once when a run ends or the page is hidden. */
export function createBest () {
  let best = readBest(), saved = best, at = 0;
  const write = () => { if (best === saved) return; try { localStorage.setItem(BEST_KEY, String(best)); saved = best; } catch (_) { /* this visit only */ } };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden) write(); });
  if (typeof addEventListener === 'function') addEventListener('pagehide', write);
  return {
    get value () { return best; },
    /* A peak reached now; true when it is a new best. */
    offer (peak, now = 0, flush = false) {
      const up = peak > best;
      if (up) best = Math.floor(peak);
      if (flush || (up && now - at >= 1000)) { at = now; write(); }
      return up;
    },
    flush: write,
  };
}
