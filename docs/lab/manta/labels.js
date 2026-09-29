/* NAMES IN THE WATER (3J, design doc 10.6): a small label over every
 * leader on screen, so you can tell a person from a bot, and who cut you.
 * A player's name, "bot" for a bot, your own name (or "you") in your
 * train's colour.
 *
 * Interface, not light: a pooled DOM overlay above the canvas, never drawn
 * in the scene, so it costs no vertex buffer and no request, and it stays
 * out of the brightness hierarchy (the four-conditions harness hides
 * #labels with the board). Text goes in with textContent only, never as
 * markup: names are typed by strangers. Each label is moved with a
 * transform only, and its text and colour are written only when they
 * change, so a steady frame touches nothing but transforms.
 *
 * Where: centred over the leader and lifted by the follower spacing plus a
 * follower's radius, in world units, so it clears the leader and its first
 * follower however the train is turned, and scales with the zoom. It never
 * rotates. Off screen, crashed or in its death beat, a leader has none. */
const STYLE = 'position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;' +
  'font:500 11px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0.01em;' +
  'opacity:0.7;will-change:transform;' +
  'text-shadow:0 0 2px rgba(0,0,0,0.85),0 0 1px rgba(0,0,0,0.9)';
export const PALE = '#e6f1fb';
/* Your typed name, kept on this phone (3J stage 2 writes it). */
export const NAME_KEY = 'manta:name';
export function savedName () { try { const v = localStorage.getItem(NAME_KEY); return v && v.length ? v : null; } catch (_) { return null; } }

export function createLabels () {
  const root = document.createElement('div');
  root.id = 'labels';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;contain:strict';
  document.body.appendChild(root);
  const pool = [];
  function slot (i) {
    let e = pool[i];
    if (!e) {
      e = document.createElement('div');
      e.style.cssText = STYLE;
      e.style.display = 'none';
      root.appendChild(e);
      e._t = null; e._c = null; e._on = false; e._x = 0; e._y = 0;
      pool[i] = e;
    }
    return e;
  }
  /* list: [{ x, z, text, colour }] in world units; cam: the camera's x and
     z; ppu: CSS px per unit; W, H: the view in CSS px; lift: CSS px. */
  function draw (list, cam, ppu, W, H, lift) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      const sx = W / 2 + (L.x - cam.x) * ppu, sy = H / 2 + (L.z - cam.z) * ppu - lift;
      if (sx < -80 || sx > W + 80 || sy < -20 || sy > H + lift + 20) continue;
      const e = slot(n++);
      if (e._t !== L.text) { e.textContent = L.text; e._t = L.text; }
      if (e._c !== L.colour) { e.style.color = L.colour; e._c = L.colour; }
      e._x = sx; e._y = sy;
      e.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-100%)';
      if (!e._on) { e.style.display = ''; e._on = true; }
    }
    for (let i = n; i < pool.length; i++) if (pool[i]._on) { pool[i].style.display = 'none'; pool[i]._on = false; }
    return n;
  }
  /* For the tests: where each shown label is anchored (bottom centre). */
  const shown = () => pool.filter(e => e._on).map(e => ({ text: e._t, colour: e._c, x: e._x, y: e._y }));
  return { draw, shown, root };
}
