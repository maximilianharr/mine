// Notes: the header, a grid of cards newest first, and one popup to read and edit a note in.
// Everything that is not a note's own - the sync, the search, the renderer, the prefs, the icons
// and overlays, the header's dock - is in ../shared/.
import { getConfig, getKV, setKV } from '../shared/store.js';
import { createSync, renderLogs } from '../shared/sync.js';
import { render as markdown } from '../shared/markdown.js';
import { openSearch, refreshSearch } from '../shared/search.js';
import { loadPrefs, applyTheme, setPref, formatDate, THEMES, DATE_FORMATS } from '../shared/prefs.js';
import {
  $, el, icon, iconBtn, addIcons, openPop, openRowPop, openCentred, closePops, registerPops,
  row, choose, toggle
} from '../shared/ui.js';
import { dockable } from '../shared/drag.js';
import { loadNotes, allTags, shows, tagOf, saveNote, deleteNote } from './data.js';

addIcons({
  tag: { d: 'M2.6 2.6h5.2l5.6 5.6-5.2 5.2-5.6-5.6zM5.4 5.4h.01', stroke: 1.4 }
});

const S = { notes: [], prefs: {}, ticked: new Set() };

// ---- the grid ------------------------------------------------------------------------------

// An instant read on this device's clock, as the day it fell on.
function dayOf(v) {
  const d = new Date(v);
  if (!String(v).includes('T') || isNaN(d)) return String(v).slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const tagLine = tags => tags.map(t => `#${t}`).join(' ');

function card(n) {
  const c = el('article', 'ncard');
  c.tabIndex = 0;
  c.dataset.path = n.path;
  c.append(el('h2', 'ntitle', n.title));
  if (n.body.trim()) {
    const b = el('div', 'nbody');
    b.append(markdown(n.body));
    c.append(b);
  }
  const foot = el('div', 'nfoot');
  foot.append(el('span', 'ntags', tagLine(n.tags)),
    el('span', 'ndate', n.updated ? formatDate(dayOf(n.updated), S.prefs.dateFormat) : ''));
  c.append(foot);
  // A link in a card is a link; anywhere else opens the note.
  c.addEventListener('click', e => { if (!e.target.closest('a')) openNote(n); });
  c.addEventListener('keydown', e => { if (e.key === 'Enter') openNote(n); });
  return c;
}

function render() {
  const shown = S.notes.filter(n => shows(n, S.ticked));
  if (shown.length) {
    const grid = el('div', 'ngrid');
    grid.append(...shown.map(card));
    $('#view').replaceChildren(grid);
  } else {
    $('#view').replaceChildren(el('p', 'empty',
      S.notes.length ? 'No notes match the filter' : 'No notes yet — + makes one'));
  }
  renderFilter();
  refreshSearch();
}

async function reload() {
  S.notes = await loadNotes();
  render();
}

// ---- the popup -----------------------------------------------------------------------------
// A draft of the three fields the app owns, compared with the note as opened: the disk shows
// when they differ, and leaving asks first. A new note always has something to write, and its
// disk is disabled until it has a title.

let D = null;        // { note, title, tags, body, clean }
let active = null;   // 'title' | 'body' | null: the row being edited

const snap = d => JSON.stringify([d.title.trim(), d.tags, d.body]);
const changed = () => !!D && snap(D) !== D.clean;
const dirty = () => !!D && (!D.note || changed());

function openNote(note) {
  if (!note) return;
  edit(note);
}

function edit(note) {
  D = { note, title: note?.title ?? '', tags: [...(note?.tags ?? [])], body: note?.body ?? '' };
  D.clean = snap(D);
  active = note ? null : 'title';
  $('#popup').hidden = false;
  draw();
}

function drawBar() {
  const kids = [el('span', 'spacer')];
  if (D.note) {
    const t = iconBtn('trash', 'Delete', 'bad');
    t.addEventListener('click', removeNote);
    kids.push(t);
  }
  if (dirty()) {
    const disk = iconBtn('disk', 'Save', 'save');
    disk.disabled = !D.title.trim();
    disk.addEventListener('click', save);
    kids.push(disk);
  }
  const x = iconBtn('x', 'Close');
  x.addEventListener('click', closePopup);
  kids.push(x);
  $('#n-icons').replaceChildren(...kids);
}

function titleRow() {
  const r = el('div', 'frow first');
  if (active === 'title') {
    r.classList.add('in');
    const i = el('input', 'title-in');
    i.value = D.title;
    i.placeholder = 'Title';
    i.setAttribute('aria-label', 'Title');
    i.addEventListener('input', () => { D.title = i.value; drawBar(); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { active = null; draw(); } });
    r.append(i);
  } else {
    r.append(tap(D.title || 'Title', `ttap${D.title ? '' : ' unset'}`, () => { active = 'title'; draw(); }));
  }
  return r;
}

function tagsRow() {
  const r = el('div', 'frow trow');
  r.append(icon('tag'), tap(D.tags.length ? tagLine(D.tags) : 'Tags',
    D.tags.length ? '' : 'unset', () => toggleTags(r)));
  return r;
}

function bodyRow() {
  const r = el('div', 'frow open brow');
  if (active === 'body') {
    const t = el('textarea', 'body-in');
    t.value = D.body;
    t.setAttribute('aria-label', 'Body');
    const grow = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    t.addEventListener('input', () => { D.body = t.value; drawBar(); grow(); });
    r.append(t);
    requestAnimationFrame(grow);
  } else {
    const b = el('div', `nb-tap${D.body.trim() ? '' : ' unset'}`);
    if (D.body.trim()) b.append(markdown(D.body)); else b.textContent = 'Body';
    b.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      active = 'body';
      draw();
    });
    r.append(b);
  }
  return r;
}

