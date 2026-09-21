/* The diagnostics panel.
 *
 * It owns every number on screen and nothing else: no Three.js, no renderer,
 * no scene. Callers push values in with set(); the panel decides how they are
 * shown, how they are copied out, and what the chip says when it is collapsed.
 *
 * Collapsed by default, because the look spike is judged by eye and the
 * default view has to be almost all ocean. The chip carries the two things
 * worth knowing at a glance, the backend and the frame rate.
 */

/* Bumped by hand every time this page is edited, so a stale deploy is obvious
   from the phone rather than something you have to take on trust. */
export const BUILD = '2026-09-22 09:15 UTC';

const params = new URLSearchParams(location.search);
export const FORCE_WEBGL = params.get('backend') === 'webgl2';

const ROWS = [
  ['load',           'load'],
  ['fallback',       'forced'],
  ['navigator.gpu',  'gpu'],
  ['adapter',        'adapter'],
  ['gpu',            'gpuinfo'],
  ['three',          'three'],
  ['viewport',       'viewport'],
  ['view',           'view'],
  ['mantas',         'mantas'],
  ['draw calls',     'draws'],
  ['light memory',   'lm'],
  ['render passes',  'passes'],
  ['first frame',    'ttff'],
  ['timing (ms)',    'timing'],
  ['vendor bytes',   'bytes'],
  ['three.webgpu.js','fwebgpu'],
  ['three.core.js',  'fcore'],
  ['three.tsl.js',   'ftsl'],
  ['refresh',        'refresh'],
  ['fps (5s)',       'fps'],
  ['worst 1%',       'worst'],
  ['build',          'build'],
  ['agent',          'ua'],
];
const BLOCK = { timing: true };        // multi-line, monospace, own scroller

const el = {
  chip:     document.getElementById('chip'),
  chipName: document.getElementById('chipBackend'),
  chipFps:  document.getElementById('chipFps'),
  panel:    document.getElementById('panel'),
  bar:      document.getElementById('bar'),
  backend:  document.getElementById('backend'),
  sub:      document.getElementById('sub'),
  rows:     document.getElementById('rows'),
  err:      document.getElementById('err'),
  plain:    document.getElementById('plain'),
  cut:      document.getElementById('cut'),
  reduce:   document.getElementById('reduceFlash'),
};

/* Wired from main.js once the cut exists. */
export function wireCut (cut) {
  el.cut.addEventListener('click', () => {
    const fired = cut.trigger();
    el.cut.textContent = fired ? 'Cut!' : 'still running…';
    setTimeout(() => { el.cut.textContent = 'Cut the train'; }, 900);
  });
  /* Reflects the system setting on load, and can be turned on independently
     of it, but never silently off: if the OS asks for reduced motion the
     switch starts on. */
  el.reduce.checked = cut.reduced;
  cut.setUserReduced(el.reduce.checked);
  el.reduce.addEventListener('change', () => cut.setUserReduced(el.reduce.checked));
}

const cell = {};
for (const [label, key] of ROWS) {
  const dt = document.createElement('dt'); dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = BLOCK[key] ? 'block' : 'num';
  dd.textContent = '—';
  el.rows.append(dt, dd);
  cell[key] = dd;
}
export const set = (k, v) => { if (cell[k]) cell[k].textContent = v; };

/* ------------------------------------------------------------ collapse */

function expanded () { return el.chip.getAttribute('aria-expanded') === 'true'; }
function toggle (on) {
  el.panel.hidden = !on;
  el.bar.hidden = !on;
  el.chip.setAttribute('aria-expanded', on ? 'true' : 'false');
}
el.chip.addEventListener('click', () => toggle(!expanded()));

/* ------------------------------------------------------ what it is running */

export function announce (name, cls, sub) {
  el.backend.dataset.name = name;
  el.backend.textContent = name;
  el.backend.className = cls;
  el.sub.textContent = sub;
  el.chipName.textContent = name;
  el.chip.className = cls;
}

/* ------------------------------------------------------ frame accounting */

