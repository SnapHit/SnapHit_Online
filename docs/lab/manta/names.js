/* Typed names, cleaned the same way everywhere (moved here from roomcore.js
 * in 4C, unchanged): the room, the phone, the tests and the portal package,
 * which carries this file through labels.js but no room module. No DOM, no
 * three: the Worker bundles it with roomcore.js.
 */
/* TYPED NAMES (3J, design doc 10.6): unfiltered, by Nathan's decision, with
   only technical limits, applied the same on the phone and in the room:
   no control, invisible, private-use or unassigned characters; no
   text-direction marks, overrides or isolates; a zero-width joiner only
   inside an emoji sequence; at most 2 combining marks on a character;
   spaces trimmed (and runs of them made one); then at most NAME_MAX
   characters, an emoji counting as one, and at most NAME_BYTES of UTF-8 so
   the name's own message stays small. Empty means: keep the generated
   name. Shown everywhere as plain text, never as markup. */
export const NAME_MAX = 16, NAME_BYTES = 160;
const PICT = /\p{Extended_Pictographic}/u, MARK = /\p{M}/u, TONE = /[\uFE0F\u{1F3FB}-\u{1F3FF}]/u;
const DROP = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/u;
const graphemes = t => typeof Intl !== 'undefined' && Intl.Segmenter
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t), g => g.segment) : Array.from(t);
export function cleanName (s) {
  if (typeof s !== 'string') return '';
  const cps = Array.from(s.slice(0, 512).normalize('NFC')), out = [];
  let marks = 0;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === '\u200D') {
      let j = out.length - 1; while (j >= 0 && TONE.test(out[j])) j--;
      if (j >= 0 && PICT.test(out[j]) && i + 1 < cps.length && PICT.test(cps[i + 1])) { out.push(c); marks = 0; }
      continue;
    }
    if (DROP.test(c)) continue;
    if (MARK.test(c)) { if (marks < 2) { out.push(c); marks++; } continue; }
    marks = 0; out.push(c);
  }
  let g = graphemes(out.join('').replace(/\s+/gu, ' ').trim());
  if (g.length > NAME_MAX) g = g.slice(0, NAME_MAX);
  const enc = new TextEncoder();
  while (g.length && enc.encode(g.join('')).length > NAME_BYTES) g.pop();
  return g.join('').trim();
}
