/* Manta trains: the look spike. Entry point, and the only place the parts are
 * wired to each other.
 *
 *   params.js       the tunable numbers, and their defaults
 *   panel.js        every number on screen, and the chip it collapses to
 *   scene.js        the scene, and the camera's fixed view area
 *   ocean.js        the ocean layers and the plankton, one shader
 *   lightmemory.js  the fading texture every moving thing stamps into
 *   mantas.js       one instanced mesh, ten mantas, wings flexed in TSL
 *   post.js         bloom and the final grade, through a RenderPipeline
 *   cut.js          the cut set piece: shockwave, burst, scatter, slow motion
 *   renderer.js     the backend, the automatic WebGL2 fallback and the loop
 *
 * Imported by relative path from the same folder. No build step, no bundler,
 * nothing added to the import map.
 */
import { REVISION } from 'three';
import * as panel from './panel.js';
import { P, U } from './params.js';
import { createScene, describeView } from './scene.js';
import { useLightMemory, useLongMemory, useSeabed, useCaustics, useShadows, uCam, uCausticLayers, uViewW, uViewH, uShockC, uShockR, uShockA, uRippleOn } from './ocean.js';
import { createLightMemory } from './lightmemory.js';
import { createSeabed } from './seabed.js';
import { createCaustics } from './caustics.js';
import { createShadows } from './shadow.js';
import { createLab } from './renderer.js';
import { createMantas, COUNT } from './mantas.js';
import { createSim, zoomFor, STEP } from './sim.js';
import { createControls } from './controls.js';
import { createPost } from './post.js';
import { createCut, flashAllowed, setCutClock } from './cut.js';
import { createQuality, TIER_SETTINGS } from './tiers.js';
import { setSceneTime } from './clock.js';
import { watchConsole, watchDevice, onIssue, issueText, counts } from './watch.js';
import { createDrawer } from './drawer.js';

const query = new URLSearchParams(location.search);
/* ?fx=off builds the page without the light memory, the plankton or anything
   that reads them, so the cost of the look can be measured against the bare
   scene on a real phone rather than guessed at. */
export const FX = query.get('fx') !== 'off';
const TONE = query.get('tone') || 'neutral';
/* ?tier=high|medium|low pins the tier so each one can be looked at and
   measured on demand instead of waiting for a device slow enough to pick it. */
const FORCED_TIER = query.get('tier');
/* ?vig=0 turns the vignette off, which is the only way to measure what it is
   actually doing: comparing the centre of the screen with its corners also
   measures the ocean's own gradient and whatever the bloom is doing to the
   wake near the middle. */
const VIG = query.has('vig') ? Number(query.get('vig')) : null;

/* Before anything else builds: a complaint during init is the one most worth
   catching, and console.error is where three makes most of them. */
watchConsole();
onIssue(() => {
  panel.set('issues', issueText());
  if (counts().errors > 0 && window.__labMark) window.__labMark();
});
panel.set('issues', issueText());

panel.initRows(REVISION);
panel.probeAdapter();

/* Before the scene: the ocean shader is built once, and whether it carries a
   plankton term at all depends on whether there is a light memory to read. */
/* One slot past the mantas, reserved for the cut's burst. */
const BURST_SLOT = COUNT;
const lm = FX ? createLightMemory(COUNT + 1) : null;
if (lm) useLightMemory(lm);
/* The seabed, generated once into a texture on the first draw: the renderer
   has to exist before anything can be rendered into a target. */
const seabed = FX ? createSeabed() : null;
if (seabed) useSeabed(seabed);
const caustics = FX ? createCaustics() : null;
if (caustics) useCaustics(caustics);
/* The shadow target is made before the ocean's shader is built, because the
   shader reads it; the mesh that draws into it is attached once the mantas
   exist a few lines below. */
