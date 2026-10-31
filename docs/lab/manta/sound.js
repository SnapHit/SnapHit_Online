/* SOUND (4D, design doc 10.8; NOTES.md, Sound). Everything synthesised with
 * Web Audio: oscillators, generated noise and filters. No files, no fetch,
 * no request of any kind.
 *
 *   recruit   a bell chime, a step up a major pentatonic for every three
 *             followers, so a growing train climbs (to two and a half
 *             octaves up, then holds)
 *   burst     a whoosh: noise through a band sweeping up
 *   cut       a boom (a falling sine written as a fundamental plus its
 *             second and third harmonics, so a phone speaker that cannot
 *             move air at 50 Hz still implies it) and a high shimmer
 *   crash     a crunch: noise through a falling lowpass, and a thud
 *   pink      a sparkle, a quiet rising run when the pink manta appears
 *             and a brighter one when it is caught
 *   bed       the ocean: brown noise through a low filter, swelling slowly,
 *             very quiet
 *
 * ON BY DEFAULT, SILENT UNTIL THE FIRST TAP: a browser will not start audio
 * before a gesture, so the AudioContext is made on the first pointer press
 * or key, which makes that the real switch. The pill (bottom left, above
 * the score line) reads SOUND ON or SOUND OFF and breathes until it has
 * been used once, then settles to a quiet icon, as on the site; it is kept
 * under manta:sound ('on' or 'off'), in try/catch, and the game plays on
 * without it when storage is blocked. In the portal package it stays: a
 * sound switch, not a fullscreen button.
 *
 * CHEAP: at most VOICES sounds at once (a new one past that is dropped,
 * your own cut or crash first taking the oldest's place), a throttle per
 * kind, one shared noise buffer, and a compressor set as a limiter on the
 * mix. The context is suspended while the page is hidden.
 *
 * The voices are plain functions of (context, destination, start time),
 * exported, so a test renders each one offline (OfflineAudioContext) and
 * measures its peak and loudness.
 */
export const SOUND_KEY = 'manta:sound';
const VOICES = 10;
const PENTA = [0, 2, 4, 7, 9];
const THROTTLE = { recruit: 0.05, burst: 0.15, cut: 0.06, crash: 0.08, pink: 0.2 };
/* Each voice's level, set from offline renders (tests/manta/browser/sound.mjs). */
export const LEVEL = { recruit: 0.34, burst: 1.3, cut: 0.40, crash: 0.70, pinkAppear: 0.075, pinkCatch: 0.09, bed: 0.022 };

/* Noise, made once per context: white for the whoosh and crunch, brown for the bed. */
const noiseOf = new WeakMap();
function noise (ac, brown = false) {
  let n = noiseOf.get(ac);
  if (!n) {
    const len = Math.floor(ac.sampleRate * 4), w = ac.createBuffer(1, len, ac.sampleRate), b = ac.createBuffer(1, len, ac.sampleRate);
    const wd = w.getChannelData(0), bd = b.getChannelData(0);
    let seed = 0x9e3779b9, last = 0;
    for (let i = 0; i < len; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const r = ((seed >>> 0) / 4294967296) * 2 - 1;
      wd[i] = r;
      last = (last + 0.02 * r) / 1.02; bd[i] = last * 3.5;
    }
    /* The bed loops: its ends are faded into each other over 50 ms. */
    const f = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; bd[len - f + i] = bd[len - f + i] * (1 - k) + bd[i] * k; }
    n = { w, b }; noiseOf.set(ac, n);
  }
  return brown ? n.b : n.w;
}
function env (g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function osc (ac, type, f0, f1, t, dur, out, peak, attack, decay) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, peak, attack, decay);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + attack + decay + 0.02);
  return o;
}
function noiseVoice (ac, out, t, filter, f0, f1, q, sweep, peak, attack, decay) {
  const s = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise(ac); s.loop = true;
  bq.type = filter; bq.Q.value = q; bq.frequency.setValueAtTime(f0, t); bq.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  env(g, t, peak, attack, decay);
  s.connect(bq); bq.connect(g); g.connect(out);
  s.start(t, Math.random() * 3); s.stop(t + attack + decay + 0.02);
  return s;
}

