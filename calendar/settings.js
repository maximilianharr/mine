// The hamburger's three errands, each its own overlay. The filter is a dropdown off the hamburger,
// because it is the half you open often and the view it narrows has to stay in sight while you
// narrow it; the settings are the nine rows that change once, so they are a centred panel. One
// panel held both until the two were told apart by a heading alone - which is a weak way to
// separate a thing you open daily from a thing you open twice, and it cost the filter the room
// to show its groups. The logs are a centred panel too, and they exist because a queue that
// could not drain had nowhere to say so: the count went to the sync line and the reason went to
// the same line, where the next focus overwrote it.
//
// Everything here is stored on the device except the groups, the sprint length and the first
// sprint date: those three are data and live in the repo, because the sprint a task belongs to
// is derived from them and two devices that disagreed would put the same card in different
// sprints. Theme and date format are Mine-wide, not the calendar's.
//
// Every settings row is two halves - the label on the left, its control on the right - so the
// controls line up in one column. That alignment is the whole of what the panel was missing: a
// select, a text box, a checkbox and a date field each started wherever its own label happened
// to end. The groups are behind a button rather than listed, because a list grew with the repo
// and pushed the nine settings that never change below the fold.
import { setKV, queued } from '../shared/store.js';
import { lastSync, discardQueue } from '../shared/github.js';
import { saveSettings, setZone, getZone } from './data.js';
import { THEMES, DATE_FORMATS, applyTheme, setPref } from '../shared/prefs.js';
import { openGroups } from './popup.js';
import { S, $, el, closePops, openPop, openCentred, colorOf, labelOf } from './ui.js';

export function openFilter() {
  closePops();
  renderFilter();
  openPop($('#filter-pop'), $('#menu-btn'), 'right');
}

export function openPanel() {
  closePops();
  build();
  openCentred($('#settings-panel'));
}

export function openLogs() {
  closePops();
  openCentred($('#logs-panel'));
  renderLogs();
}

// ---- the filter ----------------------------------------------------------------------------
// A view filter, remembered per device. Groups are named and coloured in the settings panel's
// `edit groups`, not here.

function groupNames() {
  const names = new Set(Object.keys(S.model.groups));
  let ungrouped = false;
  for (const e of [...S.model.dated, ...S.model.rules]) {
    if (e.data.group) names.add(e.data.group); else ungrouped = true;
  }
  const out = [...names].sort().map(n => [n, labelOf(n)]);
  if (ungrouped) out.push(['', 'no group']);
  return out;
}

// The groups are a plain list of checkboxes. They were folded behind a `groups · 3 of 4` row for
// one reason - an open list pushed the nine settings rows below the fold - and that reason went
// when the settings moved into a panel of their own. One tap hides a group now instead of two,
// and a repo with twenty groups scrolls inside the dropdown rather than growing it.

export function renderFilter() {
  const names = groupNames();
  const kids = [];

  for (const [name, label] of names) {
    const lab = el('label', 'glab');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !S.hidden.has(name);
    box.addEventListener('change', async () => {
      if (box.checked) S.hidden.delete(name); else S.hidden.add(name);
      await setKV('calendar.hiddenGroups', [...S.hidden]);
      S.render();
    });
    const sw = el('span', 'swatch');
    sw.style.background = colorOf(name);
    lab.append(box, sw, el('span', '', label || name));
    kids.push(lab);
  }

  // Importance and assignee narrow the board, where a sprint can hold more cards than fit. One
  // switch, now that importance is a yes or no rather than three tiers to pick between.
  if (S.view.mode === 'K') {
    const chip = el('button', `chip${S.kfilter.importantOnly ? ' on' : ''}`, '!');
    chip.type = 'button';
    chip.title = 'Important only';
    chip.setAttribute('aria-label', 'Important only');
    chip.setAttribute('aria-pressed', String(S.kfilter.importantOnly));
    chip.addEventListener('click', () => {
      S.kfilter.importantOnly = !S.kfilter.importantOnly;
      S.render();
    });
    kids.push(row('Important only', chip));

    const people = [...new Set([...S.model.dated, ...S.model.rules]
      .flatMap(e => [].concat(e.data.participants ?? []).map(String)))].sort();
    kids.push(row('Assignee', choose([['', 'anyone'], ...people.map(p => [p, p])],
      S.kfilter.assignee, v => { S.kfilter.assignee = v; S.render(); })));
  }

  $('#filter-body').replaceChildren(...kids);
}