const shadows = FX ? createShadows() : null;
if (shadows) useShadows(shadows);
/* The long memory: the same machinery at a quarter of the resolution and a
   fade measured in tens of seconds. 0.9994 a frame at 60 is a half life of
   about nineteen seconds. Stamped by the same calls, rendered only when the
   slider asks for it. */
const lmSlow = FX ? createLightMemory(COUNT + 1) : null;
if (lmSlow) { lmSlow.setFade(0.9994); useLongMemory(lmSlow); }
let slowAttached = false;

const { scene, camera, fit, view, setZoom, lookAtWorld } = createScene();
const mantas = createMantas(scene);
if (shadows) shadows.attach(mantas.shadowMesh);

/* ?scene=spike puts the still spike scene back, for judging the look against
   what Nathan signed off. Everything below is the moving world. */
const SPIKE = new URLSearchParams(location.search).get('scene') === 'spike';
const sim = SPIKE ? null : createSim({ seed: (Math.random() * 0xffffffff) >>> 0 });
let controls = null;
/* A fixed 60 steps a second whatever the display does, with an accumulator,
   so the rules behave the same on a 120 Hz phone and in a headless browser
   at two frames a second — and so a test in Node sees the same steps. */
let simAcc = 0;
window.__sim = sim;
panel.set('mantas', String(mantas.count) + ' in 1 instanced mesh');
/* WebGPU guarantees eight vertex buffers per pipeline and three allocates one
   per attribute. Over the limit the device refuses the pipeline in silence:
   nothing throws, nothing is logged, the mesh simply is not drawn. */
panel.set('vbuf', mantas.vertexBuffers + ' of 8 that WebGPU guarantees' +
                  (shadows ? '  \u00b7  same on the shadow pass' : '') +
                  (mantas.vertexBuffers > 8 ? '  \u00b7  OVER THE LIMIT' : ''));
panel.set('lm', lm ? (lm.size + '×' + lm.size + '  ·  ' + lm.note) : 'off (?fx=off)');

window.__lab = { scene, camera, view, mantas, lm, FX };

/* After __lab exists, not before: this is the same ordering trap that put a
   ReferenceError on the page in 1F. */
function showRoll () {
  const c = mantas.colours;
  panel.set('roll', c ? (c.mine.key + '  \u00b7  seed ' + mantas.seed +
    '  \u00b7  rivals ' + c.rivals.map(r => r.key).join(', ') +
    '  \u00b7  wild ' + c.wilds.map(r => r.key).join(', ')) : 'not rolled');
}
showRoll();
window.__lab.reroll = () => { mantas.reroll(); showRoll(); return mantas.colours.mine.key; };
window.__lab.post = () => post;
const quality = createQuality({ forcedTier: FORCED_TIER, dpr: devicePixelRatio });
window.__lab = window.__lab || {};
const cut = createCut({ mantas, lm, burstSlot: BURST_SLOT });
window.__lab.cut = cut;
window.__lab.shadows = shadows;
/* A test can stand the set piece still: the short parts of it are over
   before a headless browser has drawn a frame (see cut.js). The page itself
   never calls this, so the phone still runs on the real clock. */
window.__lab.cutClock = setCutClock;
panel.wireCut(cut);

/* The tuning drawer. Built once, here, after the params registry exists and
   before the first frame, so a slider is live the moment the bar is open. */
const drawer = createDrawer();
window.__lab.drawer = drawer;

/* Debug handles. This is a lab page and a browser test has to be able to see
   the shockwave's real uniforms and the scene's own clock, not infer them. */
window.__lab.shock = () => ({ x: uShockC.value.x, z: uShockC.value.y, r: uShockR.value, a: uShockA.value });
/* The live tunables, so a test can prove a slider reaches the uniform the
   shader actually samples rather than infer it from a picture. */
window.__lab.params = { P, U };
window.__lab.simTime = () => simTime;
window.__lab.flashAllowed = flashAllowed;
window.__lab.quality = quality;
/* Applying a decision the test made by hand, so the controller's policy and
   its effects can be exercised without a device slow enough to trigger it. */