/* Refresh sampling. The question it answers is whether 60.0 fps is the panel's
   ceiling or an adaptive display idling at 60: if the display ran at 120 the
   budget would be 8.3 ms rather than 16.7 ms. Sampling starts a couple of
   seconds after the first frame so start-up hitches are outside the window,
   runs for two seconds, and takes the median rather than the mean so one
   dropped frame cannot move it.
   
   What it measures is the requestAnimationFrame cadence while this scene is
   drawing, which equals the display rate only while there is headroom. The row
   says so, because a number that needs a caveat has to carry it. */
const SAMPLE_WARMUP = 2000, SAMPLE_FOR = 2000;
let sampleStart = null, sampleDts = [], sampleDone = false;
let frames = [], lastAt = null, firstFrameAt = null;

export function resetFrames () {
  frames = []; lastAt = null; firstFrameAt = null;
  sampleStart = null; sampleDts = []; sampleDone = false;
  set('refresh', 'sampling…');
}

function finishSample () {
  sampleDone = true;
  if (sampleDts.length < 8) { set('refresh', 'too few frames to measure'); return; }
  const sorted = sampleDts.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  set('refresh', median.toFixed(2) + ' ms median  ·  ' +
      (median > 0 ? (1000 / median).toFixed(0) : '?') + ' Hz' +
      '  (rAF while drawing, ' + sampleDts.length + ' frames)');
}

export function accountFrame (now) {
  if (lastAt !== null) {
    const dt = now - lastAt;
    frames.push({ t: now, dt });
    if (!sampleDone && firstFrameAt > 0) {
      if (sampleStart === null) { if (now - firstFrameAt >= SAMPLE_WARMUP) sampleStart = now; }
      else {
        sampleDts.push(dt);
        /* Both conditions, not either: a slow device keeps sampling until it
           has enough intervals for a median rather than reporting nothing. */
        if (now - sampleStart >= SAMPLE_FOR && sampleDts.length >= 8) finishSample();
      }
    }
  }
  lastAt = now;
  const cut = now - 5000;
  while (frames.length && frames[0].t < cut) frames.shift();
  if (frames.length > 1) {
    const span = frames[frames.length - 1].t - frames[0].t;
    const fps = span > 0 ? ((frames.length - 1) * 1000 / span) : 0;
    /* The 99th percentile, not the single worst frame. One 500 ms hitch while
       a shader compiles says nothing about how it runs; the worst 1% is what
       you actually feel. */
    const sorted = frames.map(f => f.dt).sort((a, b) => a - b);
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    set('fps', fps.toFixed(1) + ' avg over ' + (span / 1000).toFixed(1) + 's');
    set('worst', p99.toFixed(1) + ' ms  (99th pct of ' + sorted.length + ' frames)');
    el.chipFps.textContent = fps.toFixed(0) + ' fps';
  }
}

export function markFirstFrame () {
  firstFrameAt = performance.now();
  performance.mark('manta:first-frame');
  set('ttff', firstFrameAt.toFixed(0) + ' ms from navigation start');
  accountBytes();
  accountTiming();
}

/* --------------------------------------------------------- what it cost */

/* Resource Timing, filtered to the vendored library. transferSize is what came
   down the wire including headers; decodedBodySize is what the parser paid
   for. The gap between them is the whole question about r186 shipping
   unminified, so both are reported, per file and in total.
   
   A cache hit is NOT transferSize === 0. On the Pixel 9 warm load Chrome
   reported a few hundred bytes a file, an earlier test read that as a network
   fetch, and the panel said "1 KB over the wire" as though the library were
   free. deliveryType settles it where the browser has it; otherwise a transfer
   that is a rounding error beside the decoded size is a cache hit. */
const VENDOR_FILES = [
  ['three.webgpu.js', 'fwebgpu'],
  ['three.core.js',   'fcore'],
  ['three.tsl.js',    'ftsl'],
];

function cameFromCache (e) {
  if (e.deliveryType === 'cache') return true;
  const t = e.transferSize || 0, d = e.decodedBodySize || 0;
  if (d === 0) return false;
  return t === 0 || t < Math.min(2048, d * 0.02);
}