function tap(text, cls, onClick) {
  const b = el('button', `ftap ${cls}`, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function draw() {
  drawBar();
  $('#fpop').hidden = true;
  $('#n-rows').replaceChildren(titleRow(), tagsRow(), bodyRow());
  $('#n-rows').querySelector('.title-in, .body-in')?.focus();
}

// The tags row's popup: every tag any note carries, this note's ticked, and a box for a new one.
function toggleTags(anchor) {
  if (!$('#fpop').hidden) { $('#fpop').hidden = true; return; }
  if (active) { active = null; draw(); anchor = $('#n-rows .trow'); }
  drawTags();
  openRowPop($('#fpop'), anchor);
}

function drawTags() {
  const known = [...new Set([...allTags(S.notes), ...D.tags])].sort();
  const boxes = known.map(t => {
    const lab = el('label', 'glab');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = D.tags.includes(t);
    box.addEventListener('change', () => {
      D.tags = box.checked ? [...D.tags, t] : D.tags.filter(x => x !== t);
      afterTags();
    });
    lab.append(box, el('span', '', `#${t}`));
    return lab;
  });
  const add = el('input', 'tag-in');
  add.placeholder = 'new tag';
  add.setAttribute('aria-label', 'New tag');
  add.autocapitalize = 'off';
  add.enterKeyHint = 'done';
  add.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = tagOf(add.value);
    if (t && !D.tags.includes(t)) D.tags = [...D.tags, t];
    afterTags();
    drawTags();
    $('#fpop-body .tag-in').focus();
  });
  const list = el('div', 'glist');
  list.append(...boxes);
  $('#fpop-body').replaceChildren(list, add);
}

// The row and the top bar follow the ticks; the popup stays where it is.
function afterTags() {
  drawBar();
  const b = $('#n-rows .trow .ftap');
  b.textContent = D.tags.length ? tagLine(D.tags) : 'Tags';
  b.classList.toggle('unset', !D.tags.length);
}

// A tap outside the tags popup shuts it and still reaches what it landed on.
document.addEventListener('click', e => {
  if ($('#fpop').hidden || $('#fpop').contains(e.target)) return;
  if (e.target.closest('#n-rows .trow')) return;
  $('#fpop').hidden = true;
}, true);
$('#fpop-close').addEventListener('click', () => { $('#fpop').hidden = true; });

// ---- writing, and leaving ------------------------------------------------------------------

async function save() {
  if (!D?.title.trim()) return;
  const fresh = !D.note;
  const title = D.title.trim();
  await saveNote(D.note, { title, tags: D.tags, body: D.body });
  discard();
  await reload();
  sync.push(`notes: ${fresh ? 'new' : 'edit'} "${title}"`);
}

async function removeNote() {
  if (!confirm(`Delete "${D.note.title}"?`)) return;
  const { path, title } = D.note;
  await deleteNote(path);
  discard();
  await reload();
  sync.push(`notes: delete "${title}"`);
}

function closePopup() {
  if (changed() && S.prefs.confirmDiscard) {
    $('#ask-never').checked = false;
    $('#ask').hidden = false;
    return;
  }
  discard();
}

function discard() {
  $('#ask').hidden = true;
  $('#popup').hidden = true;
  $('#fpop').hidden = true;
  D = null;
  active = null;
}

$('#popup').addEventListener('click', e => { if (e.target === $('#popup')) closePopup(); });
$('#ask-keep').addEventListener('click', () => { $('#ask').hidden = true; });
$('#ask').addEventListener('click', e => { if (e.target === $('#ask')) $('#ask').hidden = true; });
$('#ask-discard').addEventListener('click', async () => {
  // Mine-wide: the settings row in either app puts it back.
  if ($('#ask-never').checked) {
    S.prefs.confirmDiscard = false;
    await setPref('confirmDiscard', false);
  }
  discard();
});

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#ask').hidden) $('#ask').hidden = true;
  else if (!$('#fpop').hidden) $('#fpop').hidden = true;
  else if (!$('#popup').hidden) closePopup();
  else closePops();
});