window.__lab.applyQuality = () => applyQuality(lab.renderer);
/* lab is assigned below, once createLab has run. */

/* ------------------------------------------------------ stamping the wake */

/* Where each manta was last frame, so it can be stamped along the segment it
   swept rather than at a point. A fast manta must paint a line. */
const prevX = new Float32Array(COUNT), prevZ = new Float32Array(COUNT);
let havePrev = false;
let burstCleared = false;
let lmAttached = false;
let simTime = 0;
let post = null;

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

function stampMantas (dt) {
  if (!lm) return;
  if (!burstCleared) { lm.stamp(BURST_SLOT, 0, 0, 0, 0, 1, 0, 0, 0, 0); burstCleared = true; }
  const { aPos, aSize, aTint } = mantas;
  for (let i = 0; i < COUNT; i++) {
    const x = aPos.getX(i), z = aPos.getZ(i);
    const x0 = havePrev ? prevX[i] : x, z0 = havePrev ? prevZ[i] : z;
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
    lm.stamp(i,
      jumped ? x : x0, jumped ? z : z0, x, z,
      aSize.getX(i) * 1.2,                       // about 1.2 wingspans
      wr, wg, wb, wild ? s * 0.35 : s);
    if (lmSlow && P.longMemory > 0) lmSlow.stamp(i,
      jumped ? x : x0, jumped ? z : z0, x, z,
      aSize.getX(i) * 1.2,
      aTint.getX(i), aTint.getY(i), aTint.getZ(i), s);
    prevX[i] = x; prevZ[i] = z;
  }
  havePrev = true;
}

/* ---------------------------------------------------------------- the lab */

/* One place where a tier or a rung becomes something on screen. Nothing here
   touches the scene: the same ten mantas swim the same paths at every tier. */
function applyQuality (renderer) {
  /* Multisampling is a high-tier luxury: the tiers exist to give things up. */
  if (post) post.setAntialiasAllowed(quality.tier === 'high');
  uCausticLayers.value = quality.tier === 'high' ? 2 : 1;
  const t = TIER_SETTINGS[quality.tier];
  lab.setPixelRatio(quality.scale);
  U.grain.value = t.grain ? P.grain : 0;
  uRippleOn.value = t.ripple ? 1 : 0;
  if (post) post.setBloomResolution(t.bloomRes);
  if (lm) lm.setSize(renderer, t.lm);
  panel.set('tier', quality.tier + (quality.locked ? '  ·  forced with ?tier=' : '  ·  automatic'));
  panel.set('scale', quality.scale.toFixed(2) + '×  (rung ' + quality.rung + ' of ' + 4 + ')');
  if (lm) panel.set('lm', lm.size + '×' + lm.size + '  ·  ' + lm.note);
}

/* THE WHOLE WORLD MOVES FROM ONE VECTOR. uCam is what every layer of the
   ocean is drawn from, the light memory re-centres on it in whole texels so
   a wake stays over the water it was laid on, the shadow target follows it,
   and the camera itself sits over it. Five things that could disagree, told
   once. */
/* Everything that has to be told the view changed, in one place, because a
   zoom change is a view change and a resize is a view change and they used
   to be told in different ways. */
function applyView (v) {
  mantas.setBounds(v);
  uViewW.value = v.w; uViewH.value = v.h;
  if (lm) lm.setView(v);
  if (shadows) shadows.setView(v);
  if (lmSlow) lmSlow.setView(v);
  panel.set('view', describeView(v));
  panel.set('viewport', panel.describeViewport());
}

