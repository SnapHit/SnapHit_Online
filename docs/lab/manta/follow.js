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
import { createLabels, savedName, PALE } from './labels.js';
import { createRadar, createRadarModel } from './radar.js';

export function createFollow (ctx) {
  const { mantas, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE, WILD_SLOTS, PARKED,
          camera, zoomFor, setZoom, applyView, uCam, cut } = ctx;
  /* THE NEW LOOK (4A stage 3) is gated here and nowhere else in this file;
     ?look=classic is the end of stage 1. */
  const NEW = ctx.look !== 'classic';
  /* THE CUT'S KICK AND SLASH (4A stage 3, change 1). On your own cut on
     screen the camera and the ocean's view centre kick 9 units along your
     heading and spring back, critically damped (no overshoot) with a time
     constant of 55 ms, on a real clock so the slow-motion beat does not
     stretch it; and on any cut on screen a slash is stamped into the light
     memory: 140 units along the cutter's heading through the contact point,
     18 wide, the cutter's colour lifted 60 percent towards white, 0.30 a
     frame for 120 ms. Reduced flash and motion: no kick, the slash at 30
     percent. Both cost a few adds and one stamp: nothing a tier pays for. */
  const KICK = 9, KICK_TAU = 55, KICK_FOR = 300, SLASH_FOR = 120, SLASH_LEN = 140, SLASH_W = 18, SLASH_AMOUNT = 0.30;
  /* THE CRASH READS AS THE END (4A stage 3, change 2). Through the death
     beat the vignette deepens from its setting to VIG_DEEP over VIG_IN
     seconds and holds, then comes back over VIG_OUT at the restart; the
     card's number counts up from the length the crash took to the run's
     peak over COUNT_FOR seconds when they differ. One uniform write a
     frame and a text change; nothing flashes or moves fast, so reduced
     flash and motion keep all of it. */
  const VIG_DEEP = 0.42, VIG_IN = 0.4, VIG_OUT = 0.3, COUNT_FOR = 0.5;
  /* THE RECRUIT POPS (4A stage 3, change 3). A follower that has just
     joined is drawn POP_BY larger for its first POP_HOLD seconds of scene
     time and settles to its size by POP_FOR, an overshoot of the drawn size
     only (simcore's size rule, which the tests share, is untouched); and
     your leader's wake deposit doubles for BOOST_FOR seconds after a
     recruit (stamp.js reads recruitBoost), so a feeding run writes a
     brighter line. Reduced flash and motion: no overshoot (scaling is a
     motion trigger), the deposit kept. */
  const POP_BY = 0.30, POP_HOLD = 0.12, POP_FOR = 0.40, BOOST_FOR = 0.2, BOOST_BY = 2;
  let lastRecruitAt = -1;
  const popAt = age => (!NEW || (cut && cut.reduced) || age < 0 || age >= POP_FOR) ? 1
    : 1 + POP_BY * (age <= POP_HOLD ? 1 : Math.pow(1 - (age - POP_HOLD) / (POP_FOR - POP_HOLD), 2));
  let vigBase = null, vigNow = null, beatT = 0, countFrom = 0, countTo = 0, aliveLen = 0;
  const realNow = () => performance.now();
  let kickAt = -1, kickX = 0, kickZ = 0, slashAt = -1, slashOn = false;
  const slashSeg = { x0: 0, z0: 0, x1: 0, z1: 0, r: 1, g: 1, b: 1, k: 1 };
  const kickNow = () => { if (kickAt < 0) return 0; const t = realNow() - kickAt; if (t > KICK_FOR) { kickAt = -1; return 0; } const k = t / KICK_TAU; return (1 + k) * Math.exp(-k); };
  function startSlash (e, cutter, slot) {
    const fx = -Math.sin(cutter.head), fz = -Math.cos(cutter.head);
    slashSeg.x0 = e.x - fx * SLASH_LEN / 2; slashSeg.z0 = e.z - fz * SLASH_LEN / 2;
    slashSeg.x1 = e.x + fx * SLASH_LEN / 2; slashSeg.z1 = e.z + fz * SLASH_LEN / 2;
    const T = mantas.aTint, lift = c => { c = Math.min(1, Math.max(0, c)); return c + (1 - c) * 0.6; };
    slashSeg.r = lift(slot >= 0 ? T.getX(slot) : 0.8); slashSeg.g = lift(slot >= 0 ? T.getY(slot) : 0.8); slashSeg.b = lift(slot >= 0 ? T.getZ(slot) : 0.8);
    slashSeg.k = cut && cut.reduced ? 0.3 : 1;
    slashAt = realNow(); slashOn = true;
  }
  function drawSlash () {
    if (!ctx.lm || ctx.slashSlot === undefined) return;
    if (slashAt >= 0 && realNow() - slashAt <= SLASH_FOR) {
      const s = slashSeg;
      ctx.lm.stamp(ctx.slashSlot, s.x0, s.z0, s.x1, s.z1, SLASH_W, s.r, s.g, s.b, SLASH_AMOUNT * s.k);
    } else if (slashOn) { slashAt = -1; slashOn = false; ctx.lm.stamp(ctx.slashSlot, 0, 0, 0, 0, 1, 0, 0, 0, 0); }
  }

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
  let zoomNow = null, wasDying = false, lastRuns = undefined;   // the eased camera (3L)
  /* THE BURST ZOOM (4A, 10.2's zoom row): while you burst the view widens a
     further burstZoom percent, easing out over BURST_OUT seconds and back
     over BURST_BACK. burstMix runs 0 to 1 at those rates and the widening
     follows a smoothstep of it, so both ends ease. Reduced motion halves
     the widening (7.2: slow motion and distortion dropped, information
     kept). Kept apart from zoomNow, so the close-up camera's own ease and
     its 2% a frame cap are untouched and the tests still read them. */
  const BURST_OUT = 0.3, BURST_BACK = 0.6;
  let burstMix = 0, zoomDrawn = null, baseScale = 1;
  /* THE FIRST SWIM'S REVEAL (4A stage 3, change 5): on a session's first
     frame the view is INTRO_BY wider than the close zoom and eases in over
     INTRO_FOR seconds of scene time (a smoothstep), so the first frame
     shows the ocean around you before the close-up settles; the board
     waits for it (body.intro, the pages' CSS), so the first frame has one
     focal point. A one-off camera move on top of the zoom curve, which is
     untouched, and only on the first frame: a restart starts at the
     curve. Reduced flash and motion: no move. ?look=classic: none. */
  const INTRO_BY = 0.25, INTRO_FOR = 1.2;
  let introMix = 1, introOn = false;

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
        /* In a room (ctx.sim.room) a train a player drives carries their
           name; the solo lab has no names and reads exactly as before. */
        name: mine ? 'you' : ctx.sim.room && t.name ? t.name : 'bot ' + t.id + ' \u00b7 ' + (t.kind || 'bot'),
        len: t.dead > 0 ? 0 : t.followers.length,
      });
    }
    rows.sort((a, b) => b.len - a.len || (a.mine ? -1 : b.mine ? 1 : 0));
    /* Names are typed by strangers (3J): every row is plain text, built as
       elements, never as markup. */
    el.textContent = '';
    rows.slice(0, 10).forEach((r, i) => {
      if (i) el.appendChild(document.createElement('br'));
      const line = document.createElement(r.mine ? 'b' : 'span');
      line.textContent = (i + 1) + '. ' + r.name + '  ' + r.len;
      el.appendChild(line);
    });
  }

  /* A label over every leader on screen (3J, labels.js). In a room the
     page names the players (nameOf) and you (youName); watching, the
     watched train is labelled as the others are. Timed, for the tests. */
  const labels = createLabels(), list = [];
  const perf = window.__labLabels = { ms: 0, frames: 0, total: 0, count: 0, shown: labels.shown };
  let mineHex = null, mineCss = PALE;
  function drawLabels () {
    const t0 = performance.now(), sim = ctx.sim, v = ctx.view, P = sim.params || {};
    const ppu = v.pxPerUnit, W = v.w * ppu, H = v.h * ppu;
    const lift = ((P.spacing || 31) + (P.followerR || 10) * (P.trainScale || 1) + 2) * ppu + 3;
    const mine = mantas.colours && mantas.colours.mine;
    if (mine && mine.hex !== mineHex) { mineHex = mine.hex; mineCss = '#' + (mine.hex >>> 0).toString(16).padStart(6, '0'); }
    list.length = 0;
    const you = sim.you;
    if (you && !sim.watching && !(you.dead > 0)) list.push({ x: you.x, z: you.z, text: (sim.youName && sim.youName()) || savedName() || 'you', colour: mineCss });
    for (const t of sim.rivals || []) {
      if (!t || t.hole || t.dead > 0) continue;
      list.push({ x: t.x, z: t.z, text: (sim.nameOf && sim.nameOf(t.id)) || 'bot', colour: PALE });
    }
    perf.count = labels.draw(list, camera.position, ppu, W, H, lift);
    const ms = performance.now() - t0;
    perf.ms = ms; perf.frames++; perf.total += ms;
  }

  /* THE RADAR (3L, radar.js). Solo: every train's line straight from the
     simulation's trail, every frame. In a room: the model the room's channel
     feeds (roomview.js), plus your own leader each frame in play. Colours
     are the trains' identity colours on this page, by id. */
  const radarUI = createRadar(), radarSolo = createRadarModel();
  const perf2 = window.__radar = { ui: radarUI, last: null, get model () { return ctx.sim && ctx.sim.radar ? ctx.sim.radar : radarSolo; } };
  const colourCache = new Map();
  function radarColour (id) {
    const dealt = mantas.colours; if (!dealt || !dealt.mine) return PALE;
    const you = ctx.sim && ctx.sim.you, mineId = you ? (you.watched !== undefined && you.watched >= 0 && ctx.sim.room ? you.watched : you.id) : -1;
    const hex = id === mineId && !(ctx.sim && ctx.sim.watching) ? dealt.mine.hex : (dealt.rivals[(Math.max(1, id) - 1) % dealt.rivals.length] || dealt.mine).hex;
    let c = colourCache.get(hex); if (!c) { c = '#' + (hex >>> 0).toString(16).padStart(6, '0'); colourCache.set(hex, c); }
    return c;
  }
  function drawRadar () {
    const sim = ctx.sim; if (!sim) return;
    const P = ctx.P || sim.params, now = performance.now(), sp = sim.params.spacing || P.spacing || 19;
    const model = sim.radar || radarSolo, you = sim.you;
    if (!sim.radar) {
      for (const t of sim.trains) model.update(t.id, t.x, t.z, t.followers.length, !(t.dead > 0), t.runs, now, sp, true), model.pathFromTrail(t.id, t.trail, t.followers.length, sp);
    } else if (!sim.watching && you && you.watched >= 0 && !(you.dead > 0)) {
      model.update(you.watched, you.x, you.z, you.followers.length, true, you.runs, now, sp, true);
    }
    /* 96 to 160 CSS px on a phone; a desktop screen (short side 900 and
       up, 4A) may have up to 220, so the map stays readable at 1440p. */
    const short = Math.min(innerWidth, innerHeight), size = Math.round(Math.max(96, Math.min(short >= 900 ? 220 : 160, short * (P.radarSize || 28) / 100)));
    const mine = you && you.watched >= 0 ? you.watched : (you ? you.id : -1);
    perf2.last = radarUI.draw(model, { size, opacity: P.radarOpacity ?? 0.4, arenaR: sim.params.arenaR || P.arenaR || 2000, range: P.radarRange || 0,
      you: you ? { id: mine, x: you.x, z: you.z, len: sim.watching ? you.len : you.followers.length } : null, view: ctx.view, colourOf: radarColour }, now);
  }

  function followCamera (dt) {
    const you = ctx.sim.you;
    /* THE DEATH BEAT. Rule 3 ends the run at the crash, so for the second and
       a half that follows there is no train to follow: the camera holds the
       wreck and pulls back off it while the scatter burns, and the run's peak
       stands in the middle of the screen. Then a clean cut to wherever the
       simulation has put you. */
    const dying = you.dead > 0;
    /* WATCH MODE (?room=, roomview.js): `you` is only where the camera looks,
       a bot's leader. That bot is drawn once, with the rivals, so slot 0
       stays parked and the zoom follows the watched train's length. Unset in
       the solo lab, where every line here runs as before. */
    const watching = !!ctx.sim.watching;
    const beat = dying ? 1 - you.dead / ctx.sim.params.deathBeat : 0;
    const at = dying ? { x: you.crashX, z: you.crashZ } : you;
    /* THE CLOSE-UP CAMERA (3L). The target follows the curve (simcore.js
       zoomFor) of your drawn length, predicted pickups included; dying, it
       pulls back by the same proportion as before, never past the far zoom.
       The zoom then EASES, never jumps: towards a wider view over zoomEase
       seconds as the train grows, half as fast back in as it shrinks, so a
       cut does not yank the view; and never more than 2% per sixtieth of a
       second of frame time (2% a frame at 60 fps), so the ease cannot jump
       and a slow phone still keeps pace. A restart starts at the curve's
       value for the new spot, with no easing across the cut. */
    const ZP = ctx.P || ctx.sim.params;
    const target = dying ? Math.max(ZP.zoomFar ?? 0.4, zoomFor(peakLength, ZP) * (1 - 0.35 * beat))
                         : zoomFor(watching ? you.len : you.followers.length, ZP);
    const restarted = (wasDying && !dying) || (you.runs !== undefined && you.runs !== lastRuns);
    wasDying = dying; lastRuns = you.runs;
    /* On the scene clock, like everything drawn: a zero-second step moves
       nothing, and the tests drive it with the injectable clock. */
    const edt = Math.max(0, Math.min(0.25, dt));
    if (zoomNow === null && ctx.look !== 'classic' && !(cut && cut.reduced) && !watching) { introMix = 0; introOn = true; document.body.classList.add('intro'); }
    if (zoomNow === null || restarted) zoomNow = target;
    else {
      const tau = Math.max(0.05, (ZP.zoomEase || 1) * (target < zoomNow ? 1 : 2));
      let z = zoomNow + (target - zoomNow) * (1 - Math.exp(-edt / tau));
      const cap = 0.02 * Math.max(1, edt * 60);
      zoomNow = Math.max(zoomNow * (1 - cap), Math.min(zoomNow * (1 + cap), z));
    }
    /* Bursting: the simulation says so in solo (sim.js); in a room the
       prediction carries the same flag, and the input says so until it does. */
    const bursting = !dying && !watching && (you.bursting === true ||
      (!!(ctx.sim.input && ctx.sim.input.burst) && you.followers.length > 0));
    burstMix = bursting ? Math.min(1, burstMix + edt / BURST_OUT) : Math.max(0, burstMix - edt / BURST_BACK);
    const pct = Math.max(0, ZP.burstZoom ?? 12) * (cut && cut.reduced ? 0.5 : 1) / 100;
    const ease = burstMix * burstMix * (3 - 2 * burstMix);
    if (introOn) { introMix = Math.min(1, introMix + edt / INTRO_FOR); if (introMix >= 1) { introOn = false; document.body.classList.remove('intro'); } }
    const introEase = introMix * introMix * (3 - 2 * introMix);
    zoomDrawn = zoomNow / ((1 + pct * ease) * (1 + INTRO_BY * (1 - introEase)));
    baseScale = zoomDrawn / zoomNow;          // the base view is the drawn one times this (1 when not bursting)
    if (setZoom(zoomDrawn)) applyView(ctx.view);
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
    if (dying || watching) m.aPos.setXYZ(0, PARKED, 0, PARKED);
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
      if (NEW && !dying) lastRecruitAt = ctx.sim.time;
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
    const want = sizeFor(joinMix(f[i], now), ctx.sim.params) * popAt(now - f[i].born);
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
        if (NEW && e.kind === 'cut') {
          const cutter = e.by === you.id ? you : (ctx.sim.trains.find(t => t.id === e.by) || null);
          if (cutter) startSlash(e, cutter, dressOf.has(e.by) ? dressOf.get(e.by) : -1);
          if (cutter === you && !(cut && cut.reduced)) { kickAt = realNow(); kickX = -Math.sin(you.head) * KICK; kickZ = -Math.cos(you.head) * KICK; }
        }
      }
    }
    if (NEW) {
      drawSlash();
      const a = kickNow();
      if (a > 0) {
        camera.position.x += kickX * a; camera.position.z += kickZ * a;
        uCam.value.x += kickX * a; uCam.value.y += kickZ * a;
        camera.updateMatrixWorld();
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
    /* The feedback page (window.MANTA_QUERY) shows players no lab wording (3K). */
    if (el) el.textContent = watching ? (typeof window.MANTA_QUERY === 'string' ? '' : 'watching bot ' + you.watched + '   length ' + you.len + '   tap for the next')
                                      : 'length ' + f.length + '   peak ' + peakLength + '   best ' + bestPeak;
    drawBoard(ctx.sim.time);
    drawLabels();
    drawRadar();
  const card = document.getElementById('beat');
    if (card) {
      if (dying && !beatShown) {
        beatShown = true; beatT = 0;
        countTo = Math.max(you.peak, you.lastPeak); countFrom = NEW ? Math.min(countTo, aliveLen) : countTo;
        card.textContent = String(countFrom);
        card.className = 'on';
      } else if (!dying && beatShown) { beatShown = false; card.className = ''; }
      if (!dying) aliveLen = you.followers.length;   // the length the crash took, for the count-up
      if (NEW && beatShown) {
        beatT += Math.max(0, dt);
        const n = countFrom + Math.round((countTo - countFrom) * Math.min(1, beatT / COUNT_FOR));
        if (String(n) !== card.textContent) card.textContent = String(n);
      }
    }
    /* The vignette through the beat (post.js owns the uniform; ctx.post is read at call time). */
    if (NEW && ctx.post) {
      const P0 = ctx.post;
      if (vigBase === null) { vigBase = P0.vignette; vigNow = vigBase; }
      if (!dying && !beatShown && vigNow === vigBase && vigBase !== P0.vignette) { vigBase = P0.vignette; vigNow = vigBase; }   // ?vig= or a later setting moved it
      const want = dying ? VIG_DEEP : vigBase;
      const rate = (VIG_DEEP - vigBase) / (dying ? VIG_IN : VIG_OUT);
      vigNow = dying ? Math.min(want, vigNow + rate * Math.max(0, dt)) : Math.max(want, vigNow - rate * Math.max(0, dt));
      if (P0.vignette !== vigNow) P0.setVignette(vigNow);
    }
  }


  return { followCamera, get peak () { return peakLength; }, get offScreen () { return offScreen; }, get zoom () { return zoomNow; },
           get zoomDrawn () { return zoomDrawn; }, get burstMix () { return burstMix; },
           get kick () { return kickNow(); }, get slashing () { return slashOn; }, get look () { return NEW ? 'new' : 'classic'; },
           get vignette () { return vigNow; }, get card () { return { from: countFrom, to: countTo, t: beatT }; },
           get introMix () { return introMix; },
           get recruitBoost () { return NEW && lastRecruitAt >= 0 && ctx.sim.time - lastRecruitAt < BOOST_FOR ? BOOST_BY : 1; }, popAt,
           /* THE VIEW THE ROOM IS TOLD is the base one, without the burst's
              widening: roomcore's MARGIN (400 units beyond the view) covers
              the extra 12% with room to spare (at the far zoom on a phone
              the widening is 57 units in x and 128 in z), so nothing pops
              at the edge and the bytes a phone is sent do not change with
              a burst. Measured with the burst view reported instead: the
              median rose from under to over the 10 KB/s bar. */
           get baseView () { const v = ctx.view; return { w: v.w * baseScale, h: v.h * baseScale }; },
           spillSlotOf: g => spillSlot.get(g) };
}
