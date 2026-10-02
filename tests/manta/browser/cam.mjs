/* Does the camera actually sit on your leader, and does the same-area rule
   hold in the live view at every zoom the game reaches? */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
await p.goto(O+'/lab/manta/?tier=high&backend=webgl2&seed=4242',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>{});
await p.waitForTimeout(5000);
const r=await p.evaluate(()=>{
  const L=window.__lab, S=window.__sim;
  if(!S) return {error:'no sim'};
  L.pause();
  /* Clear of every bot, and not mid-death: the camera holds the wreck for a
     second and a half after a crash, which is correct and is not "the camera
     sits on your leader". */
  S.rivals.forEach((t, i) => { t.x = 2600 + i * 200; t.z = 2600; t.followers.length = 0; });
  S.you.dead = 0; S.you.x = 0; S.you.z = 0; S.you.head = 0; S.seedTrail(S.you);
  const out={samples:[]};
  for (const len of [0, 60, 150, 300]) {
    /* Fake a train of that length so the zoom moves, then let the page's own
       follow step run. */
    S.you.followers.length = 0;
    /* Real follower objects: the renderer writes their positions into the
       instance buffer now, and an empty one would land as NaN. The sim's own
       placeFollowers puts them on the path on the first step. */
    for (let i=0;i<len;i++) S.you.followers.push({ x:S.you.x, z:S.you.z, head:S.you.head });
    for (let i=0;i<30;i++) S.step();
    L.step(1/60);
    const cam = L.camera, v = L.view;
    out.samples.push({
      len,
      leader: [+S.you.x.toFixed(1), +S.you.z.toFixed(1)],
      cam: [+cam.position.x.toFixed(1), +cam.position.z.toFixed(1)],
      inst0: [+L.mantas.aPos.getX(0).toFixed(1), +L.mantas.aPos.getZ(0).toFixed(1)],
      off: +Math.hypot(cam.position.x - S.you.x, cam.position.z - S.you.z).toFixed(2),
      view: [+v.w.toFixed(1), +v.h.toFixed(1)],
      area: Math.round(v.w * v.h),
      zoom: +(Math.sqrt(329160 / (v.w*v.h))).toFixed(3),
    });
  }
  return out;});
if (r.error) { ok('the page has a simulation', false, r.error); }
else {
  for (const s of r.samples)
    console.log('   length '+String(s.len).padStart(3)+
      '  leader '+JSON.stringify(s.leader).padEnd(18)+
      ' camera '+JSON.stringify(s.cam).padEnd(18)+
      ' off '+String(s.off).padStart(5)+
      '  view '+JSON.stringify(s.view).padEnd(16)+' area '+s.area+'  zoom '+s.zoom);
  ok('the camera sits on your leader at every length',
     r.samples.every(s => s.off < 2), 'worst offset ' + Math.max(...r.samples.map(s=>s.off)) + ' units');
  ok('instance 0 IS your leader',
     r.samples.every(s => Math.hypot(s.inst0[0]-s.leader[0], s.inst0[1]-s.leader[1]) < 2),
     JSON.stringify(r.samples.map(s=>s.inst0)));
  ok('the area rule holds in the live view at every zoom',
     r.samples.every(s => Math.abs(s.area * s.zoom * s.zoom - 329160) / 329160 < 0.01),
     r.samples.map(s=>s.area+'@'+s.zoom).join('  '));
  ok('and the zoom actually moved', r.samples[0].zoom !== r.samples[3].zoom,
     r.samples[0].zoom + ' -> ' + r.samples[3].zoom);
}
/* HEADFIRST ON SCREEN, driven through the real control path. The guard
   suite's headfirst check drives the spike's movers directly and never sees
   the five the simulation owns, which is how a mirrored heading reached the
   phone: the mantas span as well as turned. This dispatches touches at the
   canvas, lets controls.js turn them into a heading, and reads the instance
   buffer the renderer draws from.

   ONE lab step per read, and no sim.step() of my own: lab.step(1/60) feeds
   the accumulator exactly one tick, and a tick moves along the heading it has
   just turned to. Stepping the sim as well measured the chord across two
   ticks against the heading at the end of them, so a hard turn read as half
   its own turn rate (1.67 degrees at 3.5 rad/s) whatever the code did. */
