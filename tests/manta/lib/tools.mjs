// The tools the harnesses need, resolved from the scratch install named by
// MANTA_TOOLS (see README.md), so nothing is ever installed into the repo.
import { createRequire } from 'node:module';
const dir = process.env.MANTA_TOOLS;
if (!dir) { console.error('MANTA_TOOLS is not set: see tests/manta/README.md'); process.exit(9); }
const require = createRequire(dir.replace(/\/?$/, '/'));
export const { chromium } = require('playwright');
export const { PNG } = require('pngjs');
