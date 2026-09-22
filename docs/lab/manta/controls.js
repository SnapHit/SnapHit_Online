/* What the player is asking for, turned into a heading and a burst flag.
 *
 * Scheme A from 10.2: steer towards your finger — the direction from your
 * leader to the touch point — with double-tap and hold to burst. Keyboard
 * and mouse alongside it, because the lab is judged on a phone but written
 * on a laptop.
 *
 * It writes into sim.input and nothing else. The simulation never reads a
 * device, so a test can drive the same two fields itself.
 */
export function createControls (canvas, input, screenToWorld) {
  /* TOUCH-ACTION NONE, or the browser pans and zooms the page instead of
     steering: a drag across a canvas is a scroll gesture until you say it is
     not. The panel and the drawer are outside the canvas and keep their own
     default behaviour, so the sliders still work. */
  canvas.style.touchAction = 'none';

  let left = false, right = false, keyBurst = false;
  let pointer = null;              // the live touch or cursor, in world units
  let pointerBurst = false;
  let lastTapAt = -1e9, tapHold = false;

  const now = () => performance.now();

  function aim (clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    pointer = screenToWorld((clientX - r.left) / r.width, (clientY - r.top) / r.height);
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture?.(e.pointerId);
    aim(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { pointerBurst = true; return; }
    /* Double-tap and hold: a second tap within 300 ms that is still held. */
    tapHold = (now() - lastTapAt) < 300;
    lastTapAt = now();
    pointerBurst = tapHold;
  }, { passive: true });

  canvas.addEventListener('pointermove', e => { if (pointer || e.buttons) aim(e.clientX, e.clientY); }, { passive: true });
  const up = e => { pointerBurst = false; tapHold = false; if (e.pointerType !== 'mouse') pointer = null; };
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

  /* Called once a frame with where the leader is, because "towards your
     finger" is a direction and not a place. */
  function apply (leader, dt) {
    if (left !== right) {
      const rate = 3.2 * dt * (left ? -1 : 1);
      input.want = leader.head + rate * 12;         // a steady lean, not a snap
    } else if (pointer) {
      const dx = pointer.x - leader.x, dz = pointer.z - leader.z;
      input.want = (dx * dx + dz * dz) > 4 ? Math.atan2(dx, -dz) : null;
    } else input.want = null;
    input.burst = keyBurst || pointerBurst;
  }

  return { apply, get aiming () { return pointer; } };
}