function followCamera () {
  const you = sim.you;
  const z = zoomFor(you.followers.length, sim.params);
  if (setZoom(z)) applyView(view);
  uCam.value.set(you.x, you.z);
  camera.position.set(you.x, 1000, you.z);
  camera.lookAt(you.x, 0, you.z);
  camera.up.set(0, 0, -1);
  camera.updateMatrixWorld();
  if (lm) lm.setCentre(you.x, you.z);
  if (lmSlow) lmSlow.setCentre(you.x, you.z);
  if (shadows) shadows.setCentre(you.x, you.z);
  /* Your leader is the sim's, not the spike's script. The other four of the
     spike's train trail it along its recorded path until stage 2 fills them
     with real recruits. */
  const m = mantas, sp = sim.params.spacing;
  m.aPos.setXYZ(0, you.x, 0, you.z); m.aHead.setX(0, you.head);
  for (let i = 1; i < 5; i++) {
    const want = you.s - i * sp;
    let pt = you.trail[0] || you;
    for (let q = you.trail.length - 1; q >= 0; q--) if (you.trail[q].s <= want) { pt = you.trail[q]; break; }
    m.aPos.setXYZ(i, pt.x, 0, pt.z); m.aHead.setX(i, pt.h !== undefined ? pt.h : you.head);
  }
  m.aPos.needsUpdate = true; m.aHead.needsUpdate = true;
}

/* Hoisted out of the hooks so the step hook below can drive it. The cut owns
   the clock while it is running: its own timeline advances in REAL time — a
   250 ms beat of slow motion is 250 ms of the player's life — while the scene
   advances in scaled time, so everything in the water slows together. That
   scaled total is the one clock every shader reads; see clock.js. */
function advance (now, dt) {
  const scale = cut.update(dt);
  if (sim) {
    /* Steps of exactly 1/60, capped so a long pause does not fast-forward
       the whole world when the tab comes back. */
    simAcc = Math.min(simAcc + dt * scale, 0.5);
    while (simAcc >= STEP) {
      if (controls) controls.apply(sim.you, STEP);
      sim.params.cruise = P.cruise; sim.params.burst = P.burstSpeed;
      sim.params.turnCruise = P.turnCruise; sim.params.turnBurst = P.turnBurst;
      sim.step();
      simAcc -= STEP;
    }
  }
  simTime += dt * scale;
  setSceneTime(simTime);
  mantas.update(simTime);
  /* AFTER the spike's script, not before. mantas.update() writes every
     instance from the figure eight, so putting your leader in first meant
     the script painted straight over it: the camera sat on the simulation's
     leader while the train on screen was the old scripted one, a few hundred
     units away. The three rival trains still come from the script; the five
     that are yours come from the simulation, and they have to be written
     last. */
  if (sim) followCamera();
  /* Scaled too: the stamp is a deposit per unit of distance travelled, so a
     slowed manta must not lay down a brighter trail. */
  stampMantas(dt * scale);
}