/* THE VOICES: each returns its last node and its length in seconds. */
export const voice = {
  recruit (ac, out, t, len = 1) {
    const deg = Math.min(12, Math.floor(Math.max(0, len - 1) / 3));
    const semis = 12 * Math.floor(deg / 5) + PENTA[deg % 5];
    const f = 523.25 * Math.pow(2, semis / 12), g = LEVEL.recruit;
    osc(ac, 'sine', f, f, t, 0.3, out, g, 0.004, 0.32);
    osc(ac, 'sine', f * 2.01, f * 2.01, t, 0.2, out, g * 0.35, 0.003, 0.18);
    const last = osc(ac, 'triangle', f * 3, f * 3, t, 0.08, out, g * 0.12, 0.002, 0.07);
    return { last, dur: 0.33 };
  },
  burst (ac, out, t) {
    const last = noiseVoice(ac, out, t, 'bandpass', 380, 2400, 1.4, 0.32, LEVEL.burst, 0.05, 0.4);
    return { last, dur: 0.46 };
  },
  cut (ac, out, t, mine = true) {
    const k = mine ? 1 : 0.4, g = LEVEL.cut * k;
    /* The boom: 150 falling to 48, with its second and third harmonics. */
    osc(ac, 'sine', 150, 48, t, 0.38, out, g, 0.005, 0.55);
    osc(ac, 'sine', 300, 96, t, 0.38, out, g * 0.55, 0.005, 0.4);
    osc(ac, 'sine', 450, 144, t, 0.38, out, g * 0.3, 0.005, 0.3);
    noiseVoice(ac, out, t, 'bandpass', 1100, 500, 1.1, 0.12, g * 0.5, 0.002, 0.14);
    /* The shimmer: six high partials, staggered, ringing out. */
    let last = null;
    const parts = [2093, 2637, 3136, 3520, 4186, 5274];
    for (let i = 0; i < parts.length; i++) last = osc(ac, 'sine', parts[i] * (1 + (i % 2 ? 0.004 : -0.003)), parts[i], t + 0.03 + i * 0.022, 0.6, out, g * 0.07, 0.006, 0.55 + i * 0.05);
    return { last, dur: 0.95 };
  },
  crash (ac, out, t, mine = true) {
    const k = mine ? 1 : 0.4, g = LEVEL.crash * k;
    noiseVoice(ac, out, t, 'lowpass', 3200, 260, 0.9, 0.42, g, 0.003, 0.5);
    osc(ac, 'sine', 110, 42, t, 0.3, out, g * 0.7, 0.004, 0.36);
    const last = osc(ac, 'sine', 220, 84, t, 0.3, out, g * 0.35, 0.004, 0.26);
    return { last, dur: 0.56 };
  },
  pinkAppear (ac, out, t) {
    let last = null; const run = [0, 2, 4, 7, 9];
    for (let i = 0; i < run.length; i++) last = osc(ac, 'sine', 1318.5 * Math.pow(2, run[i] / 12), 1318.5 * Math.pow(2, run[i] / 12), t + i * 0.07, 0.2, out, LEVEL.pinkAppear, 0.005, 0.22);
    return { last, dur: 0.6 };
  },
  pinkCatch (ac, out, t) {
    let last = null; const run = [0, 4, 7, 12, 16, 19, 24];
    for (let i = 0; i < run.length; i++) {
      const f = 1046.5 * Math.pow(2, run[i] / 12);
      osc(ac, 'sine', f, f, t + i * 0.045, 0.25, out, LEVEL.pinkCatch, 0.004, 0.26);
      last = osc(ac, 'triangle', f * 2, f * 2, t + i * 0.045, 0.1, out, LEVEL.pinkCatch * 0.15, 0.003, 0.1);
    }
    return { last, dur: 0.66 };
  },
  /* The bed, for `dur` seconds (offline), or until stopped (live). */
  bed (ac, out, t, dur = 0) {
    const s = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), depth = ac.createGain(), fl = ac.createGain();
    s.buffer = noise(ac, true); s.loop = true;
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    g.gain.value = LEVEL.bed;
    lfo.frequency.value = 0.09; depth.gain.value = LEVEL.bed * 0.3; fl.gain.value = 90;
    lfo.connect(depth); depth.connect(g.gain); lfo.connect(fl); fl.connect(lp.frequency);
    s.connect(lp); lp.connect(g); g.connect(out);
    s.start(t); lfo.start(t);
    if (dur > 0) { s.stop(t + dur); lfo.stop(t + dur); }
    return { last: s, dur, stop: when => { try { s.stop(when); lfo.stop(when); } catch (_) { /* stopped */ } }, gain: g };
  },
};

/* The mix: a bus into a compressor set as a limiter, into the speakers. */
export function makeMix (ac) {
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.18;
  const bus = ac.createGain(); bus.gain.value = 0.9;
  bus.connect(lim); lim.connect(ac.destination);
  return { bus, lim };
}

function readPref () { try { return localStorage.getItem(SOUND_KEY); } catch (_) { return null; } }
function writePref (on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (_) { /* this visit only */ } }

