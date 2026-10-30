/* PLAYS AND FEEDBACK on the lab panel (4C, design doc 10.6).
 *
 * Loaded by panel.js the first time the panel opens, on the lab page and on
 * the feedback page's lab panel (the corner press); never in the portal
 * package. A collapsed section: nothing is asked of the rooms Worker until
 * it is tapped, so opening the panel costs nothing.
 *
 *   the last 7 days of the play counter (UTC days): visits that started a
 *     run, returning visitors, runs, room joins, runs past one minute
 *   the latest 50 feedback messages, once the key is entered: FEEDBACK_KEY,
 *     the secret set in Cloudflare's dashboard, remembered on this phone
 *     under manta:feedbackKey once the Worker has said it is right
 *
 * Every message was typed by a stranger: shown only ever as plain text
 * (textContent), never as markup.
 */
const ROOMS = '/lab/manta/rooms/';
const KEY = 'manta:feedbackKey';
const keyGet = () => { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } };
const keySet = v => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (_) { /* this visit only */ } };

function el (tag, props = {}, text) {
  const e = document.createElement(tag);
  for (const k in props) e[k] = props[k];
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mount (panel) {
  if (!panel || document.getElementById('plays')) return;
  const style = el('style');
  style.textContent = '#plays{margin:0 0 12px;border-bottom:1px solid rgba(120,190,210,.28);padding-bottom:10px}' +
    '#plays button{font:inherit;font-size:14px;font-weight:600;min-height:38px;padding:0 14px;color:#bfeee3;background:rgba(127,227,208,.14);border:0;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(127,227,208,.45);cursor:pointer}' +
    '#plays pre{margin:8px 0;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow-x:auto}' +
    '#plays .say{margin:6px 0;color:#ffe2a8}' +
    '#plays .keyRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}' +
    '#plays input{flex:1 1 140px;min-width:0;font:14px system-ui,sans-serif;color:#eaf4ff;background:rgba(0,0,0,.35);border:1px solid rgba(120,190,210,.5);border-radius:8px;padding:7px 9px}' +
    '#plays .msg{margin:6px 0;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.05);white-space:pre-wrap;word-break:break-word}' +
    '#plays .msg time{display:block;color:#8fa6bb;font-size:12px}';
  document.head.appendChild(style);
  const box = el('section', { id: 'plays' });
  const open = el('button', { type: 'button', id: 'playsOpen' }, 'Plays and feedback');
  const body = el('div', { id: 'playsBody', hidden: true });
  const say = el('p', { className: 'say', id: 'playsSay' });
  const table = el('pre', { id: 'playsTable' });
  const keyRow = el('div', { className: 'keyRow' });
  const keyBox = el('input', { id: 'playsKey', type: 'password', autocomplete: 'off', placeholder: 'feedback key', spellcheck: false });
  const show = el('button', { type: 'button', id: 'playsShow' }, 'Show messages');
  const forget = el('button', { type: 'button', id: 'playsForget' }, 'Forget key');
  const list = el('div', { id: 'playsMessages' });
  keyRow.append(keyBox, show, forget);
  body.append(say, table, keyRow, list);
  box.append(open, body);
  /* Near the top of the panel, before the diagnostic rows: at the bottom of
     the scrolling panel it sat under the lab's bar and could not be tapped. */
  const rows = document.getElementById('rows');
  if (rows && rows.parentNode === panel) panel.insertBefore(box, rows); else panel.appendChild(box);

  let busy = false;
  async function load (typed) {
    if (busy) return; busy = true;
    const key = typed || keyGet();
    say.textContent = 'Asking the rooms server…';
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(ROOMS + 'plays', { method: 'POST', cache: 'no-store', signal: ctl.signal, headers: key ? { 'X-Feedback-Key': key } : {} });
      clearTimeout(t);
      const text = await r.text();
      if (r.status === 503 && /off/.test(text)) { say.textContent = 'Rooms are off, so the plays and the feedback cannot be read just now.'; return; }
      if (r.status === 429) { say.textContent = 'Too many wrong keys from this connection today. Try again tomorrow.'; return; }
      if (!r.ok) { say.textContent = 'The rooms server said ' + r.status + ': ' + text.slice(0, 80); return; }
      const j = JSON.parse(text);
      const pad = (v, n) => String(v).padStart(n);
      table.textContent = 'UTC day       visits  back  runs  joins  >1 min\n' +
        j.days.map(d => d.day + pad(d.v, 9) + pad(d.n, 6) + pad(d.r, 6) + pad(d.j, 7) + pad(d.m, 8)).join('\n');
      list.textContent = '';
      if (j.key === 'ok') {
        keySet(key); keyBox.value = '';
        say.textContent = j.messages.length ? 'The latest ' + j.messages.length + ' messages, newest first.' : 'No messages yet.';
        for (const m of j.messages) {
          const item = el('div', { className: 'msg' });
          item.append(el('time', {}, new Date(m.t).toLocaleString()), el('span', {}, m.text));
          list.appendChild(item);
        }
      } else if (j.key === 'wrong') { if (!typed) keySet(''); say.textContent = 'That key is wrong. The counts are above.'; }
      else if (j.key === 'unset') say.textContent = 'No FEEDBACK_KEY is set in Cloudflare’s dashboard yet, so messages cannot be read.';
      else say.textContent = 'Enter the feedback key to read the messages.';
    } catch (_) {
      say.textContent = 'The rooms server could not be reached just now.';
    } finally { busy = false; }
  }
  open.addEventListener('click', () => { body.hidden = !body.hidden; if (!body.hidden) load(); });
  show.addEventListener('click', () => load(keyBox.value.trim()));
  keyBox.addEventListener('keydown', e => { if (e.key === 'Enter') load(keyBox.value.trim()); });
  forget.addEventListener('click', () => { keySet(''); list.textContent = ''; say.textContent = 'The key is forgotten on this phone.'; });
}