const lab = createLab({
  scene,
  camera,
  forceWebGL: panel.FORCE_WEBGL,
  hooks: {
    onFit (w, h) { applyView(fit(w, h)); },
    onBackend ({ webgpu, forced, fellBack, glString }) {
      panel.announce(
        webgpu ? 'WebGPU' : 'WebGL2',
        webgpu ? '' : 'webgl2',
        forced   ? 'fallback forced with ?backend=webgl2'
        : webgpu ? 'WebGPU was available and is in use'
        : fellBack ? 'WebGPU started and then could not draw, so this rebuilt itself on WebGL2 — the error is below'
        : 'WebGPU was not available, so Three.js fell back to WebGL2 during init'
      );
      if (glString && !panel.gpuInfoKnown()) panel.set('gpuinfo', glString);
    },
    /* The mantas are driven from the CPU: scripted paths in, instanced
       attributes out, once a frame before anything is drawn. */
    onUpdate: advance,
    onBeforeRender (renderer, dt) {
      if (!lm) return;
      /* Probed once, on the first frame, before anything has been drawn into
         the targets: changing the texture type afterwards would be too late. */
      if (!lmAttached) { lm.attach(renderer); lmAttached = true;
        panel.set('lm', lm.size + '×' + lm.size + '  ·  ' + lm.note); }
      if (caustics && !caustics.baked) caustics.bake(renderer);
      if (seabed && !seabed.baked) {
        seabed.bake(renderer);
        panel.set('seabed', seabed.size + '×' + seabed.size + '  ·  ' + seabed.ms.toFixed(1) +
                            ' ms to generate  ·  ' + seabed.tile + ' units a tile' +
                            (caustics ? '  ·  caustics ' + caustics.size + '²' : ''));
      }
      /* Before the frame is drawn, so the ocean samples this frame's shadows
         and not the last one's. */
      if (shadows) shadows.render(renderer);
      lm.setFade(P.fade);
      lm.render(renderer, dt);
      if (lmSlow && P.longMemory > 0) {
        if (!slowAttached) { lmSlow.attach(renderer); lmSlow.setSize(renderer, 256); slowAttached = true; }
        lmSlow.render(renderer, dt);
      }
    },
    onDraw (renderer, sc, cam) {
      /* The pipeline needs the renderer, which only exists once the backend
         is up, so it is built on the first draw and rebuilt after a fallback.
         Note that renderer.render() is NOT called when there is a pipeline:
         the scene render happens inside the pass. */
      if (FX && post === null) {
        post = createPost({ renderer, scene: sc, camera: cam, tone: TONE });
        if (VIG !== null && isFinite(VIG)) post.setVignette(VIG);
        applyQuality(renderer);
        panel.set('passes', String(post.passes) + ' passes  ·  tone ' + TONE);
      }
      if (post) post.render(); else renderer.render(sc, cam);
    },
    onRebuild (renderer) {
      /* The renderer that owned these has gone. Probe the new backend and let
         the targets reallocate against it. */
      lmAttached = false;
      slowAttached = false;
      havePrev = false;
      /* The pipeline, its pass target and the bloom mips all belong to the
         renderer that just died. */
      if (post) { post.dispose(); post = null; }
    },
    onFrame (now, renderer, rawMs) {
      panel.accountFrame(now);
      panel.set('draws', String(renderer.info.render.drawCalls));
      if (quality.feed(rawMs, now)) applyQuality(renderer);
    },
    onFirstFrame () {
      panel.markFirstFrame();
      /* Something has been drawn, so from here an uncaught error is a mark
         and not a verdict. */
      window.__labDrew = true;
      panel.set('watch', watchDevice(lab.renderer));
    },
    onReset () { panel.resetFrames(); },
    onNote (what, e) { window.__labNote(what, e); if (window.__labMark) window.__labMark(); },
    onError (what, e) { window.__labError(what, e); },
  },
});

window.__lab.lab = lab;
window.__lab.pause = () => lab.pause();
window.__lab.resume = () => lab.resume();
window.__lab.renderer = () => lab.renderer;
/* Freeze and step. With the loop paused, this advances the scene by an exact
   number of seconds and draws exactly one frame, so a test can compare two
   renders that differ ONLY by what it changed. Every shader reads the scene
   clock, so nothing moves unless this moves it. */
window.__lab.step = (seconds = 1 / 60) => {
  const r = lab.renderer;
  if (!r) return null;
  advance(performance.now(), seconds);
  if (lm) { lm.setFade(P.fade); lm.render(r, seconds); }
  if (post) post.render(); else r.render(scene, camera);
  return simTime;
};

lab.start().then(ok => {
  if (!ok) { window.__labReady = true; return; }
  if (sim) {
    const canvas = lab.renderer && lab.renderer.domElement;
    if (canvas) controls = createControls(canvas, sim.input, (u, v) => ({
      /* Screen fraction to world, through the same view the ocean uses. */
      x: sim.you.x + (u - 0.5) * view.w,
      z: sim.you.z + (v - 0.5) * view.h,
    }));
  }
  window.__labReady = true;
});

/* A hidden tab is not played. The loop already stops on blur; this also
   stops the simulation, so coming back does not fast-forward the world. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { simAcc = 0; lab.pause(); } else lab.resume();
});
