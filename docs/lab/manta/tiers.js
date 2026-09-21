/* Quality tiers and dynamic resolution.
 *
 * Two separate things that both react to frame time, in a deliberate order.
 *
 * RESOLUTION goes first, both down and last back up. It is the cheapest thing
 * to give up and the hardest to notice, and the ladder is not invented here:
 * 2 / 1.6 / 1.3 / 1.05 / 0.85, stepping down under 34 fps and back up over 52,
 * is the one already proven in this repo's NOTES.md on the arcade's own hero
 * game. Judged on measured wall time, not on the clamped delta the scene runs
 * on — the clamp exists so a hidden tab cannot teleport anything, and using it
 * here would tell the controller the device is fast when it is asleep.
 *
 * TIERS go second, and only once resolution has run out of room. They change
 * HOW things are drawn and never WHAT is in the scene: the same ten mantas on
 * the same paths, so nothing about the game changes underneath the player.
 *
 * Recovery is the mirror image: the tier comes back before the resolution
 * does, because a missing effect is more visible than a slightly softer image,
 * and paying the tier back first means the controller only restores the
 * expensive thing when it is comfortably fast.
 */
export const LADDER = [2, 1.6, 1.3, 1.05, 0.85];
export const TIERS = ['low', 'medium', 'high'];      // index 0 is worst

const DOWN_MS = 1000 / 34;      // 29.41 ms
const UP_MS = 1000 / 52;        // 19.23 ms
/* The window is a DURATION with a minimum sample count, not a frame count.
   Thirty frames is half a second at sixty and twenty seconds at one and a
   half — and a device running at one and a half frames a second is exactly
   the one that needs the controller to react quickly. Measured: at that rate
   the frame-count version never reached a decision at all. */
const WINDOW_MS = 500;         // the window is trimmed to this
const MIN_SPAN = 250;          // and must cover at least this before deciding
const WINDOW_MIN = 8;          // and hold at least this many samples
const WINDOW_MAX = 90;         // a cap, so a fast device keeps it cheap
const COOLDOWN = 800;           // ms to settle after any change

export function createQuality ({ forcedTier = null, dpr = 1 } = {}) {
  /* A dense screen starts one rung down: two device pixels for every CSS
     pixel is a lot of fill for a first frame, and climbing up is cheap. */
  let rung = dpr > 2 ? 1 : 0;
  let tierIdx = forcedTier ? TIERS.indexOf(forcedTier) : TIERS.length - 1;
  if (tierIdx < 0) tierIdx = TIERS.length - 1;
  const locked = forcedTier !== null;

  let win = [];                  // { ms, at }
  let until = 0;                 // cooldown expiry, in the caller's clock

  function feed (ms, now) {
    if (!isFinite(ms) || ms <= 0) return null;
    win.push({ ms, at: now });
    /* Trim to WINDOW_MS, but never below WINDOW_MIN samples. The decision
       threshold is MIN_SPAN and not WINDOW_MS: trimming to 500 ms and then
       demanding 500 ms is a condition that can never be met, which is how the
       first version of this silently never decided anything. */
    while (win.length > WINDOW_MAX || (win.length > WINDOW_MIN && now - win[0].at > WINDOW_MS)) win.shift();
    const span = win.length ? now - win[0].at : 0;
    if (locked || win.length < WINDOW_MIN || span < MIN_SPAN || now < until) return null;

    const sorted = win.map(w => w.ms).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    let changed = null;
    if (median > DOWN_MS) {
      if (rung < LADDER.length - 1) { rung++; changed = 'scale'; }
      else if (tierIdx > 0) { tierIdx--; changed = 'tier'; }
    } else if (median < UP_MS) {
      if (tierIdx < TIERS.length - 1) { tierIdx++; changed = 'tier'; }
      else if (rung > 0) { rung--; changed = 'scale'; }
    }
    if (changed) { win = []; until = now + COOLDOWN; }
    return changed;
  }

  return {
    feed,
    get scale () { return LADDER[rung]; },
    get rung () { return rung; },
    get tier () { return TIERS[tierIdx]; },
    get locked () { return locked; },
    get median () {
      if (!win.length) return NaN;
      const s = win.map(w => w.ms).sort((a, b) => a - b);
      return s[s.length >> 1];
    },
    /* For tests only: the controller is judged on frame times, and this
       container renders at four frames a second, which would pin it to the
       bottom rung and prove nothing. Synthetic times drive it properly. */
    _set (r, t) { rung = r; tierIdx = TIERS.indexOf(t); win = []; until = 0; },
  };
}

/* What each tier actually turns off. Nothing here touches the scene. */
export const TIER_SETTINGS = {
  high:   { grain: true,  bloomRes: 0.5,  lm: 512, ripple: true },
  medium: { grain: false, bloomRes: 0.25, lm: 256, ripple: true },
  low:    { grain: false, bloomRes: 0.25, lm: 256, ripple: false },
};