export function createSound ({ pill = true, now = () => performance.now() } = {}) {
  const stored = readPref();
  let on = stored !== 'off', touched = stored !== null;
  let ac = null, mix = null, bed = null, live = 0, cost = 0, calls = 0, dropped = 0;
  const last = {}, playing = [];
  const counts = { recruit: 0, burst: 0, cut: 0, crash: 0, pinkAppear: 0, pinkCatch: 0 };

  function boot () {
    if (ac) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try { ac = new AC(); mix = makeMix(ac); return true; } catch (_) { ac = null; return false; }
  }
  function startBed () { if (!ac || bed || !on) return; bed = voice.bed(ac, mix.bus, ac.currentTime + 0.05); bed.gain.gain.setValueAtTime(0, ac.currentTime); bed.gain.gain.linearRampToValueAtTime(LEVEL.bed, ac.currentTime + 2); }
  function stopBed () { if (bed && ac) { bed.stop(ac.currentTime + 0.05); bed = null; } }
  /* The first press or key: the context starts (on), and from then on the pill is the switch. */
  function wake () {
    if (!on) return;
    if (!boot()) return;
    if (ac.state === 'suspended' && !hidden()) ac.resume().catch(() => {});
    startBed();
  }
  const hidden = () => typeof document !== 'undefined' && document.hidden;

  function play (kind, fn, mine = true) {
    const t0 = now();
    calls++;
    try {
      if (!on || !ac || ac.state !== 'running') return false;
      const t = ac.currentTime, th = THROTTLE[kind.startsWith('pink') ? 'pink' : kind] || 0.05;
      if (last[kind] !== undefined && t - last[kind] < th) return false;
      for (let i = playing.length - 1; i >= 0; i--) if (playing[i].end <= t) playing.splice(i, 1);
      if (playing.length >= VOICES) {
        if (!mine) { dropped++; return false; }
        const old = playing.shift(); try { old.out.disconnect(); } catch (_) { /* gone */ }
      }
      last[kind] = t;
      const out = ac.createGain(); out.connect(mix.bus);
      const v = fn(out, t + 0.005);
      playing.push({ end: t + v.dur + 0.05, out });
      counts[kind] = (counts[kind] || 0) + 1;
      return true;
    } finally { cost += now() - t0; }
  }

  const api = {
    get on () { return on; }, get touched () { return touched; }, get context () { return ac; },
    get voices () { return playing.length; }, get dropped () { return dropped; }, get counts () { return { ...counts }; },
    /* JS milliseconds spent here, and calls, for the frame-cost test. */
    get cost () { return { ms: cost, calls }; },
    wake,
    toggle () {
      on = !on; touched = true; writePref(on);
      if (on) { if (boot()) { if (ac.state === 'suspended' && !hidden()) ac.resume().catch(() => {}); startBed(); } }
      else { stopBed(); if (ac) ac.suspend().catch(() => {}); }
      draw();
      return on;
    },
    recruit (len) { return play('recruit', (o, t) => voice.recruit(ac, o, t, len)); },
    burst () { return play('burst', (o, t) => voice.burst(ac, o, t)); },
    cut (mine) { return play('cut', (o, t) => voice.cut(ac, o, t, mine), mine); },
    crash (mine) { return play('crash', (o, t) => voice.crash(ac, o, t, mine), mine); },
    pink (what) { return what === 'catch' ? play('pinkCatch', (o, t) => voice.pinkCatch(ac, o, t)) : play('pinkAppear', (o, t) => voice.pinkAppear(ac, o, t), false); },
  };

  /* THE PILL. */
  let el = null;
  function draw () {
    if (!el) return;
    el.className = (on ? 'on' : 'off') + (touched ? ' shy' : '');
    el.setAttribute('aria-pressed', String(on));
    el.querySelector('.t').textContent = on ? 'SOUND ON' : 'SOUND OFF';
    el.title = on ? 'Sound on: tap to turn it off' : 'Sound off: tap to turn it on';
  }
  if (pill && typeof document !== 'undefined') {
    el = document.createElement('button');
    el.id = 'sound'; el.type = 'button';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>' +
      '<path class="w1" d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path class="w2" d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path class="x" d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="t"></span>';
    el.addEventListener('click', e => { e.stopPropagation(); api.toggle(); });
    /* Pressing the pill is not steering, and not the death card's tap. */
    el.addEventListener('pointerdown', e => { e.stopPropagation(); });
    document.body.appendChild(el);
    draw();
  }
  if (typeof addEventListener === 'function') {
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
  }
  /* Hidden, silent: the context is suspended, and resumed when shown if on. */
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {});
    else if (on) ac.resume().catch(() => {});
  });
  return api;
}
