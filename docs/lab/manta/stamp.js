/* Stamping the wake into the light memory.
 *
 * Who deposits light, where, in what colour and how much of it. The light
 * memory itself is lightmemory.js; this decides what to hand it each frame.
 *
 * Lifted out of main.js unchanged, so the file it came from can stay under
 * the size this project holds itself to. It takes one context object rather
 * than a dozen arguments, and reads it at call time.
 */
export function createStamper (ctx) {
  const { mantas, COUNT, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE, STAMP_SLOTS, BURST_SLOT, P } = ctx;

  /* ------------------------------------------------------ stamping the wake */

  /* Where each manta was last frame, so it can be stamped along the segment it
     swept rather than at a point. A fast manta must paint a line. */
  /* Keyed by the MANTA, not the slot: a spill slot can hold a different
     manta from one frame to the next, and a segment from someone else's
     last position would paint a streak across the water. */
  const prev = new Map();
  let havePrev = false;
  let burstCleared = false;

  /* Tuned against the render, not guessed: with a fade of 0.985 a pixel under a
     passing manta accumulates about fifty frames of this before it clears, so
     the per-frame figure is small by design. */
  /* 0.0018, and the ceiling is measured rather than guessed.
  
     The phone reports 60 fps on both backends with a worst 1% of 17.7 ms and
     four draw calls, so the light memory costs almost nothing and there is no
     reason for it to be faint. But at 0.0030 the hierarchy inverts: the wake
     measured 63 against a dim manta's 56, so the water became brighter than an
     unattached manta and that manta's contrast with its own surroundings fell
     to 1.63. At 0.0018 the order holds and the dim manta still reads at 3.39
     times the water around it.
  
     Together with a fade of 0.993 this is about two and a half times the
     deposit and two and a half times the persistence of what was on the phone
     before. */
  const STAMP_BASE = 0.0018;
  const CRUISE = 120;               // world units a second, the reference speed

  /* Which instances get one of the slots, rebuilt each frame because the train
     grows. Your leader always, then followers spread evenly along the whole
     length so the tail of a long train deposits as well as its head, then the
     rivals. The spike scene keeps its scripted five and its four singles. */
  const stampList = [], stampKeys = [];
  /* Follower k (1-based) of a train, as the slot that draws it: its block
     slot while it has one, else wherever the spill put it this frame. */
  function slotOfFollower (t, k, blockBase, blockLen) {
    if (k <= blockLen) return blockBase + k;
    const s = ctx.spillSlotOf ? ctx.spillSlotOf(t.followers[k - 1]) : undefined;
    return s === undefined ? -1 : s;
  }
  function add (slot, key) {
    if (slot < 0 || stampList.length >= STAMP_SLOTS) return;
    stampList.push(slot); stampKeys.push(key);
  }
  function buildStampList () {
    stampList.length = 0; stampKeys.length = 0;
    if (ctx.sim) {
      /* Your leader, then followers spread along the WHOLE train, the ones
         past slot 300 included (they are drawn in the spill). */
      const you = ctx.sim.you, n = you.followers.length, take = Math.min(n, 14);
      add(0, you);
      for (let k = 1; k <= take; k++) {
        const f = Math.round(k * n / take);
        add(slotOfFollower(you, f, 0, TRAIN_MAX - 1), you.followers[f - 1]);
      }
      /* The first bot: its leader and eight along its whole length, so a
         follower past its eighth lays a wake like the rest. */
      const r0 = ctx.sim.rivals[0];
      if (r0 && !(r0.dead > 0)) {
        add(RIVAL_BASE, r0);
        const m = r0.followers.length, t8 = Math.min(m, 8);
        for (let k = 1; k <= t8; k++) {
          const f = Math.round(k * m / t8);
          add(slotOfFollower(r0, f, RIVAL_BASE, RIVAL_LEN - 1), r0.followers[f - 1]);
        }
      }
    } else {
      for (let i = 0; i < 5; i++) add(i, i);
      for (let i = RIVAL_BASE; i < RIVAL_BASE + 9; i++) add(i, i);
      for (let i = WILD_BASE; i < WILD_BASE + 4; i++) add(i, i);
    }
  }

  function stampMantas (dt) {
    if (!ctx.lm) return;
    if (!burstCleared) { ctx.lm.stamp(BURST_SLOT, 0, 0, 0, 0, 1, 0, 0, 0, 0); burstCleared = true; }
    const { aPos, aSize, aTint } = mantas;
    buildStampList();
    /* Slots nobody is using this frame deposit nothing, or the last manta to
       hold the slot would keep stamping where it was left. */
    for (let sl = stampList.length; sl < STAMP_SLOTS; sl++) ctx.lm.stamp(sl, 0, 0, 0, 0, 1, 0, 0, 0, 0);
    for (let sl = 0; sl < stampList.length; sl++) {
      const i = stampList[sl], key = stampKeys[sl], was = prev.get(key);
      const x = aPos.getX(i), z = aPos.getZ(i);
      const x0 = havePrev && was ? was.x : x, z0 = havePrev && was ? was.z : z;
      const moved = Math.hypot(x - x0, z - z0);
      /* A manta that has wrapped across the world did not swim that line, so it
         stamps a point rather than a stripe across the whole ocean. */
      const jumped = moved > 200;
      const speed = dt > 0 ? moved / dt : 0;
      const speedFactor = Math.min(Math.max(speed / CRUISE, 0.25), 1.5);
      const s = STAMP_BASE * P.stamp * (dt * 60) * speedFactor;
      /* A wake takes the colour of the train that made it (7.2), and a wild
         manta is not in one: it stirs only the plankton's own faint blue-green,
         at a fraction of the deposit, so a dark animal does not paint a dark
         trail and does not glow by proxy either. */
      const wild = mantas.isWild && mantas.isWild(i);
      const wr = wild ? 0.10 : aTint.getX(i);
      const wg = wild ? 0.42 : aTint.getY(i);
      const wb = wild ? 0.36 : aTint.getZ(i);
      ctx.lm.stamp(sl,
        jumped ? x : x0, jumped ? z : z0, x, z,
        aSize.getX(i) * 1.2,                       // about 1.2 wingspans
        wr, wg, wb, wild ? s * 0.35 : s);
      if (ctx.lmSlow && P.longMemory > 0) ctx.lmSlow.stamp(sl,
        jumped ? x : x0, jumped ? z : z0, x, z,
        aSize.getX(i) * 1.2,
        aTint.getX(i), aTint.getY(i), aTint.getZ(i), s);
      if (was) { was.x = x; was.z = z; } else prev.set(key, { x, z });
    }
    /* Forget anyone not stamped this frame, so the map cannot grow. */
    if (prev.size > stampKeys.length * 2) {
      const keep = new Set(stampKeys);
      for (const k of prev.keys()) if (!keep.has(k)) prev.delete(k);
    }
    havePrev = true;
  }


  return { stampMantas, buildStampList, forgetPrevious () { havePrev = false; },
           get list () { return stampList.slice(); } };
}
