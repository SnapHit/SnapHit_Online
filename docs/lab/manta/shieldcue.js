/* THE SHIELD, TAUGHT (4D ruling on the protected first run, design doc
 * 10.8). For its first minute a new player's leader slips under trains
 * instead of crashing (rules.js, firstShield), which on its own teaches
 * that trains are safe, and the run ends at the 61st second. So the page
 * says so, quietly:
 *
 *   each time the shield saves you    a soft ring round your leader
 *   the first time in a visit, also   "First minute: you slip under trains"
 *   when the guard ends (once a visit) a ring fading out, and
 *                                      "Now trains are deadly"
 *
 * Interface, not light: DOM over the canvas that never takes a touch,
 * placed on your leader (it moves with it) and the text below it, clear of
 * your name above it and the controls hint further down. Reduced flash and
 * motion: the rings fade without growing and at half strength, and the
 * words are the same. The feedback page, a room and the portal package
 * run this; the lab page too, whose tests can then read it.
 */
export const SLIP_TEXT = 'First minute: you slip under trains';
export const END_TEXT = 'Now trains are deadly';
const RING_MS = 700, END_RING_MS = 1300, SAY_MS = 2600, FADE_MS = 450;

export function createShieldCue ({ now = () => performance.now() } = {}) {
  const root = document.createElement('div');
  root.id = 'shieldCue';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:3;contain:strict';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:absolute;left:0;top:0;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;' +
    'border:2px solid rgba(190,250,255,.9);box-shadow:0 0 14px rgba(150,235,255,.55),inset 0 0 10px rgba(150,235,255,.35);opacity:0;display:none;will-change:transform,opacity';
  const say = document.createElement('div');
  say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  say.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;padding:4px 10px;border-radius:999px;display:none;opacity:0;' +
    'font:600 13px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;color:#eaf6ff;' +
    'background:rgba(4,9,18,.62);border:1px solid rgba(150,220,235,.4);transition:opacity ' + FADE_MS + 'ms ease;will-change:transform';
  root.append(ring, say);
  document.body.appendChild(root);
  /* The live region reads the text out; the overlay itself is decoration. */
  root.removeAttribute('aria-hidden'); ring.setAttribute('aria-hidden', 'true');

  let ringAt = -1, ringFor = RING_MS, ringEnd = false, sayAt = -1, slipTold = false, endTold = false, rings = 0, x = 0, y = 0, reduced = false;
  function ringOn (end) { ringAt = now(); ringFor = end ? END_RING_MS : RING_MS; ringEnd = end; ring.style.display = 'block'; rings++; }
  function tell (text) {
    say.textContent = text; say.style.display = 'block'; sayAt = now();
    void say.offsetWidth; say.style.opacity = '1';
  }
  return {
    /* The shield saved you just now. */
    slip () { ringOn(false); if (!slipTold) { slipTold = true; tell(SLIP_TEXT); } },
    /* The guard has just ended, with your leader in the water. */
    end () { if (endTold) return; endTold = true; ringOn(true); tell(END_TEXT); },
    /* Once a frame: your leader's place on screen in CSS px, and reduced flash and motion. */
    frame (sx, sy, isReduced, hide) {
      x = sx; y = sy; reduced = !!isReduced;
      const t = now();
      if (ringAt >= 0) {
        const k = (t - ringAt) / ringFor;
        if (k >= 1 || hide) { ringAt = -1; ring.style.display = 'none'; ring.style.opacity = '0'; }
        else {
          /* A slip: grows and fades. The end: starts wide and bright and closes in as it fades out. */
          const s = reduced ? 1 : ringEnd ? 1.9 - 0.9 * k : 0.7 + 0.7 * k;
          const a = (reduced ? 0.5 : 1) * (ringEnd ? (1 - k) : (1 - k) * (1 - k));
          ring.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
          ring.style.opacity = a.toFixed(3);
          ring.style.borderColor = ringEnd ? 'rgba(255,190,170,.9)' : 'rgba(190,250,255,.9)';
        }
      }
      if (sayAt >= 0) {
        if (t - sayAt >= SAY_MS || hide) { say.style.opacity = '0'; const at = sayAt; sayAt = -1; setTimeout(() => { if (sayAt < 0 && at) say.style.display = 'none'; }, FADE_MS + 50); }
        else say.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (y + 44).toFixed(1) + 'px) translate(-50%,0)';
      }
    },
    /* For the tests. */
    get state () { return { rings, slipTold, endTold, ring: ring.style.display !== 'none', text: sayAt >= 0 ? say.textContent : '' }; },
    get el () { return say; }, get ringEl () { return ring; },
  };
}
