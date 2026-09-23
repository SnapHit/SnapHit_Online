/* The debug block, at the foot of the expanded panel.
 *
 * Counts that say what the simulation is doing, a clock you can slow or stop,
 * the seed with a button that replays it, and a switch that draws everything
 * as plain shapes. It lives inside #panel, so it is out of the way whenever
 * the panel is collapsed.
 *
 * SLOW MOTION AND PAUSE SCALE THE SIMULATION'S CLOCK, NOT THE DRAWING. The
 * frame loop keeps running at full rate; only the time it hands to the world
 * shrinks. A single step, while paused, hands it exactly one fixed step.
 *
 * FLAT SHAPES exists to separate drawing cost from simulation cost: every
 * manta in one unlit colour, the ocean one flat colour, no light memory, no
 * shadows, no bloom. If the frame rate comes back with it on, the cost was in
 * the drawing; if not, it was in the simulation.
 */
import { MeshBasicNodeMaterial, Color } from 'three';

const RATES = [1, 0.5, 0.25];

export function createDebug ({ sim, seed, step, scene }) {
  /* Swapped in once when the switch flips, not every frame: the ocean is the
     scene's background node, so flat water is a plain background colour and
     flat mantas are one unlit material over everything. */
  const flatMat = new MeshBasicNodeMaterial({ color: 0xcfe8ff });
  const ocean = scene.backgroundNode;
  const onFlat = on => {
    scene.backgroundNode = on ? null : ocean;
    scene.background = on ? new Color(0x0a1a2a) : null;
    scene.overrideMaterial = on ? flatMat : null;
  };
  const panel = document.getElementById('panel');
  const box = document.createElement('div');
  box.id = 'debug';
  box.style.cssText = 'margin:8px 0;padding:8px 0;border-top:1px solid #ffffff22;border-bottom:1px solid #ffffff22;font:12px/1.5 ui-monospace,monospace';
  const counts = document.createElement('div');
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
  box.append(counts, btns);
  /* Above the rows, not below them: the foot of the panel scrolls under the
     button bar on a phone, and a switch you cannot reach is no switch. */
  panel.insertBefore(box, document.getElementById('rows'));

  let rate = 1, paused = false, owed = 0, flat = false;

  const button = (id, text, on) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.textContent = text;
    b.style.cssText = 'min-height:36px;padding:4px 10px;border-radius:8px;border:1px solid #ffffff33;' +
      'background:#0b1a24;color:#dff;font:inherit;touch-action:manipulation';
    b.addEventListener('click', on);
    btns.appendChild(b);
    return b;
  };
  const mark = () => {
    for (const r of RATES) document.getElementById('dbgRate' + r).style.borderColor = (r === rate ? '#7fe3d0' : '#ffffff33');
    pauseB.textContent = paused ? 'Resume' : 'Pause';
    stepB.disabled = !paused;
    flatB.textContent = flat ? 'Flat shapes: on' : 'Flat shapes: off';
  };

  for (const r of RATES) button('dbgRate' + r, '×' + r, () => { rate = r; mark(); });
  const pauseB = button('dbgPause', 'Pause', () => { paused = !paused; mark(); });
  const stepB = button('dbgStep', 'Step', () => { if (paused) owed += step; });
  const flatB = button('dbgFlat', 'Flat shapes: off', () => { flat = !flat; onFlat(flat); mark(); });
  /* The same seed, the same deal and the same bots. Your own touches are not
     recorded, so it replays the world, not the run. */
  button('dbgReplay', 'Replay seed ' + seed, () => {
    const u = new URL(location.href);
    u.searchParams.set('seed', String(seed));
    location.href = u.href;
  });
  mark();

  function show () {
    if (!sim || panel.hidden) return;
    const ts = sim.trains;
    let live = 0, longest = 0;
    for (const t of ts) {
      if (!t.dead) live++;
      if (t.followers.length > longest) longest = t.followers.length;
    }
    counts.textContent = 'trains ' + live + ' of ' + ts.length + '  ·  wild alive ' + sim.liveWild() +
      '\nyou ' + sim.you.followers.length + '  ·  longest ' + longest +
      '\nclock ×' + (paused ? 0 : rate) + (paused ? ' (paused)' : '') + '  ·  seed ' + seed;
    counts.style.whiteSpace = 'pre';
  }

  return {
    /* What the world's clock runs at this frame. */
    get rate () { return paused ? 0 : rate; },
    /* A single step, taken once. */
    takeOwed () { const o = owed; owed = 0; return o; },
    get flat () { return flat; },
    show,
  };
}
