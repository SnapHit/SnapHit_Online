/* 3M: the WebGPU sweep, with stack traces. Static server on 8961. TIER env. */
import { chromium } from '../lib/tools.mjs';
const O = ('http://127.0.0.1:' + process.env.PORT), TIER = process.env.TIER || 'high';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push((e.stack || e.message).split('\n').slice(0, 7).join(' | ').slice(0, 900)));
p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push('console: ' + c.text().slice(0, 300)); });
await p.goto(O + '/lab/manta/?tier=' + TIER + '&seed=20261002&bots=0', { waitUntil: 'load' });
await p.waitForFunction(() => window.__labReady && window.__sim && window.__lab.zoom && window.__lab.zoom() !== null, null, { timeout: 40000 }).catch(() => {});
const backend = await p.evaluate(() => (document.getElementById('chipBackend') || {}).textContent);
const steps = [];
for (const len of [0, 100, 300, 650]) { await p.evaluate(n => window.__sim.lay(n), len); await wait(6000); steps.push(len + ':' + (await p.evaluate(() => [window.__lab.zoom().toFixed(2), window.__lab.lm ? window.__lab.lm.resteps : -1].join('/'))) + ' errs ' + errs.length); }
await p.evaluate(() => { const S = window.__sim; S.cutAt(S.you, 149, null); }); await wait(5000);
steps.push('cut:' + (await p.evaluate(() => [window.__sim.you.followers.length, window.__lab.zoom().toFixed(2), window.__lab.lm ? window.__lab.lm.resteps : -1].join('/'))) + ' errs ' + errs.length);
console.log('[' + TIER + '] backend ' + backend + ' | ' + steps.join(' | '));
console.log((errs.length ? '  FAIL  ' : '  PASS  ') + '[' + TIER + '] WebGPU sweep 0 -> 650 -> cut to 150: zero errors  [' + errs.length + ' errors]');
for (const e of errs.slice(0, 3)) console.log('   ERR ' + e);
await b.close(); clearTimeout(die); process.exit(errs.length ? 1 : 0);