const head = await p.evaluate(async () => {
  const L = window.__lab, S = window.__sim, m = L.mantas;
  const cv = document.querySelector('canvas'), r = cv.getBoundingClientRect();
  const touch = (type, fx, fy) => cv.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', bubbles: true, isPrimary: true,
    clientX: r.left + fx * r.width, clientY: r.top + fy * r.height }));

  /* 1. A finger circling the middle of the screen, so the leader is turning
        every single step and never runs straight.

     A REAL TRAIN FIRST, built by the game's own recruiting with the radius
     widened for the pre-roll only: follower slots are parked outside the
     arena when nobody is in them, and a parked slot is not a manta whose
     nose can be checked. Stepped without rendering, which the measurement
     loop below cannot do. */
  /* CLEAR OF EVERY RIVAL FIRST. Stage 3 made a touch a crash: a run that
     happened to meet a rival here lost its train to a scatter and swam on
     dazed, which ignores steering — so this measured a daze, not a mirror.
     The rivals are parked far apart and well inside the reef. */
  /* 3E: parked 700+ out, the rivals were outside a 2000 reef, and the
     pre-roll's widened radius let them grow long trains that swam into
     yours. Now they are taken out of the water for the measurement, as the
     room keeps its unused manta out: dead, with no train. */
  S.rivals.forEach((t, i) => { t.x = 700 + i * 350; t.z = 900; t.followers.length = 0;
    t.aim.t = 1e9; t.aim.x = t.x; t.aim.z = t.z - 300; t.dead = 1e9; });
  S.you.followers.length = 0;
  S.you.x = 0; S.you.z = 0; S.you.head = 0; S.you.dazed = 0; S.you.stunned = 0;
  S.seedTrail(S.you);
  L.params.P.recruitR = 600; S.params.recruitR = 600;
  for (let k = 0; k < 900 && S.you.followers.length < 4; k++) S.step();
  L.params.P.recruitR = 40; S.params.recruitR = 40;
  S.you.dazed = 0; S.you.stunned = 0;
  touch('pointerdown', 0.5, 0.2);
  /* One step BEFORE the first reading, because the pre-roll above moved the
     simulation without drawing: the instance buffer still holds where these
     five were in the camera test, and differencing against that measures a
     teleport rather than a swim. */
  L.step(1 / 60);
  const prev = [];
  for (let i = 0; i < 5; i++) prev.push([m.aPos.getX(i), m.aPos.getZ(i)]);
  let worst = 0, worstLead = 0, samples = 0, turned = 0;
  for (let k = 0; k < 240; k++) {
    const a = k / 24;
    touch('pointermove', 0.5 + 0.35 * Math.cos(a), 0.5 + 0.35 * Math.sin(a));
    const before = S.you.head;
    L.step(1 / 60);
    turned += Math.abs(Math.atan2(Math.sin(S.you.head - before), Math.cos(S.you.head - before)));
    for (let i = 0; i < 5; i++) {
      const x = m.aPos.getX(i), z = m.aPos.getZ(i), h = m.aHead.getX(i);
      const dx = x - prev[i][0], dz = z - prev[i][1];
      prev[i] = [x, z];
      const moved = Math.hypot(dx, dz);
      if (moved < 0.5) continue;        // a follower whose trail point has not moved on
      /* The lab's convention: at heading 0 the nose points -Z. */
      const cos = ((-Math.sin(h)) * dx + (-Math.cos(h)) * dz) / moved;
      const off = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (i === 0) worstLead = Math.max(worstLead, off);
      else worst = Math.max(worst, off);
      samples++;
    }
  }

  /* 2. TOWARDS the finger, not away from it. Mirrored, the steering turned
        the wrong way on one axis, which is the other half of the same bug. */
  touch('pointerup', 0.5, 0.5);
  /* Clear of a crash here too: part 1 can meet the reef or a rival, and a
     dazed or stunned leader ignores steering and swims slow, which reads as
     a steering failure when it is nothing of the kind. */
  S.you.head = 0; S.you.x = 0; S.you.z = 0; S.you.trail.length = 0;
  S.you.dazed = 0; S.you.stunned = 0;
  /* WHICH WAY, not how far. The page turns the touch into a world point with
     its own view and its own leader position; recomputing that here measured
     my arithmetic as much as the game's, and a mirrored steer is a question
     of SIGN. The finger goes up the screen and to the right, so the nose has
     to end up pointing up the screen and to the right. */
  const FX = 0.86, FY = 0.28;
  const x0 = S.you.x, z0 = S.you.z;
  touch('pointerdown', FX, FY);
  for (let k = 0; k < 55; k++) L.step(1 / 60);
  const nose = { x: -Math.sin(S.you.head), z: -Math.cos(S.you.head) };
  const went = { x: S.you.x - x0, z: S.you.z - z0 };
  return { worst: +worst.toFixed(2), worstLead: +worstLead.toFixed(2), samples, turned: +(turned * 180 / Math.PI).toFixed(0),
           hurt: +(S.you.dazed + S.you.stunned).toFixed(2), dead: +(+S.you.dead || 0).toFixed(2),
           noseX: +nose.x.toFixed(2), noseZ: +nose.z.toFixed(2),
           wentX: +went.x.toFixed(0), wentZ: +went.z.toFixed(0) };
}).catch(e => ({ error: e.message }));
if (head.error) { ok('your train is drawn headfirst', false, head.error); }
else {
  ok('your LEADER is drawn exactly headfirst', head.worstLead < 0.5,
     'worst ' + head.worstLead + ' degrees off, ' + head.turned + ' degrees of turning');
  /* A FOLLOWER IS NOT EXACT, AND CANNOT BE. It sits at a fixed arc length
     back along a path recorded every 1.5 units and interpolated linearly
     between the two samples that bracket it, so its drawn heading tracks the
     arc while its step-to-step travel follows the chord. The gap between
     them is bounded by one step of turning, which at 3.1 rad/s and 1/60 is
     2.96 degrees. Anything larger is a real mirror, not sampling. */
  ok('and every follower is within one step of turning of its own course',
     head.worst < 3.3,
     'worst ' + head.worst + ' degrees off over ' + head.samples + ' samples, bar 2.96 + margin');
  /* WHERE IT WENT, not where its nose is at an arbitrary moment. The finger
     is a fixed world point, so a leader that reaches it carries on and turns,
     and its heading then says nothing about whether it steered towards the
     touch. The displacement over the whole run does, and a mirrored steer
     inverts its x. */
  ok('and it swims towards your finger, not away from it',
     head.wentX > 30 && head.wentZ < -30,
     'finger up and to the right; travelled (' + head.wentX + ', ' + head.wentZ +
     '), dazed or stunned ' + head.hurt + ', dead ' + head.dead);
}
ok('no page errors', errs.length===0, JSON.stringify([...new Set(errs)]).slice(0,200));
console.log('\ncam failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
