/* What the player is asking for, turned into a heading and a burst flag.
 *
 * Three touch schemes from section 10.2, chosen in the drawer:
 *
 *   A  steer towards your finger — the direction from your leader to the
 *      touch; double-tap and hold to burst. The one Nathan has been playing.
 *   B  steer towards your FIRST finger; hold a second finger anywhere to
 *      burst.
 *   C  a floating joystick where your thumb first lands on the left half of
 *      the screen, and a burst button anywhere on the right half.
 *
 * Keyboard and mouse sit alongside all three and do not change: the lab is
 * judged on a phone but written on a laptop.
 *
 * It writes into sim.input and nothing else. The simulation never reads a
 * device, so a test can drive the same two fields itself.
 */
export const SCHEMES = ['A', 'B', 'C'];

export function createControls (canvas, input, screenToWorld, getScheme = () => 0) {
  /* TOUCH-ACTION NONE, or the browser pans and zooms the page instead of
     steering: a drag across a canvas is a scroll gesture until you say it is
     not. No text selection or callout on a long press either. The panel and
     the drawer are outside the canvas and keep their own default behaviour,
     so their sliders still drag and their lists still scroll. */
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  canvas.style.webkitTouchCallout = 'none';

  let left = false, right = false, keyBurst = false;
  const now = () => performance.now();

  /* Every touch that is down, in the order it went down. */
  const touches = new Map();          // pointerId -> { x, y, sx, sy, at, role }
  let mouse = null;                   // the cursor, in world units
  let mouseBurst = false;
  let lastTapAt = -1e9, tapHold = false;   // scheme A's double tap

  /* Scheme C's joystick, drawn in code: a ring where the thumb landed and a
     dot where it is now. Never takes a touch itself. */
  const stick = document.createElement('div');
  const knob = document.createElement('div');
  stick.style.cssText = 'position:fixed;width:96px;height:96px;margin:-48px 0 0 -48px;' +
    'border:2px solid #7fe3d066;border-radius:50%;pointer-events:none;display:none;z-index:3';
  knob.style.cssText = 'position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;' +
    'background:#7fe3d055;border-radius:50%;pointer-events:none;display:none;z-index:3';
  document.body.append(stick, knob);

  const rect = () => canvas.getBoundingClientRect();
  const toWorld = (cx, cy) => {
    const r = rect();
    return screenToWorld((cx - r.left) / r.width, (cy - r.top) / r.height);
  };
  const scheme = () => SCHEMES[Math.round(getScheme())] || 'A';

  canvas.addEventListener('pointerdown', e => {
    /* Capture can refuse an id it has not seen; steering must not care. */
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    if (e.pointerType === 'mouse') { mouse = toWorld(e.clientX, e.clientY); mouseBurst = true; return; }
    const r = rect();
    const t = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, at: now(), role: 'steer' };
    const s = scheme();
    if (s === 'A') {
      /* Double-tap and hold: a second tap within 300 ms that is still held. */
      tapHold = (now() - lastTapAt) < 300;
      lastTapAt = now();
    } else if (s === 'B') {
      /* The first finger down steers; any finger after it is the burst. */
      const steering = [...touches.values()].some(o => o.role === 'steer');
      t.role = steering ? 'burst' : 'steer';
    } else {
      /* Left half: the joystick, anchored where the thumb landed. Right half:
         the burst button. One joystick at a time. */
      const leftHalf = (e.clientX - r.left) < r.width / 2;
      const hasStick = [...touches.values()].some(o => o.role === 'stick');
      t.role = leftHalf && !hasStick ? 'stick' : (leftHalf ? 'none' : 'burst');
      if (t.role === 'stick') {
        stick.style.left = knob.style.left = e.clientX + 'px';
        stick.style.top = knob.style.top = e.clientY + 'px';
        stick.style.display = knob.style.display = 'block';
      }
    }
    touches.set(e.pointerId, t);
  }, { passive: true });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') { if (mouse || e.buttons) mouse = toWorld(e.clientX, e.clientY); return; }
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (t.role === 'stick') {
      /* The knob follows the thumb but stays inside the ring. */
      const dx = t.x - t.sx, dy = t.y - t.sy, d = Math.hypot(dx, dy), k = d > 40 ? 40 / d : 1;
      knob.style.left = (t.sx + dx * k) + 'px'; knob.style.top = (t.sy + dy * k) + 'px';
    }
  }, { passive: true });

  const up = e => {
    if (e.pointerType === 'mouse') { mouseBurst = false; return; }
    const t = touches.get(e.pointerId);
    if (t && t.role === 'stick') stick.style.display = knob.style.display = 'none';
    touches.delete(e.pointerId);
    if (touches.size === 0) tapHold = false;
  };
  canvas.addEventListener('pointerup', up, { passive: true });
  canvas.addEventListener('pointercancel', up, { passive: true });

  const key = (e, down) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { left = down; }
    else if (k === 'arrowright' || k === 'd') { right = down; }
    else if (k === ' ' || k === 'arrowup' || k === 'w') { keyBurst = down; }
    else return;
    /* Only the keys we use: Escape still pauses and Tab still leaves. */
    e.preventDefault();
  };
  addEventListener('keydown', e => key(e, true));
  addEventListener('keyup', e => key(e, false));

  /* The heading whose forward vector (-sin, -cos) points along (dx, dz).
     Mirrored, this steered away from the touch on one axis. */
  const towards = (dx, dz) => (dx * dx + dz * dz) > 4 ? Math.atan2(-dx, -dz) : null;

  /* Called once a step with where the leader is, because "towards your
     finger" is a direction and not a place. */
  function apply (leader, dt) {
    const s = scheme();
    const all = [...touches.values()];
    let want = null, burst = keyBurst || mouseBurst;

    if (s === 'A') {
      /* The most recent touch steers, as it always has. */
      const t = all[all.length - 1];
      if (t) { const w = toWorld(t.x, t.y); want = towards(w.x - leader.x, w.z - leader.z); }
      burst = burst || (tapHold && all.length > 0);
    } else if (s === 'B') {
      const t = all.find(o => o.role === 'steer');
      if (t) { const w = toWorld(t.x, t.y); want = towards(w.x - leader.x, w.z - leader.z); }
      burst = burst || all.some(o => o.role === 'burst');
    } else {
      /* The camera looks straight down with screen-up at -Z, so a thumb's
         push on the screen is the same vector in the world. A small dead zone
         holds course rather than twitching. */
      const t = all.find(o => o.role === 'stick');
      if (t) {
        const dx = t.x - t.sx, dy = t.y - t.sy;
        want = Math.hypot(dx, dy) > 8 ? Math.atan2(-dx, -dy) : null;
      }
      burst = burst || all.some(o => o.role === 'burst');
    }

    if (left !== right) {
      const rate = 3.2 * dt * (left ? -1 : 1);
      want = leader.head + rate * 12;              // a steady lean, not a snap
    } else if (want === null && mouse) {
      want = towards(mouse.x - leader.x, mouse.z - leader.z);
    }
    input.want = want;
    input.burst = burst;
  }

  return { apply, get scheme () { return scheme(); },
           get touches () { return touches.size; } };
}
