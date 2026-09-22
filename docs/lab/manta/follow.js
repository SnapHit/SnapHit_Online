/* Putting the simulation on screen: the camera, and every instance.
 *
 * Where the camera goes, what zoom it holds, which instance slot each manta
 * in the world occupies, the colour a recruit takes as it joins, the colour a
 * scattered manta borrows while it glows, and the shake after a crash.
 *
 * Lifted out of main.js unchanged. It reads one context at call time, because
 * the light memory and the shadow pass are built after this is created.
 */
import { joinMix, looseMix, sizeFor, leaderSize } from './sim.js';

export function createFollow (ctx) {
  const { mantas, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE, WILD_SLOTS, PARKED,
          camera, zoomFor, setZoom, applyView, uCam, cut } = ctx;

  /* A recruit does not snap to your colour: 7.2 calls for it to arrive over a
     beat. It cannot be a gradient across the animal's body without a seventh
     instance attribute, and WebGPU guarantees eight vertex buffers a pipeline
     with six already spent, so this is a cross-fade in time from the colour it
     wore as a wild manta to yours. */
  const RECRUIT_FADE = 0.5;                 // seconds
  const fading = new Map();                 // instance slot -> seconds left
  const wearing = [], wasScaled = [];       // which wild slots are borrowed colours
  let drawnFollowers = 0, drawnWild = 0, peakLength = 0, shake = 0, sizeDirty = false;
  let bestPeak = 0, beatShown = false;

  function followCamera (dt) {
    const you = ctx.sim.you;
    /* THE DEATH BEAT. Rule 3 ends the run at the crash, so for the second and
       a half that follows there is no train to follow: the camera holds the
       wreck and pulls back off it while the scatter burns, and the run's peak
       stands in the middle of the screen. Then a clean cut to wherever the
       simulation has put you. */
    const dying = you.dead > 0;
    const beat = dying ? 1 - you.dead / ctx.sim.params.deathBeat : 0;
    const at = dying ? { x: you.crashX, z: you.crashZ } : you;
    const z = dying ? Math.max(0.55, zoomFor(peakLength, ctx.sim.params) * (1 - 0.35 * beat))
                    : zoomFor(you.followers.length, ctx.sim.params);
    if (setZoom(z)) applyView(ctx.view);
    uCam.value.set(at.x, at.z);
    camera.position.set(at.x, 1000, at.z);
    camera.lookAt(at.x, 0, at.z);
    camera.up.set(0, 0, -1);
    camera.updateMatrixWorld();
    if (ctx.lm) ctx.lm.setCentre(at.x, at.z);
    if (ctx.lmSlow) ctx.lmSlow.setCentre(at.x, at.z);
    if (ctx.shadows) ctx.shadows.setCentre(at.x, at.z);

    const m = mantas, f = you.followers;
    const n = dying ? 0 : Math.min(f.length, TRAIN_MAX - 1);
    /* Nothing of yours is in the water during the beat: the leader scattered
       with the rest of the train. */
    if (dying) m.aPos.setXYZ(0, PARKED, 0, PARKED);
    else { m.aPos.setXYZ(0, you.x, 0, you.z); m.aHead.setX(0, you.head); }
    const lead = leaderSize(ctx.sim.params);
    if (m.aSize.getX(0) !== lead) { m.aSize.setX(0, lead); sizeDirty = true; }
    /* Anyone who joined since the last frame arrives wearing their own colour
       and fades into yours. The slot has to take their colour as its own too,
       or a scatter in stage 3 would hand it the one the deal gave the slot. */
    for (let i = drawnFollowers; i < n; i++) {
      const src = f[i].from;
      if (src >= 0) m.adoptOwn(i + 1, WILD_BASE + src);
      m.setCutMix(i + 1, 1);
      fading.set(i + 1, RECRUIT_FADE);
    }
    for (const [slot, left] of fading) {
      const t = left - dt;
      if (t <= 0) { m.setCutMix(slot, 0); fading.delete(slot); }
      else { m.setCutMix(slot, t / RECRUIT_FADE); fading.set(slot, t); }
    }
    /* SIZE FOLLOWS STATE, on the same number as the colour: a recruit is 20
     units wide and its own colour as it joins, and 28 and yours half a
     second later. v1.10 makes food read apart from a train at a glance. */
  const now = ctx.sim.time;
  for (let i = 0; i < n; i++) {
    m.aPos.setXYZ(i + 1, f[i].x, 0, f[i].z); m.aHead.setX(i + 1, f[i].head);
    const want = sizeFor(joinMix(f[i], now), ctx.sim.params);
    if (m.aSize.getX(i + 1) !== want) { m.aSize.setX(i + 1, want); sizeDirty = true; }
  }
    /* Park what the train no longer uses, rather than leaving a stale manta
       sitting where the tail was. Only the slots that were drawn last frame. */
    for (let i = n; i < drawnFollowers; i++) m.aPos.setXYZ(i + 1, PARKED, 0, PARKED);
    drawnFollowers = n;

    /* THE RIVALS ARE THE SIMULATION'S NOW, not the script's: stage 3 puts them
       on the same rules, so they crash into you, get cut by you, and recruit
       their own trains back. */
    for (let r = 0; r < ctx.sim.rivals.length; r++) {
      const t = ctx.sim.rivals[r], base = RIVAL_BASE + r * RIVAL_LEN;
      m.aPos.setXYZ(base, t.x, 0, t.z); m.aHead.setX(base, t.head);
      const k = Math.min(t.followers.length, RIVAL_LEN - 1);
      for (let i = 0; i < k; i++) { const g = t.followers[i];
        m.aPos.setXYZ(base + 1 + i, g.x, 0, g.z); m.aHead.setX(base + 1 + i, g.head); }
      for (let i = k; i < RIVAL_LEN - 1; i++) m.aPos.setXYZ(base + 1 + i, PARKED, 0, PARKED);
    }

    /* The ambient 300 and everything loose. A scattered manta wears the colour
       of the train it came out of while it glows, and goes back to its own when
       the glow runs out (7.2). */
    const w = ctx.sim.wild, lim = Math.min(w.length, WILD_SLOTS);
    for (let i = 0; i < lim; i++) {
      const q = w[i], slot = WILD_BASE + i;
      if (q.alive) { m.aPos.setXYZ(slot, q.x, 0, q.z); m.aHead.setX(slot, q.head); }
      else m.aPos.setXYZ(slot, PARKED, 0, PARKED);
      const glowing = q.alive && q.loose && q.glow > 0;
      if (glowing !== !!wearing[slot]) {
        wearing[slot] = glowing;
        m.wearTrain(slot, glowing ? (q.wasColour === 0 ? 0 : RIVAL_BASE + (q.wasColour - 1) * RIVAL_LEN) : -1);
      }
      /* A scattered manta keeps its train's size while it glows and shrinks
       back to a wild 20 exactly as its own colour returns. */
    const mixL = q.loose ? looseMix(q) : 0;
    const wantW = sizeFor(mixL, ctx.sim.params);
    if (m.aSize.getX(slot) !== wantW) { m.aSize.setX(slot, wantW); sizeDirty = true; }
    if (glowing) m.setTintScale(slot, 1 + 1.2 * (q.glow / ctx.sim.params.scatterGlow));
      else if (wasScaled[slot]) { m.setTintScale(slot, 1); wasScaled[slot] = 0; }
      if (glowing) wasScaled[slot] = 1;
    }
    for (let i = lim; i < drawnWild; i++) m.aPos.setXYZ(WILD_BASE + i, PARKED, 0, PARKED);
    drawnWild = lim;
    m.aPos.needsUpdate = true; m.aHead.needsUpdate = true;
  if (sizeDirty) { m.aSize.needsUpdate = true; sizeDirty = false; }

    /* SET PIECES ON REAL EVENTS. The cut's shockwave, light burst and beat of
       slow motion fire where a cut actually happened, and a crash shakes the
       camera for a quarter of a second. */
    let event = null;
    /* A CUT ANYWHERE IS A SET PIECE; A CRASH SHAKES ONLY IF IT IS YOURS.
       Ten bots crash all over the arena and the screen was jolting for every
       one of them, including ones nowhere near the frame. */
    for (const t of ctx.sim.trains) if (t.cut > 0.24) event = 'cut';
    if (you.crashed > 0.24) event = 'crash';
    /* A crash is a set piece too now: the train bursting into light. The cut's
       own timeline already respects the page-wide flash cap and the reduced
       flash setting, and the peak card is information, so it shows either way. */
    if (event && !cut.running) cut.trigger();
    if (event === 'crash') shake = 0.25;
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      const a = shake * 26;
      camera.position.x += Math.sin(shake * 91) * a;
      camera.position.z += Math.cos(shake * 73) * a;
      camera.updateMatrixWorld();
    }

    /* The score is the run's peak, and the run ends at a crash. */
    peakLength = you.peak;
    if (you.lastPeak > bestPeak) bestPeak = you.lastPeak;
    if (peakLength > bestPeak) bestPeak = peakLength;
    const el = document.getElementById('len');
    if (el) el.textContent = 'length ' + f.length + '   peak ' + peakLength + '   best ' + bestPeak;
    const card = document.getElementById('beat');
    if (card) {
      if (dying && !beatShown) {
        beatShown = true;
        card.textContent = String(Math.max(you.peak, you.lastPeak));
        card.className = 'on';
      } else if (!dying && beatShown) { beatShown = false; card.className = ''; }
    }
  }


  return { followCamera, get peak () { return peakLength; } };
}
