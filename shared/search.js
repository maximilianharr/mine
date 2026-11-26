// Search over one app's folder of the local mirror, as you type. Every file is already on the
// device, so this reads IndexedDB and never the network, and works offline.
//
// It knows nothing about any one app. The app says which folder is its own, which frontmatter
// keys hold the title and the date, which further keys are worth searching, and what opening a
// result means:
//
//   openSearch({ folder: 'calendar/', title: 'title', date: 'start',
//                fields: ['group', 'participants'], open: path => ... })
//
// A key left out falls back: the title to the first `# heading`, then the file name; the date to
// a YYYY-MM-DD in the path. When an app names its `title` key, a file without that key is not a
// document - which is how a folder's own settings files stay out of the results.
//
// The body is matched as text, not as markdown: emphasis, heading marks, list and checkbox
// markers and backticks are dropped, and a link matches on its words rather than its URL.
import { allFiles } from './store.js';
import { parse } from './md.js';
import { loadPrefs, formatDate } from './prefs.js';
import { $, el, iconBtn, openCentred, closePops } from './ui.js';

const CAP = 50;

// ---- matching ------------------------------------------------------------------------------

export function plain(md) {
  return String(md)
    .replace(/```[^\n]*\n?/g, '')                         // fence lines; the code itself stays
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')            // a link or an image: its words
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '')
    .replace(/[*~`]+/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')   // not the _ in snake_case
    .replace(/[ \t]+/g, ' ');
}

// Case and accents folded away, one character at a time so a position in the folded text is a
// position in the original - which is what lets a snippet mark the words it matched.
const fold1 = c => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const fold = s => [...String(s)].map(fold1).join('');

