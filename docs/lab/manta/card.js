/* THE DEATH CARD (4D, design doc 10.8): what the run was, after the crash.
 *
 *   what got you    "You ran into coral fox", "Head on with bot 7",
 *                   "You hit the reef", "The whale shark got you"
 *   the run's peak  counting up from 0 over COUNT_FOR seconds of the beat
 *   New best!       when the peak beats the best you had when the run began,
 *                   once the count reaches it: big, gold, a pop
 *   your best       "best N", or "was N" under a new best
 *   three facts     time alive, cuts landed, your best rank in the run
 *   the prompt      "Tap to swim again" once the beat is over
 *
 * Interface, not light: DOM over the canvas inside #beat, which never takes
 * a touch itself. Reduced flash and motion: no pop and no glow pulse, every
 * word kept.
 *
 * HOLD (the feedback page and the portal package: opts.hold). After the
 * beat your train waits, dead, for a tap (sim.js t.holdDeath, t.go; in a
 * room the hello's h:1 and a {t:'go'} message). A tap during the beat skips
 * it: the count finishes, the prompt shows and, solo, the simulation's beat
 * ends at once. One more starts the next run, as in slither. A tap is a
 * pointer press anywhere, or Space or Enter (not a held key's repeats), and
 * none counts in the first IGNORE_MS of the crash, so a steering touch at
 * the moment of the crash does not skip. Without hold (the lab page) the
 * card shows the same and the next run starts by itself after the beat, as
 * it always has.
 */
export const COUNT_FOR = 0.8;          // seconds of the beat the peak takes to count up
const IGNORE_MS = 350;
const HOWS = { reef: 'reef', shark: 'shark', 'head-on': 'head-on', leader: 'leader', body: 'body' };

/* "1:05" from seconds. */
export function clock (s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* What got you, in plain words; '' when the room has not said. */
export function causeText (how, name) {
  if (how === 'reef') return 'You hit the reef';
  if (how === 'shark') return 'The whale shark got you';
  if (!name) return '';
  if (how === 'head-on') return 'Head on with ' + name;
  if (how === 'leader' || how === 'body') return 'You ran into ' + name;
  return '';
}

export function createCard ({ hold = false, touch = false, now = () => performance.now() } = {}) {
  const host = document.getElementById('beat');
  if (!host) return null;
  host.textContent = '';
  const make = (cls, tag = 'div', parent = panel) => { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e; };
  const panel = document.createElement('div'); panel.className = 'panel'; host.appendChild(panel);
  const cause = make('cause'), num = make('num'), label = make('peakLabel'), nb = make('nb'), best = make('best');
  label.textContent = 'peak length';
  nb.textContent = 'New best!';
  const facts = make('facts');
  const fact = name => { const d = make('fact', 'div', facts), v = make('v', 'b', d), l = make('l', 'span', d); l.textContent = name; return v; };
  const fAlive = fact('alive'), fCuts = fact('cuts'), fRank = fact('best rank');
  const next = make('next');
  next.textContent = touch ? 'Tap to swim again' : 'Click or press Space to swim again';

  /* The run, as it goes: started when your leader is in the water. */
  let alive = 0, cuts = 0, rank = 0, bestAtStart = null, wasLive = false;
  /* The beat, from the crash. */
  let shown = false, t = 0, from = 0, to = 0, newBest = false, popped = false, skipped = false, crashAt = 0, went = false;
  let onSkip = null, onGo = null;

  function run (live, dt, bestNow) {
    if (live && !wasLive) { alive = 0; cuts = 0; rank = 0; bestAtStart = bestNow; }
    wasLive = live;
    if (live) alive += Math.max(0, dt);
  }
  function show (peak, bestNow, how, name, reduced) {
    shown = true; t = 0; from = 0; to = Math.max(0, peak | 0); skipped = false; went = false; popped = false; crashAt = now();
    newBest = to > 0 && bestAtStart !== null && to > bestAtStart;
    host.className = 'on' + (reduced ? ' calm' : '') + (hold ? ' holds' : '');
    num.textContent = '0';
    const text = causeText(HOWS[how] || how, name);
    cause.textContent = text; cause.hidden = !text;
    best.textContent = newBest ? (bestAtStart > 0 ? 'was ' + bestAtStart : 'your first best') : 'best ' + bestNow;
    fAlive.textContent = clock(alive);
    fCuts.textContent = String(cuts);
    fRank.textContent = rank > 0 ? '#' + rank : '-';
  }
  function hide () { shown = false; host.className = ''; }
  function frame (dt, beatFor) {
    if (!shown) return;
    t += Math.max(0, dt);
    const k = skipped ? 1 : Math.min(1, t / COUNT_FOR), n = Math.round(from + (to - from) * k);
    if (String(n) !== num.textContent) num.textContent = String(n);
    if (k >= 1 && newBest && !popped) { popped = true; host.classList.add('newbest'); }
    if (hold && (skipped || t >= beatFor) && !host.classList.contains('ready')) host.classList.add('ready');
  }
  /* A tap: the first during the beat skips it, the next (or the first after
     it) starts the next run. */
  function tap () {
    if (!shown || !hold || went) return false;
    if (now() - crashAt < IGNORE_MS) return false;
    if (!host.classList.contains('ready')) { skipped = true; frame(0, Infinity); host.classList.add('ready'); if (onSkip) onSkip(); return true; }
    went = true; if (onGo) onGo(); return true;
  }
  if (hold) {
    /* Not a press on the page's own controls (Privacy, your name's pencil). */
    const own = e => !!(e.target && e.target.closest && e.target.closest('button, a, input, textarea, label, #fbBox, #meEdit, #namePanel'));
    addEventListener('pointerdown', e => { if (!own(e)) tap(); }, true);
    addEventListener('keydown', e => { if (e.repeat || own(e) || !(e.code === 'Space' || e.key === 'Enter' || e.key === ' ')) return; if (tap()) e.preventDefault(); }, true);
  }
  return {
    run, show, hide, frame, tap,
    /* A cut you landed, and where you stand on the board now. */
    cut () { cuts++; },
    rankNow (r) { if (r > 0 && (rank === 0 || r < rank)) rank = r; },
    set onSkip (f) { onSkip = f; }, set onGo (f) { onGo = f; },
    get shown () { return shown; }, get hold () { return hold; },
    /* For the tests: the card as read. */
    get state () { return { shown, t, from, to, newBest, skipped, went, ready: host.classList.contains('ready'), cuts, rank, alive, bestAtStart,
      text: { cause: cause.hidden ? '' : cause.textContent, num: num.textContent, best: best.textContent, alive: fAlive.textContent, cuts: fCuts.textContent, rank: fRank.textContent, next: next.textContent } }; },
  };
}
