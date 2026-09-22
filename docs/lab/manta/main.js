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
import { createMantas, COUNT, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE, WILD_SLOTS, PARKED } from './mantas.js';
import { createSim, zoomFor, STEP } from './sim.js';
import { createControls } from './controls.js';
import { createPost } from './post.js';
import { createCut, flashAllowed, setCutClock } from './cut.js';
import { createQuality, TIER_SETTINGS } from './tiers.js';
import { setSceneTime } from './clock.js';
import { watchConsole, watchDevice, onIssue, issueText, counts } from './watch.js';
import { createDrawer } from './drawer.js';
import { createStamper } from './stamp.js';
import { createFollow } from './follow.js';

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
/* THE LIGHT MEMORY HAS A FIXED NUMBER OF SLOTS, AND FEW OF THEM. Its fade
   and all its stamps are ONE full-screen pass, so the shader carries an
   unrolled expression per slot: at 18 slots that compiled everywhere, and at
   610 SwiftShader's GLSL compiler answers "ERROR: Expression too complex" and
   the page draws nothing on WebGL2. Measured on this build before the cap.

   Which is also the right answer for the look. 7.2 gives the bright trailing
   light to trains, and says a wild manta "stirs only the plankton's own faint
   blue-green" — the plankton shader's job, not the wake's. So the wake is
   stamped by your train and the rivals: your leader, a spread of your
   followers along the length of the train, and the nine scripted rivals. */
const STAMP_SLOTS = 24;
const BURST_SLOT = STAMP_SLOTS;
const lm = FX ? createLightMemory(STAMP_SLOTS + 1) : null;
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
const lmSlow = FX ? createLightMemory(STAMP_SLOTS + 1) : null;
if (lmSlow) { lmSlow.setFade(0.9994); useLongMemory(lmSlow); }
let slowAttached = false;

/* ?scene=spike puts the still spike scene back, for judging the look against
   what Nathan signed off: its scripted figure eight and its four wild singles
   still run there, and nowhere else. Everything below is the moving world. */
const SPIKE = new URLSearchParams(location.search).get('scene') === 'spike';

const { scene, camera, fit, view, setZoom, lookAtWorld } = createScene();
const mantas = createMantas(scene, { scripted: SPIKE });
if (shadows) shadows.attach(mantas.shadowMesh);
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

/* The post chain and whether the light memory is attached: the render
   hooks below own these too. */
let lmAttached = false;
let post = null;

/* The frame clock the scene reads, and the fixed-step accumulator. Both
   belong to the loop below; they only sat next to the stamping code. */
let simTime = 0;

/* Stamping the wake lives in stamp.js. */
const stamper = createStamper({ mantas, COUNT, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE,
                                STAMP_SLOTS, BURST_SLOT, P,
                                get lm () { return lm; }, get lmSlow () { return lmSlow; },
                                get sim () { return sim; } });
const stampMantas = dt => stamper.stampMantas(dt);

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

/* The camera and every instance live in follow.js. */
const follower = createFollow({ mantas, TRAIN_MAX, RIVAL_BASE, RIVAL_LEN, WILD_BASE, WILD_SLOTS,
                                PARKED, camera, zoomFor, setZoom, applyView, uCam, cut,
                                get view () { return view; }, get sim () { return sim; },
                                get lm () { return lm; }, get lmSlow () { return lmSlow; },
                                get shadows () { return shadows; } });
const followCamera = dt => follower.followCamera(dt);

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
      sim.params.recruitR = P.recruitR; sim.params.spacing = P.spacing;
      sim.params.burstCost = P.burstCost; sim.params.scatterGlow = P.scatterGlow;
      sim.params.daze = P.daze; sim.params.stun = P.stun;
      sim.step();
      simAcc -= STEP;
    }
  }
  simTime += dt * scale;
  setSceneTime(simTime);
  /* The loose mantas wrap inside a box that travels with the player, so
     the world is never empty behind you. Set before the script runs, not
     after, or the box is a frame behind the camera it belongs to. */
  if (sim) mantas.setCentre(sim.you.x, sim.you.z);
  mantas.update(simTime);
  /* AFTER the spike's script, not before. mantas.update() writes every
     instance from the figure eight, so putting your leader in first meant
     the script painted straight over it: the camera sat on the simulation's
     leader while the train on screen was the old scripted one, a few hundred
     units away. The three rival trains still come from the script; the five
     that are yours come from the simulation, and they have to be written
     last. */
  if (sim) followCamera(dt * scale);
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
      stamper.forgetPrevious();
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
