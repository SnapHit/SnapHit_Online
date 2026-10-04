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
 * Keyboard and mouse sit alongside all three (4A, design doc 7.1): the
 * arrow keys or WASD name a direction ON SCREEN, up meaning up the screen
 * whichever way the manta faces, two keys a diagonal, and the manta turns
 * towards it at its normal rate; with no key held it keeps its heading.
 * Space bursts while held. The mouse steers towards the pointer through the
 * live view, so the zoom is allowed for, and a held button bursts. The
 * right button never opens a menu.
 *
 * Why the keys felt inverted to a Reddit tester (October 2026): they turned
 * the manta RELATIVE TO ITS OWN NOSE, and with the sign mirrored. Left
 * subtracted from the heading, and forward is (-sin, -cos), so a smaller
 * heading swings the nose towards +x, which is screen right: left turned
 * right. Fixing the sign alone would still have left "left" meaning the
 * manta's own left, which is screen right whenever it swims down the screen.
 * Screen directions, as a finger gives them, remove both.
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

  const keys = { up: false, down: false, left: false, right: false };
  let keyBurst = false, firstKeyAt = null;
  const now = () => performance.now();

  /* Every touch that is down, in the order it went down. */
  const touches = new Map();          // pointerId -> { x, y, sx, sy, at, role }
  let mouse = null;                   // the pointer, in CSS px (client), converted each step through the live view
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
    if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY }; mouseBurst = true; return; }
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
    /* A mouse steers from the moment it moves over the water, as slither's
       does: no click needed to start. Kept in screen space and converted at
       each step, so a still pointer is still "that way on screen" after the
       camera has moved on, not a fixed spot of water the manta reaches and
       then circles. */
    if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY }; return; }
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
  /* A button released off the canvas still ends the burst. */
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse') mouseBurst = false; }, { passive: true });
  /* The right button bursts like any other; it never opens a menu. */
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const KEYS = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  const key = (e, down) => {
    /* Typing a name is not steering: a key in a text box is left alone. */
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    const k = (e.key || '').toLowerCase(), dir = KEYS[k];
    if (dir) keys[dir] = down;
    else if (k === ' ' || k === 'spacebar') keyBurst = down;
    else return;
    if (firstKeyAt === null) firstKeyAt = now();
    /* Only the keys we use: Escape still pauses and Tab still leaves. */
    e.preventDefault();
  };
  addEventListener('keydown', e => key(e, true));
  addEventListener('keyup', e => key(e, false));
  /* Keys that are still down when the window loses focus would steer for
     ever: Hurtle clears its steering on blur for the same reason. */
  addEventListener('blur', () => { keys.up = keys.down = keys.left = keys.right = false; keyBurst = false; mouseBurst = false; });

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

    /* THE KEYS NAME A DIRECTION ON SCREEN. Screen right is +x and screen up
       is -z (the camera looks straight down with up at -z), so the key
       vector is the world vector and `towards` turns it into the heading
       whose forward points that way; two keys give the diagonal, opposite
       keys cancel and the manta holds its course. The keys win over a
       finger and the mouse while any is held. */
    const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), kz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (kx !== 0 || kz !== 0) {
      want = Math.atan2(-kx, -kz);
    } else if (want === null && mouse) {
      /* Through the live view, so the zoom is allowed for: the pointer's
         place on screen, as world units at this step's zoom, relative to
         where the leader is drawn. */
      const w = toWorld(mouse.x, mouse.y);
      want = towards(w.x - leader.x, w.z - leader.z);
    }
    input.want = want;
    input.burst = burst;
  }

  return { apply, get scheme () { return scheme(); },
           get touches () { return touches.size; },
           /* For the hint: has a key or the mouse been used this session. */
           get keyed () { return firstKeyAt !== null; },
           get moused () { return mouse !== null; } };
}