// Nine rows and nothing after them: there is no paragraph explaining what is stored where,
// because that belongs in REQUIREMENTS.md and not on a panel opened to change the theme.
function build() {
  $('#settings-body').replaceChildren(
    row('Groups', groupsButton()),
    row('Start week on', choose([[1, 'Monday'], [0, 'Sunday']], S.prefs.weekStart,
      v => local('weekStart', Number(v)))),
    row('Time zone', zoneField()),
    row('Date format', choose(DATE_FORMATS.map(f => [f, f]), S.prefs.dateFormat,
      v => mine('dateFormat', v))),
    row('Calendar weeks', toggle(S.prefs.showWeeks, v => local('showWeeks', v))),
    // The way back on. A prompt silenced from inside itself needs a row that can restore it,
    // because nothing in Mine may be switched off from a place that cannot switch it back on.
    row('Confirm discard', toggle(S.prefs.confirmDiscard, v => local('confirmDiscard', v))),
    row('Sprint length', numberField(S.model.settings.interval, 1,
      v => sprints({ interval: v })), 'weeks'),
    row('First sprint', dateField(S.model.settings.anchor, v => sprints({ anchor: v }))),
    row('Theme', choose(THEMES.map(t => [t, t]), S.prefs.theme, v => mine('theme', v)))
  );
}

// ---- rows ----------------------------------------------------------------------------------

// Two halves. A unit shares the right half with its control rather than dropping below it,
// which is the one place a row would otherwise go ragged again.
function row(label, control, suffix) {
  const r = el('div', 'srow');
  r.append(el('span', 'slab', label));
  if (!suffix) r.append(control);
  else {
    const v = el('div', 'sval');
    v.append(control, el('span', 'ssuf', suffix));
    r.append(v);
  }
  return r;
}

// The same popup the entry popup's category field opens, in its manage-only form: one place
// where a group is named or coloured, so there is no second list to keep in step.
function groupsButton() {
  const b = el('button', 'link', 'edit groups');
  b.type = 'button';
  b.id = 'edit-groups';
  b.addEventListener('click', openGroups);
  return b;
}

