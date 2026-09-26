/* The tuning drawer.
 *
 * A slider for every number that decides what the ocean looks like, so the
 * look can be judged on the phone it has to run on instead of through a round
 * trip of commit, deploy, reload, squint.
 *
 * SESSION ONLY, and deliberately. Nothing here is written to localStorage or
 * anywhere else, so a reload is always exactly the committed look and no
 * number Nathan drags on a train can quietly become the default. When he
 * likes a set, Copy values gives him the plain text and a later brief types it
 * into params.js, where it goes through the usual verify-then-commit.
 *
 * It lives at the top of the button bar, so it appears and disappears with the
 * rest of the expanded panel, and it starts collapsed: the thing being judged
 * is the train, and a wall of sliders over it judges nothing.
 */
import { SPEC, P, setParam, resetParams, paramText, decimals } from './params.js';
import { rollSummary } from './roll.js';

const el = {
  toggle: document.getElementById('drawerToggle'),
  body:   document.getElementById('drawerBody'),
  list:   document.getElementById('drawerList'),
  copy:   document.getElementById('copyValues'),
  reset:  document.getElementById('resetValues'),
  reroll: document.getElementById('rerollColour'),
  plain:  document.getElementById('plain'),
};

/* Enough decimals to show the step and no more. A range input hands back
   0.6000000000000001 for a 0.05 step, which is unreadable on a phone and
   worse than useless when the point is to write the number down. */
const show = (s, v) => s.key === 'scheme' ? ('ABC'[Math.round(v)] || 'A')   // the touch scheme is a letter
                                          : v.toFixed(decimals(s.step));

const rows = [];

function syncAll () {
  for (const r of rows) {
    r.input.value = P[r.s.key];
    r.val.textContent = show(r.s, P[r.s.key]);
  }
}

/* Confirmation has to be visible on a phone with no console, and it has to go
   back by itself so the button does not lie about what it does next. */
function flash (btn, said, back, ms) {
  btn.textContent = said;
  setTimeout(() => { btn.textContent = back; }, ms);
}

export function createDrawer () {
  for (const s of SPEC) {
    const row = document.createElement('label');
    row.className = 'srow';

    const head = document.createElement('span');
    head.className = 'shead';

    const name = document.createElement('span');
    name.className = 'sname';
    name.textContent = s.label;

    const val = document.createElement('span');
    val.className = 'sval';
    val.textContent = show(s, P[s.key]);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = s.step;
    input.value = P[s.key];
    /* The visible label is the row's own text, so the range needs a name of
       its own for anything reading the page rather than looking at it. */
    input.setAttribute('aria-label', s.label);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!isFinite(v)) return;
      setParam(s.key, v);
      val.textContent = show(s, v);
    });

    head.append(name, val);
    row.append(head, input);
    el.list.appendChild(row);
    rows.push({ s, input, val });
  }

  el.toggle.addEventListener('click', () => {
    const open = el.toggle.getAttribute('aria-expanded') === 'true';
    el.toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    el.body.hidden = open;
    el.toggle.textContent = open ? 'Tuning' : 'Tuning  \u00d7';
    /* The bar's other buttons and the diagnostics panel stand down while
       tuning, so the sliders sit in the space they were using instead of on
       top of the ocean — and so the panel is not showing through them. */
    document.body.classList.toggle('tuning', !open);
  });

  /* A new colour without a reload, so Nathan can flick through the palette on
     the phone. It deals a fresh seed, so the rivals and the wild mantas are
     re-dealt with it and your colour still cannot appear on anyone else. */
  el.reroll.addEventListener('click', () => {
    const got = window.__lab && window.__lab.reroll ? window.__lab.reroll() : null;
    flash(el.reroll, got ? got : 'Reroll', 'Reroll', 1400);
  });

  el.reset.addEventListener('click', () => {
    resetParams();
    syncAll();
    flash(el.reset, 'Reset', 'Reset', 1200);
  });

  /* Same shape as Copy report: the clipboard where it exists, and otherwise
     the text on screen and selected, so a long press offers Copy. iOS refuses
     the clipboard outside a few narrow cases and a silent failure here would
     lose a tuning session. */
  /* The roll is not a slider, but it decides what Nathan is looking at, so a
     set of values copied off the phone is no use without it. */
  /* The deal, from roll.js: the same line the panel shows, so the two cannot
     disagree, and never one entry per slot. */
  function rollLine () {
    const L = window.__lab;
    const r = L && L.mantas ? rollSummary(L.mantas, window.__sim || null) : null;
    if (!r) return '';
    const M = L.mantas;
    return '\nyour colour: ' + r.head + '\n' + r.rivals + '\n' + r.wild +
      '\nmantas: ' + M.drawn + ' drawn  \u00b7  capacity ' + M.capacity + '  \u00b7  1 instanced mesh';
  }

  el.copy.addEventListener('click', async () => {
    const text = paramText() + rollLine();
    try {
      if (!navigator.clipboard) throw new Error('no clipboard API');
      await navigator.clipboard.writeText(text);
      flash(el.copy, 'Copied', 'Copy values', 1600);
    } catch (e) {
      el.plain.value = text;
      el.plain.className = 'on';
      el.plain.focus(); el.plain.select();
      el.plain.setSelectionRange(0, text.length);
      flash(el.copy, 'Select and copy', 'Copy values', 2600);
    }
  });

  return { sync: syncAll, rows: rows.length };
}