/* One rounding rule for every figure, and the total is the sum of the rounded
   parts rather than the rounding of the sum. Otherwise three files reading
   0 KB each add up to a summary of 1 KB, which is true and reads like a
   mistake. */
const kbNum = v => Math.round(v / 1024);
const kb = v => kbNum(v) + ' KB';

export function accountBytes () {
  const found = {};
  for (const e of performance.getEntriesByType('resource')) {
    if (e.name.indexOf('/vendor/three/') === -1) continue;
    for (const [name, key] of VENDOR_FILES) if (e.name.indexOf('/' + name) !== -1) found[key] = e;
  }
  let wireKb = 0, decodedKb = 0, n = 0, cached = 0;
  for (const [name, key] of VENDOR_FILES) {
    const e = found[key];
    if (!e) { set(key, 'not reported'); continue; }
    n++;
    const t = e.transferSize || 0, d = e.decodedBodySize || 0, c = cameFromCache(e);
    wireKb += kbNum(t); decodedKb += kbNum(d); if (c) cached++;
    set(key, kb(t) + ' wire  ·  ' + kb(d) + ' decoded  ·  ' + (c ? 'from cache' : 'network'));
  }
  set('bytes', n === 0 ? 'not reported'
    : wireKb + ' KB over the wire, ' + decodedKb + ' KB decoded, ' + n +
      ' file' + (n === 1 ? '' : 's') +
      (cached === 0 ? '  —  cold' : '  —  from cache, ' + cached + ' of ' + n));
  const stamp = params.get('cold');
  set('load', (n === 0 ? 'unknown' : cached === 0 ? 'cold' : cached === n ? 'warm' : 'mixed') +
      (stamp ? '  —  cache-busting stamp ?cold=' + stamp : '  —  plain URL, no stamp'));
}

/* -------------------------------------------------------------- timing */

/* Four moments from navigation start, so network and backend stop being one
   figure. Brief 0 measured 2,464 ms cold and 832 ms warm on the phone, but the
   cold run was WebGPU and the warm run was WebGL2, so the gap could have been
   the download or the backend starting up and there was no way to tell them
   apart. These split it. */
export function accountTiming () {
  const rows = [];
  const paint = performance.getEntriesByType('paint');
  if (paint.length) rows.push(['first paint', Math.min.apply(null, paint.map(e => e.startTime))]);

  let modulesEnd = 0;
  for (const e of performance.getEntriesByType('resource'))
    if (e.name.indexOf('/vendor/three/') !== -1 && e.responseEnd > modulesEnd) modulesEnd = e.responseEnd;
  if (modulesEnd > 0) {
    try { performance.measure('manta:modules', { start: 0, end: modulesEnd }); } catch (e) {}
    rows.push(['modules', modulesEnd]);
  }

  for (const [mark, label] of [
    ['manta:init-start',  'init start'],    ['manta:init-end',  'init end'],
    ['manta:init2-start', 'rebuild start'], ['manta:init2-end', 'rebuild end'],
  ]) {
    const m = performance.getEntriesByName(mark, 'mark');
    if (m.length) rows.push([label, m[m.length - 1].startTime]);
  }
  try { performance.measure('manta:init', 'manta:init-start', 'manta:init-end'); } catch (e) {}
  try { performance.measure('manta:rebuild', 'manta:init2-start', 'manta:init2-end'); } catch (e) {}

  if (firstFrameAt > 0) {
    try { performance.measure('manta:to-first-frame', { start: 0, end: firstFrameAt }); } catch (e) {}
    rows.push(['first frame', firstFrameAt]);
  }

  rows.sort((a, b) => a[1] - b[1]);
  let prev = null;
  const lines = rows.map(([label, t]) => {
    const d = prev === null ? '' : '+' + Math.round(t - prev);
    prev = t;
    return (label + '              ').slice(0, 14) + String(Math.round(t)).padStart(6) + d.padStart(8);
  });
  set('timing', lines.length ? lines.join('\n') : 'not reported');
}