function choose(options, current, onChange) {
  const s = el('select');
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = String(v);
    if (String(v) === String(current)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function toggle(current, onChange) {
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!current;
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}

function numberField(current, min, onChange) {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.value = String(current);
  i.addEventListener('change', () => {
    const n = Number(i.value);
    if (Number.isInteger(n) && n >= min) onChange(n); else i.value = String(current);
  });
  return i;
}

function dateField(current, onChange) {
  const i = el('input');
  i.type = 'date';
  i.value = current;
  i.addEventListener('change', () => { if (i.value) onChange(i.value); });
  return i;
}

// A zone name, not an offset: a plain UTC+1 is an hour wrong for half the year in any zone with
// daylight saving. Empty means the device's own.
function zoneField() {
  const i = el('input');
  i.value = S.prefs.timeZone;
  i.placeholder = getZone();
  i.autocapitalize = 'off';
  i.spellcheck = false;
  i.addEventListener('change', () => {
    const typed = i.value.trim();
    const chosen = setZone(typed);
    if (typed && chosen !== typed) {
      i.value = '';
      S.status(`"${typed}" is not a zone name — using ${chosen}.`, true);
    }
    local('timeZone', i.value.trim());
    i.placeholder = getZone();
  });
  return i;
}

// ---- writes --------------------------------------------------------------------------------

async function sprints(patch) {
  await saveSettings({ ...S.model.settings, ...patch });
  S.model = await S.reload();
  build();
  S.render();
  S.push('calendar: sprint settings');
}

async function local(key, value) {
  S.prefs[key] = value;
  await setKV(`calendar.${key}`, value);
  S.render();
}

// A re-render redraws the filter, because the board's two controls are only in it on the board.
// `S.render()` calls back into renderFilter, so this file does not have to.

async function mine(key, value) {
  S.prefs[key] = value;
  await setPref(key, value);
  if (key === 'theme') applyTheme(value);
  S.render();
}

// ---- the logs ------------------------------------------------------------------------------
// What the last sync attempt did, what is still waiting, and the two ways out: push it again, or
// give up on it. The sync line used to say `14 change(s) pending` and nothing else: the reason
// was written to that same line by whichever push failed and overwritten by the next focus, so a
// browser could sit on a queue it could neither explain nor clear. The record behind this panel
// is written in shared/github.js, which is where every drain and every pull goes through.

async function renderLogs() {
  const items = await queued();
  const last = await lastSync();
  const body = $('#logs-body');

  const kids = [row(items.length ? `${items.length} change(s) pending` : 'in sync',
    actions(items.length))];

  kids.push(el('h3', 'lhead', 'last attempt'));
  if (!last) kids.push(el('p', 'lnote', 'Nothing recorded on this device yet.'));
  else {
    kids.push(el('p', `lline${last.outcome === 'ok' ? '' : ' bad'}`, headline(last)));
    if (last.detail) kids.push(el('p', 'lnote', last.detail));
    kids.push(el('p', 'lnote', seen(last)));
  }

  if (items.length) {
    kids.push(el('h3', 'lhead', 'waiting'));
    for (const it of items) {
      const r = el('div', 'lrow');
      r.append(el('span', `lop ${it.op}`, it.op), el('span', 'lpath', it.path),
        el('span', 'lage', age(it.at)));
      kids.push(r);
    }
  }

  body.replaceChildren(...kids);
}

function actions(n) {
  const v = el('div', 'sval end');

  const now = el('button', 'link', 'push now');
  now.type = 'button';
  now.disabled = !n;
  now.addEventListener('click', async () => { await S.refresh(); renderLogs(); });

  // The one button in Mine that can lose work, so it confirms the way the other one does -
  // `forget this device` on the home screen - rather than through the calendar's own prompt,
  // whose `don't ask again` would switch this guard off along with the one it belongs to.
  const drop = el('button', 'link bad', 'discard all');
  drop.type = 'button';
  drop.disabled = !n;
  drop.addEventListener('click', async () => {
    if (!confirm(`Discard ${n} queued change(s)? They are not in GitHub and will be lost. `
      + `The repo itself is untouched.`)) return;
    await discardQueue();
    await renderLogs();
    await S.refresh();                 // restores the discarded paths from the remote
    renderLogs();
  });

  v.append(now, drop);
  return v;
}

const what = l => (l.op === 'drain' ? 'push' : 'pull');

function headline(l) {
  if (l.outcome === 'ok') return `${what(l)} succeeded`;
  if (l.outcome === 'conflict') return `${what(l)} finished with conflicts`;
  if (l.outcome === 'discarded') return 'queue discarded';
  return `${what(l)} failed${l.status ? ` — HTTP ${l.status}` : ''}`;
}

const stamp = t => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

// Counted rather than listed: the same failure repeats on every window focus, so what tells you
// anything is how long it has been failing, not twenty copies of it.
const seen = l => (l.count > 1
  ? `${l.count}× in a row, first ${stamp(l.at)}, last ${stamp(l.lastAt)}`
  : stamp(l.lastAt)) + (l.app ? ` · from ${l.app}` : '');

// Changes queued before this version carry no time, and are not going to grow one.
function age(at) {
  if (!at) return '—';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h`
    : `${Math.floor(m / 1440)}d`;
}
