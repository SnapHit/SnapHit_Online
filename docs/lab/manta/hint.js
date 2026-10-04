/* THE CONTROLS HINT (4A, design doc 7.1): one line, for the device in use,
 * on the first swim of each session (the first visit's included):
 *
 *   touch              Hold where you want to swim · double-tap and hold to burst
 *   mouse or keyboard  Mouse or arrow keys to steer · hold click or space to burst
 *
 * It fades after a few seconds of play, and at once on the first burst.
 * Interface, not light: a DOM element over the canvas that never takes a
 * touch, out of the brightness hierarchy with the labels and the board. A
 * fade is not a flash. The device is read from the pointer media queries
 * (a coarse pointer with no hover is a phone); a key pressed under the
 * touch line swaps it for the keyboard one, for a laptop with a touch
 * screen. The feedback page and the portal package run this same module.
 */
export const HINT_TOUCH = 'Hold where you want to swim \u00b7 double-tap and hold to burst';
export const HINT_KEYS = 'Mouse or arrow keys to steer \u00b7 hold click or space to burst';
const SHOW_FOR = 5000;         // ms on a real clock before it fades: a slow device must not hold it for ever
const FADE_MS = 700, QUICK_MS = 250;

export function isTouchDevice () {
  try {
    if (typeof matchMedia !== 'function') return false;
    return matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (_) { return false; }
}

export function createHint ({ touch = isTouchDevice(), now = () => performance.now() } = {}) {
  const el = document.createElement('div');
  el.id = 'hint';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;left:50%;top:calc(50% + 118px);transform:translate(-50%,0);z-index:4;' +
    'max-width:calc(100vw - 32px);padding:9px 16px;border-radius:999px;pointer-events:none;' +
    'font:600 15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0.01em;' +
    'color:#eaf6ff;text-align:center;white-space:nowrap;background:rgba(4,9,18,.6);' +
    'border:1px solid rgba(120,190,210,.35);box-shadow:0 2px 14px rgba(0,0,0,.35);' +
    'opacity:0;transition:opacity ' + FADE_MS + 'ms ease;display:none';
  el.textContent = touch ? HINT_TOUCH : HINT_KEYS;
  document.body.appendChild(el);
  let shown = false, shownAt = 0, done = false, mode = touch ? 'touch' : 'keys';

  function show () {
    if (shown || done) return;
    shown = true; shownAt = now();
    el.style.display = 'block';
    /* A forced style flush, so the transition runs from 0 rather than from
       "not displayed" (and runs at all on a device drawing a frame a second). */
    void el.offsetWidth;
    el.style.opacity = '0.95';
  }
  function hide (quick = false) {
    if (!shown) return;
    shown = false; done = true;
    el.style.transition = 'opacity ' + (quick ? QUICK_MS : FADE_MS) + 'ms ease';
    el.style.opacity = '0';
    setTimeout(() => { if (!shown) el.style.display = 'none'; }, (quick ? QUICK_MS : FADE_MS) + 50);
  }
  /* Once a step: the clock, and whether this is the first burst. */
  function update (dt, bursting, keyed) {
    if (!shown) return;
    if (bursting) { hide(true); return; }
    if (keyed && mode === 'touch') { mode = 'keys'; el.textContent = HINT_KEYS; }
    if (now() - shownAt >= SHOW_FOR) hide(false);
  }
  return { el, show, hide, update, get shown () { return shown; }, get text () { return el.textContent; }, get mode () { return mode; } };
}
