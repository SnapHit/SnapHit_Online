/* The portal package for Manta trains (3O): a zip for game portals such as
   Poki and CrazyGames. It COPIES, never builds: every file goes into the zip
   byte for byte, nothing is rewritten, minified or bundled, and docs/ is only
   ever read.

     index.html                the feedback page (docs/lab/manta/play/index.html),
                               which finds itself at a package's root and plays
                               solo against bots, every path relative
     lab/manta/*.js            the lab modules main.js imports, followed import
                               by import (the rooms' own modules, reached only
                               by a dynamic import for a room, are left out)
     vendor/three/r186/...     the vendored Three.js files those import,
                               unmodified, with its LICENSE

   Usage: node tools/manta/package.mjs [output directory]
   The output directory defaults to MANTA_OUT, then a fresh temp directory,
   never the repo. Node built-ins and the system's zip tool only. */
import { readFileSync, mkdirSync, copyFileSync, existsSync, statSync, mkdtempSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const DOCS = join(ROOT, 'docs');
const LAB = 'lab/manta/', VENDOR = 'vendor/three/r186/';
const NAME = readFileSync(join(DOCS, LAB, 'game.js'), 'utf8').match(/export const GAME_NAME = '([^']+)'/)[1];
const BUILD = readFileSync(join(DOCS, LAB, 'panel.js'), 'utf8').match(/export const BUILD = '([^']+)'/)[1];
/* The import map the page writes: bare names to the vendored files. */
const BARE = { 'three': VENDOR + 'three.webgpu.js', 'three/webgpu': VENDOR + 'three.webgpu.js', 'three/tsl': VENDOR + 'three.tsl.js' };
const ADDONS = 'three/addons/';

/* Every file to copy, as a path under docs/, found by following static
   imports from main.js. */
const files = new Set(), todo = [LAB + 'main.js'];
const STATIC = /(?:^|[\s;])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
while (todo.length) {
  const f = todo.pop();
  if (files.has(f)) continue;
  if (!existsSync(join(DOCS, f))) throw new Error('missing ' + f);
  files.add(f);
  const src = readFileSync(join(DOCS, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [, spec] of src.matchAll(STATIC)) {
    let to;
    if (BARE[spec]) to = BARE[spec];
    else if (spec.startsWith(ADDONS)) to = VENDOR + 'addons/' + spec.slice(ADDONS.length);
    else if (spec.startsWith('./') || spec.startsWith('../')) to = posix.normalize(posix.join(posix.dirname(f), spec));
    else throw new Error(f + ' imports ' + spec + ', which the package cannot place');
    todo.push(to);
  }
}
files.add(VENDOR + 'LICENSE');

const out = resolve(process.argv[2] || process.env.MANTA_OUT || mkdtempSync(join(tmpdir(), 'manta-portal-')));
if (!relative(ROOT, out).startsWith('..')) throw new Error('the package never goes inside the repo: ' + out);
const stage = mkdtempSync(join(out, 'stage-'));
copyFileSync(join(DOCS, LAB, 'play/index.html'), join(stage, 'index.html'));
for (const f of files) { mkdirSync(dirname(join(stage, f)), { recursive: true }); copyFileSync(join(DOCS, f), join(stage, f)); }

const slug = NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stamp = BUILD.replace(/ UTC$/, '').replace(/[^0-9]+/g, '-').replace(/-$/, '');
const zip = join(out, slug + '-portal-' + stamp + '.zip');
execFileSync('zip', ['-q', '-X', '-r', zip, '.'], { cwd: stage });
const count = [...files].length + 1, bytes = statSync(zip).size;
const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
console.log(JSON.stringify({ name: NAME, build: BUILD, zip, files: count, bytes, sha256: sum, stage }, null, 1));
