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
  /* EVERY SIMULATED MANTA IS DRAWN (ruling 1 of 2B part five). Your train has
     300 follower slots and each bot 8; whatever is past its block — and any
     wild manta past the wild block — goes to the spill after the fixed slots,
     dressed in its train's colour, and the pool grows to fit. spillDress
     remembers what each spill slot is dressed as, so it is re-dressed only
     when that changes. */
  const spillDress = [];
  /* Train id -> the slot that draws its leader; follower -> its spill slot
     this frame (stamp.js reads it, so the spill lays wakes too). */
  const dressOf = new Map();
  let wildDeal = null;
  let spillSlot = new Map();
  let spillDeal = null, drawnRivals = 0;
  const SPILL_BASE = mantas.SPILL_BASE;
  let bestPeak = 0, beatShown = false, boardAt = 0, offScreen = 0;

  /* THE BOARD. Top ten by current length, and every bot says it is a bot:
     nobody should ever wonder whether they were beaten by a person. Twice a
     second, because it is text and reading it is not a per-frame job — and
     because sorting eleven trains sixty times a second to move nothing is
     work for its own sake. */
  function drawBoard (now) {
    const el = document.getElementById('board');
    if (!el) return;
    if (now - boardAt < 0.5) return;
    boardAt = now;
    const rows = [];
    for (const t of ctx.sim.trains) {
      const mine = t === ctx.sim.you;
      rows.push({
        mine,
        name: mine ? 'you' : 'bot ' + t.id + ' \u00b7 ' + (t.kind || 'bot'),
        len: t.dead > 0 ? 0 : t.followers.length,
      });
    }
    rows.sort((a, b) => b.len - a.len || (a.mine ? -1 : b.mine ? 1 : 0));
    el.innerHTML = rows.slice(0, 10).map((r, i) =>
      (r.mine ? '<b>' : '') + (i + 1) + '. ' + r.name + '  ' + r.len + (r.mine ? '</b>' : '')
    ).join('<br>');
  }

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
    const spill = [];                          // [manta, slot to dress as, size or 0]
    /* WHICH SLOT DRAWS EACH TRAIN'S LEADER, by train id: debris glows in its
       old train's colour, and a train id is not a block index once the
       bot-count slider has added or removed bots (ids keep counting up). */
    if (m.colours !== wildDeal) { wearing.length = 0; wildDeal = m.colours; }   // a new deal repaints
    dressOf.clear();
    dressOf.set(you.id, 0);
    const BLOCKS0 = (WILD_BASE - RIVAL_BASE) / RIVAL_LEN;
    ctx.sim.rivals.forEach((t, r) => dressOf.set(t.id, RIVAL_BASE + (r % BLOCKS0) * RIVAL_LEN));
    const now0 = ctx.sim.time, sp0 = ctx.sim.params;
    if (!dying) for (let i = n; i < f.length; i++) spill.push([f[i], 0, sizeFor(joinMix(f[i], now0), sp0)]);
    /* Ten bots have fixed blocks. The bot-count slider goes to twenty: the
       rest are drawn whole in the spill, dressed as the block whose colour
       they share. Blocks of bots the slider has removed are parked. */
    const BLOCKS = (WILD_BASE - RIVAL_BASE) / RIVAL_LEN;
    for (let r = BLOCKS; r < ctx.sim.rivals.length; r++) {
      const t = ctx.sim.rivals[r], dress = RIVAL_BASE + (r % BLOCKS) * RIVAL_LEN;
      if (t.dead > 0) continue;
      spill.push([t, dress, m.aSize.getX(RIVAL_BASE)]);
      for (const g of t.followers) spill.push([g, dress, 0]);
    }
    for (let r = ctx.sim.rivals.length; r < Math.min(drawnRivals, BLOCKS); r++)
      for (let k = 0; k < RIVAL_LEN; k++) m.aPos.setXYZ(RIVAL_BASE + r * RIVAL_LEN + k, PARKED, 0, PARKED);
    drawnRivals = ctx.sim.rivals.length;
    for (let r = 0; r < Math.min(ctx.sim.rivals.length, BLOCKS); r++) {
      const t = ctx.sim.rivals[r], base = RIVAL_BASE + r * RIVAL_LEN;
      /* A crashed bot is not in the water during its death beat: its leader
         scattered with the rest, so drawing it at the wreck drew a manta the
         simulation did not have. */
      if (t.dead > 0) m.aPos.setXYZ(base, PARKED, 0, PARKED);
      else { m.aPos.setXYZ(base, t.x, 0, t.z); m.aHead.setX(base, t.head); }
      const k = Math.min(t.followers.length, RIVAL_LEN - 1);
      for (let i = k; i < t.followers.length; i++) spill.push([t.followers[i], base, 0]);
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
      /* Dressed by TARGET, not by a yes/no: a slot refilled by another
         train's debris while the first still glowed kept the old colour.
         A train that has gone (the slider removed it) leaves its debris in
         its own colours. */
      const target = glowing && dressOf.has(q.wasColour) ? dressOf.get(q.wasColour) : -1;
      if (wearing[slot] !== target) {
        wearing[slot] = target;
        m.wearTrain(slot, target);
      }
      /* A scattered manta keeps its train's size while it glows and shrinks
       back to a wild 20 exactly as its own colour returns. */
      /* SINKING IS DRAWN AS LEAVING (ruling 3): dimming and shrinking away
         over the sink time, because it can no longer be collected. */
      const sp = ctx.sim.params, sink = q.alive && q.sinking > 0 ? Math.max(0.08, q.sinking / sp.drain) : 1;
      const mixL = q.loose ? looseMix(q) : 0;
      const wantW = sizeFor(mixL, sp) * (sink < 1 ? 0.35 + 0.65 * sink : 1);
      if (m.aSize.getX(slot) !== wantW) { m.aSize.setX(slot, wantW); sizeDirty = true; }
      const scale = glowing ? 1 + 1.2 * (q.glow / sp.scatterGlow) : (sink < 1 ? sink : 1);
      if (scale !== 1) { m.setTintScale(slot, scale); wasScaled[slot] = 1; }
      else if (wasScaled[slot]) { m.setTintScale(slot, 1); wasScaled[slot] = 0; }
    }
    for (let i = lim; i < drawnWild; i++) m.aPos.setXYZ(WILD_BASE + i, PARKED, 0, PARKED);
    drawnWild = lim;
    for (let i = WILD_SLOTS; i < w.length; i++) {
      const q = w[i];
      if (!q || !q.alive) continue;
      /* Past the wild block: glowing debris wears its train's colour, the
         same mapping as the block above, and otherwise its own. */
      const glow = q.loose && q.glow > 0;
      const dress = glow && dressOf.has(q.wasColour) ? dressOf.get(q.wasColour)
                         : WILD_BASE + ((q.colour >= 0 ? q.colour : 0) % WILD_SLOTS);
      spill.push([q, dress, sizeFor(q.loose ? looseMix(q) : 0, ctx.sim.params)]);
    }

    /* The spill, packed from SPILL_BASE; the drawn count is exactly what is
       used, and ensure() grows the pool when it has to. */
    /* A new deal (Reroll, or a palette switch) repaints every slot from its
       role, and a spill slot's role is a stand-in: dress them all again. */
    if (m.colours !== spillDeal) { spillDress.length = 0; spillDeal = m.colours; }
    spillSlot = new Map();
    m.ensure(SPILL_BASE + spill.length);
    const fsize = m.aSize.getX(RIVAL_BASE + 1);
    for (let j = 0; j < spill.length; j++) {
      const slot = SPILL_BASE + j, [g, dress, size] = spill[j];
      spillSlot.set(g, slot);
      m.aPos.setXYZ(slot, g.x, 0, g.z); m.aHead.setX(slot, g.head);
      if (spillDress[j] !== dress) { m.wearTrain(slot, dress); m.setTintScale(slot, 1); m.setCutMix(slot, 0); spillDress[j] = dress; }
      const sz = size || fsize;
      if (m.aSize.getX(slot) !== sz) { m.aSize.setX(slot, sz); sizeDirty = true; }
    }
    m.aPos.needsUpdate = true; m.aHead.needsUpdate = true;
  if (sizeDirty) { m.aSize.needsUpdate = true; sizeDirty = false; }

    /* SET PIECES ON REAL EVENTS. The cut's shockwave, light burst and beat of
       slow motion fire where a cut actually happened, and a crash shakes the
       camera for a quarter of a second. */
    /* ONE SET PIECE PER EVENT, WHERE IT HAPPENED (ruling 4 of 2B part four).
       This read every train's cut and crash flags each frame: any cut
       anywhere fired the burst on YOUR train, the flags stayed up through a
       wreck's death beat, and a crash was dropped while an earlier cut's
       timeline ran. Now the simulation records each crash and each crossing
       once, with its contact point; one on screen fires there, one off
       screen fires nothing and spends none of the page's flash allowance,
       and a crash shakes the camera only if it is yours. */
    const evs = ctx.sim.events;
    if (evs && evs.length) {
      const v = ctx.view, hw = v.w / 2 + 40, hh = v.h / 2 + 40;
      for (const e of evs.splice(0)) {
        if (Math.abs(e.x - at.x) > hw || Math.abs(e.z - at.z) > hh) { offScreen++; continue; }
        cut.trigger({ x: e.x, z: e.z });
        if (e.kind === 'crash' && e.id === you.id) shake = 0.25;
      }
    }
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
    drawBoard(ctx.sim.time);
  const card = document.getElementById('beat');
    if (card) {
      if (dying && !beatShown) {
        beatShown = true;
        card.textContent = String(Math.max(you.peak, you.lastPeak));
        card.className = 'on';
      } else if (!dying && beatShown) { beatShown = false; card.className = ''; }
    }
  }


  return { followCamera, get peak () { return peakLength; }, get offScreen () { return offScreen; },
           spillSlotOf: g => spillSlot.get(g) };
}