const words = q => fold(q).split(/\s+/).filter(Boolean);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A word matches where a word in the text begins with it: `dent` finds "dentist".
const wordRe = w => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}`, 'u');

const fileName = path => path.split('/').pop().replace(/\.md$/, '');
const pathDate = path => (path.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
const asText = v => Array.isArray(v) ? v.map(String).join(' ') : v == null ? '' : String(v);

// A bare date stays itself; an instant is read on this device's clock.
function dayOf(v) {
  const s = String(v ?? '');
  if (!s.includes('T')) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  const d = new Date(s);
  if (isNaN(d)) return s.slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Each file as what search reads of it. Pure, so the unit checks run it in node.
export function index(files, { folder, title, date, fields = [] }) {
  const out = [];
  for (const f of files) {
    if (!f.path.startsWith(folder) || !f.path.endsWith('.md') || f.text == null) continue;
    const { data, body } = parse(f.text);
    if (data.conflictOf) continue;
    if (title && (data[title] == null || data[title] === '')) continue;
    const head = (body.match(/^#{1,6}[ \t]+(.+)$/m) || [])[1];
    const t = title ? String(data[title]) : (head ? plain(head).trim() : fileName(f.path));
    const text = plain(body);
    out.push({
      path: f.path, title: t, date: date ? dayOf(data[date]) : pathDate(f.path), text,
      fTitle: fold(t), fBody: fold([text, ...fields.map(k => asText(data[k]))].join('\n'))
    });
  }
  return out;
}

// Every word somewhere; a document whose title holds them all first; then the nearest date,
// what is coming before what has been, and an undated document last.
export function find(docs, query, today) {
  const ws = words(query);
  if (!ws.length) return [];
  const res = ws.map(wordRe);
  const hits = [];
  for (const d of docs) {
    if (!res.every(r => r.test(d.fTitle) || r.test(d.fBody))) continue;
    hits.push({ doc: d, tier: res.every(r => r.test(d.fTitle)) ? 0 : 1 });
  }
  const rank = d => !d.date ? [2, ''] : d.date >= today ? [0, d.date] : [1, d.date];
  return hits.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const [ga, ka] = rank(a.doc), [gb, kb] = rank(b.doc);
    if (ga !== gb) return ga - gb;
    if (ka !== kb) return (ga === 0 ? ka < kb : ka > kb) ? -1 : 1;
    return a.doc.title.localeCompare(b.doc.title);
  }).map(h => h.doc);
}

// The body around the first matched word, as [text, marked] pieces.
export function snippet(text, query, width = 90) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  const folded = chars.map(fold1);
  const f = folded.join('');
  // Where each original character starts in the folded string.
  const at = [];
  let n = 0;
  for (const c of folded) { at.push(n); n += c.length; }
  const toChar = pos => { let i = 0; while (i < at.length - 1 && at[i + 1] <= pos) i++; return i; };

  const spans = [];
  for (const w of words(query)) {
    const re = new RegExp(wordRe(w).source, 'gu');
    for (const m of f.matchAll(re)) {
      const s = m.index + m[1].length;
      spans.push([toChar(s), toChar(s + w.length - 1) + 1]);
    }
  }
  if (!spans.length) return chars.length > width ? [[chars.slice(0, width).join('') + '…', false]]
    : chars.length ? [[flat, false]] : [];
  spans.sort((a, b) => a[0] - b[0]);
  const from = Math.max(0, spans[0][0] - 25), to = Math.min(chars.length, from + width);
  const out = [];
  let i = from;
  for (const [s, e] of spans) {
    if (s < i || s >= to) continue;
    if (s > i) out.push([chars.slice(i, s).join(''), false]);
    out.push([chars.slice(s, Math.min(e, to)).join(''), true]);
    i = Math.min(e, to);
  }
  if (i < to) out.push([chars.slice(i, to).join(''), false]);
  if (from > 0) out.unshift(['…', false]);
  if (to < chars.length) out.push(['…', false]);
  return out;
}

// ---- the popup -----------------------------------------------------------------------------
// Built here rather than in each app's page, so an app gets it by calling openSearch. The app
// registers '#search-pop' with its other overlays, so its scrim and Escape close it too. An
// entry opened from a result opens over it; closing that comes back to the query as it was.

let pop, input, list, docs = [], opts;

function build() {
  pop = el('div', 'pop centred search');
  pop.id = 'search-pop';
  pop.hidden = true;
  const head = el('div', 'pop-head');
  input = el('input', 'sq');
  input.type = 'search';
  input.placeholder = 'Search';
  input.setAttribute('aria-label', 'Search');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  const x = iconBtn('x', 'Close');
  x.addEventListener('click', closePops);
  head.append(input, x);
  list = el('div', 'hits');
  pop.append(head, list);
  document.body.append(pop);
  input.addEventListener('input', show);
  list.addEventListener('click', e => {
    const r = e.target.closest('[data-path]');
    if (r) opts.open(r.dataset.path);
  });
}

function today() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let fmt = 'auto';

function show() {
  const q = input.value;
  const hits = find(docs, q, today());
  list.replaceChildren(...hits.slice(0, CAP).map(d => {
    const r = el('button', 'hit');
    r.type = 'button';
    r.dataset.path = d.path;
    const top = el('span', 'hit-top');
    top.append(el('span', 'hit-title', d.title));
    if (d.date) top.append(el('span', 'hit-date', formatDate(d.date, fmt)));
    const snip = el('span', 'hit-snip');
    for (const [t, marked] of snippet(d.text, q)) snip.append(marked ? el('mark', '', t) : t);
    r.append(top, snip);
    return r;
  }));
  if (hits.length > CAP) list.append(el('p', 'hit-more', `${CAP}+ matches, keep typing`));
  else if (q.trim() && !hits.length) list.append(el('p', 'hit-more', 'Nothing found.'));
}

export async function openSearch(o) {
  opts = o;
  if (!pop) build();
  closePops();
  [docs, { dateFormat: fmt }] = await Promise.all([
    allFiles(o.folder).then(files => index(files, o)), loadPrefs()]);
  openCentred(pop);
  show();
  input.focus();
  input.select();
}

// After an app writes, a search left open re-reads the mirror, so a result edited from it
// shows what was saved and a deleted one goes.
export async function refreshSearch() {
  if (!pop || pop.hidden) return;
  docs = index(await allFiles(opts.folder), opts);
  show();
}