/* ------------------------------------------------------- fixed rows */

/* Orientation is taken from the viewport, not from screen.orientation.type.
   The API answers for the device and can disagree with the window: in a
   headless 412x915 it reported landscape-primary. The API value is still
   shown, labelled, because on a phone it says which way up as well. */
export function describeViewport () {
  const shape = innerWidth > innerHeight ? 'landscape' : 'portrait';
  const api = (screen.orientation && screen.orientation.type) || null;
  return innerWidth + '×' + innerHeight + ' css  ·  dpr ' +
         (Math.round(devicePixelRatio * 100) / 100) + '  ·  ' + shape +
         (api && api !== shape ? '  (screen.orientation: ' + api + ')' : '');
}

export function initRows (revision) {
  set('build', BUILD);
  set('ua', navigator.userAgent);
  set('three', 'r' + revision);
  set('forced', FORCE_WEBGL ? 'forced — ?backend=webgl2' : 'automatic if WebGPU fails');
  set('viewport', describeViewport());
  set('refresh', 'sampling…');
}

/* Asked directly rather than read off the renderer: r186's WebGPUBackend does
   not keep the adapter, and this also answers the question on a device where
   the renderer fell back and never held one. */
export async function probeAdapter () {
  if (!navigator.gpu) { set('gpu', 'absent'); set('adapter', 'n/a — no navigator.gpu'); return; }
  set('gpu', 'present');
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { set('adapter', 'requestAdapter() returned null'); return; }
    set('adapter', 'obtained');
    const i = adapter.info || {};
    const bits = [i.vendor, i.architecture, i.device, i.description].filter(Boolean);
    if (bits.length) set('gpuinfo', bits.join(' · '));
  } catch (e) {
    set('adapter', 'requestAdapter() threw: ' + (e && e.message ? e.message : e));
  }
}
export const gpuInfoKnown = () => cell.gpuinfo.textContent !== '—';

/* --------------------------------------------------------------- report */

function report () {
  const lines = ['Manta lab — ' + el.backend.textContent, el.sub.textContent, ''];
  for (const [label, key] of ROWS) {
    const v = cell[key].textContent;
    /* The timing block is several lines. Indent them rather than flattening
       them, so the pasted report still lines up. */
    if (v.indexOf('\n') === -1) { lines.push(label + ': ' + v); continue; }
    lines.push(label + ':');
    for (const l of v.split('\n')) lines.push('  ' + l);
  }
  if (el.err.className.indexOf('on') === 0) lines.push('', 'notes:', el.err.textContent);
  lines.push('', 'url: ' + location.href);
  return lines.join('\n');
}

document.getElementById('swap').addEventListener('click', () => {
  const u = new URL(location.href);
  if (FORCE_WEBGL) u.searchParams.delete('backend');
  else u.searchParams.set('backend', 'webgl2');
  location.replace(u.toString());
});

/* Cold puts a fresh stamp on the three library URLs, so the browser has to go
   to the network for them and the timing includes the download. Warm is a
   plain reload of whatever is in the address bar, which is a true warm
   measurement precisely because those exact URLs were just fetched. */
document.getElementById('cold').addEventListener('click', () => {
  const u = new URL(location.href);
  u.searchParams.set('cold', Date.now().toString(36));
  location.replace(u.toString());
});
document.getElementById('warm').addEventListener('click', () => { location.reload(); });

document.getElementById('copy').addEventListener('click', async () => {
  const btn = document.getElementById('copy');
  const text = report();
  try {
    if (!navigator.clipboard) throw new Error('no clipboard API');
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy report'; }, 1600);
  } catch (e) {
    /* Put it on screen and select it instead, so a long press offers Copy. */
    el.plain.value = text;
    el.plain.className = 'on';
    el.plain.focus(); el.plain.select();
    el.plain.setSelectionRange(0, text.length);
    btn.textContent = 'Select and copy';
    setTimeout(() => { btn.textContent = 'Copy report'; }, 2600);
  }
});
el.plain.addEventListener('blur', () => { el.plain.className = ''; });