// ---- the filter ----------------------------------------------------------------------------
// Tick to show: nothing ticked is every note, ticked tags are the notes carrying any of them.

function renderFilter() {
  const rows = [...allTags(S.notes).map(t => [t, `#${t}`]), ['', 'untagged']].map(([t, text]) => {
    const lab = el('label', 'glab');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = S.ticked.has(t);
    box.addEventListener('change', async () => {
      if (box.checked) S.ticked.add(t); else S.ticked.delete(t);
      await setKV('notes.tags', [...S.ticked]);
      render();
    });
    lab.append(box, el('span', '', text));
    return lab;
  });
  $('#filter-body').replaceChildren(...rows);

  const n = S.ticked.size;
  const btn = $('#filter-btn');
  btn.querySelector('.fcount')?.remove();
  btn.setAttribute('aria-label', n ? `Filter — ${n} tag${n > 1 ? 's' : ''} on` : 'Filter');
  if (n) btn.append(el('span', 'fcount', String(n)));
}

$('#filter-btn').addEventListener('click', () => {
  if (!$('#filter-pop').hidden) return closePops();
  closePops();
  renderFilter();
  openPop($('#filter-pop'), $('#filter-btn'), 'right');
});
$('#filter-close').addEventListener('click', closePops);

// ---- the hamburger: settings and logs ------------------------------------------------------

async function setMine(key, value) {
  S.prefs[key] = value;
  await setPref(key, value);
  if (key === 'theme') applyTheme(value);
  render();
}

function openSettings() {
  closePops();
  $('#settings-body').replaceChildren(
    row('Theme', choose(THEMES.map(t => [t, t]), S.prefs.theme, v => setMine('theme', v))),
    row('Date format', choose(DATE_FORMATS.map(f => [f, f]), S.prefs.dateFormat,
      v => setMine('dateFormat', v))),
    row('Confirm discard', toggle(S.prefs.confirmDiscard, v => setMine('confirmDiscard', v)))
  );
  openCentred($('#settings-panel'));
}

function openLogs() {
  closePops();
  openCentred($('#logs-panel'));
  renderLogs($('#logs-body'), sync);
}

$('#menu-btn').addEventListener('click', () => {
  if (!$('#menu-pop').hidden) return closePops();
  closePops();
  $('#menu-body').replaceChildren(...[['gear', 'settings', openSettings], ['logs', 'logs', openLogs]]
    .map(([ic, text, open]) => {
      const b = el('button', 'mrow');
      b.type = 'button';
      b.append(icon(ic), el('span', '', text));
      b.addEventListener('click', open);
      return b;
    }));
  openPop($('#menu-pop'), $('#menu-btn'), 'right');
});
$('#settings-close').addEventListener('click', closePops);
$('#logs-close').addEventListener('click', closePops);
$('#sync').addEventListener('click', openLogs);

// ---- the header ----------------------------------------------------------------------------

for (const [id, name] of [['#new-btn', 'plus'], ['#search-btn', 'search'], ['#filter-btn', 'filter'],
  ['#menu-btn', 'menu'], ['#home', 'house'], ['#fpop-close', 'x'], ['#filter-close', 'x'],
  ['#settings-close', 'x'], ['#logs-close', 'x']])
  $(id).append(icon(name));

$('#new-btn').addEventListener('click', () => { closePops(); edit(null); });

// A result opens the note over the search; closing it comes back to the search as it was.
$('#search-btn').addEventListener('click', () => openSearch({
  folder: 'notes/', title: 'title', date: 'updated', fields: ['tags'],
  open: path => openNote(S.notes.find(n => n.path === path))
}));

// ---- sync and boot -------------------------------------------------------------------------

const sync = createSync({ line: $('#sync'), hint: ' — tap for details', onPulled: reload });

registerPops(['#search-pop', '#menu-pop', '#filter-pop', '#settings-panel', '#logs-panel']);

S.prefs = await loadPrefs();
applyTheme(S.prefs.theme);

if (!await getConfig()) {
  $('#needs-setup').hidden = false;
} else {
  $('#notes').hidden = false;
  S.ticked = new Set(await getKV('notes.tags') || []);
  dockable($('.topbar'), S.prefs.barPosition, pos => { S.prefs.barPosition = pos; });
  await reload();
  await sync.refresh();
  addEventListener('focus', sync.refresh);
}
