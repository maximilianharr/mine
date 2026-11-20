// The entry popup. A row of icon buttons at the top, the title, the stage and the dates, then
// one row per field that is set.
//
// Each field button opens a sub-popup, and a sub-popup only ever writes into the draft held
// here - nothing reaches the repo until the entry popup's own disk, so one entry edit is one
// commit and the popup's x discards the staged fields with everything else. It is also what
// makes a brand-new entry work, since it has no file for a sub-popup to write to. The one
// exception is adding a category, which is a different file: see below.
import {
  isAllDay, todayKey, toInstant, wallParts, dowOf, partsOf, STAGES, createEntry, updateEntry,
  deleteEntry, saveOverride, skipOccurrence, createGroup, priorityOf
} from './data.js';
import { S, $, el, iconBtn, labelOf, inkOn, STAGE_COLOR } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const splitList = v => String(v).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

// Keys the form owns. Anything else in the file - exdate, rdate, status, a hand-added key -
// survives a save untouched. `done` is in the list and never written back out again.
const FORM_KEYS = ['title', 'type', 'start', 'end', 'done', 'stage', 'priority', 'estimate',
  'group', 'location', 'recurrence', 'alerts', 'participants'];

let D = null;      // the draft
let sub = null;    // the open sub-popup: { field, read }

// ---- the fields behind the icons ------------------------------------------------------------

// The order is the same on a task as on an event, so the row does not reshuffle when the type
// changes - and the detail rows below follow it, which puts participants at the bottom.
const FIELDS = [
  { k: 'body', ic: 'lines', label: 'Details', empty: '',
    set: v => !!v.trim(), sum: v => v.trim().split('\n').find(Boolean) || '', ed: bodyEditor },
  { k: 'group', ic: 'ball', label: 'Category', empty: '',
    set: v => !!v, sum: v => labelOf(v), ed: groupPicker },
  { k: 'recurrence', ic: 'repeat', label: 'Repeat', empty: '',
    set: v => !!v, sum: v => ruleText(v), ed: recurrenceEditor },
  { k: 'alerts', ic: 'bell', label: 'Alerts', empty: [],
    set: v => v.length > 0, sum: v => v.map(alertText).join(', '), ed: alertsEditor },
  { k: 'location', ic: 'pin', label: 'Location', empty: '',
    set: v => !!v, sum: v => v, ed: textEditor('Where', 'Conference room 3B') },
  { k: 'participants', ic: 'person', label: 'Participants', empty: [],
    set: v => v.length > 0, sum: v => v.join(', '), ed: participantsEditor }
];

// The estimate has a sub-popup but no place in D.v, so the sub reads and writes through these
// two rather than reaching into D.v itself.
const EST = { k: 'estimate', label: 'Estimate', empty: null, ed: estimateEditor };
const readField = f => f.k === 'estimate' ? D.estimate : D.v[f.k];
const writeField = (f, v) => { if (f.k === 'estimate') D.estimate = v; else D.v[f.k] = v; };

const alertText = n => n === 0 ? 'at start' : `${n} min before`;

// Only the series carries the rule: an occurrence override must never rewrite it.
const canRule = () => !D.occ || D.scope === 'series' || !D.occ.seriesId;

// ---- opening -------------------------------------------------------------------------------

export function openNew(seed = {}) {
  open(null, 'occurrence', seed);
}

export function openEntry(occ) {
  if (occ) open(occ, 'occurrence', {});
}

function open(occ, scope, seed) {
  D = draft(occ, scope, seed);
  $('#popup').hidden = false;
  $('#f-msg').textContent = '';
  fillForm();
  requestAnimationFrame(() => $('#f-title').focus());
}

function draft(occ, scope, seed) {
  const series = occ && occ.seriesId && scope === 'series';
  const data = occ ? (series ? occ.seriesData : occ.data) : {};
  const body = occ ? (series ? occ.seriesBody : occ.body) : '';
  const start = String(data.start ?? '');
  const allDay = occ ? isAllDay(start) : !!seed.allDay;
  const day = occ ? '' : (seed.dayKey || todayKey());
  const hour = seed.hour == null ? 9 : seed.hour;

  const [sd, st] = occ && !allDay ? wallParts(start) : [occ ? start.slice(0, 10) : day, `${pad(hour)}:00`];
  let ed = '', et = '';
  if (occ && data.end != null) [ed, et] = allDay ? [String(data.end).slice(0, 10), ''] : wallParts(String(data.end));
  else if (!occ && !allDay) [ed, et] = [day, `${pad(Math.min(23, hour + 1))}:00`];

  return {
    occ, scope, base: data,
    type: occ ? (data.type === 'task' ? 'task' : 'event') : (seed.type || 'event'),
    stage: occ ? (occ.stage || 'todo') : (seed.stage || 'todo'),
    priority: occ ? occ.priority : null,
    estimate: occ ? (occ.estimate ?? null) : 1,
    title: occ ? String(data.title ?? '') : '',
    allDay, startDate: sd, startTime: allDay ? '' : st, endDate: ed, endTime: allDay ? '' : et,
    v: {
      recurrence: occ && (series || !occ.seriesId) ? String(data.recurrence ?? '') : '',
      group: String(data.group ?? ''),
      location: String(data.location ?? ''),
      alerts: list(data.alerts).map(Number).filter(Number.isFinite),
      participants: list(data.participants).map(String),
      body: body ?? ''
    }
  };
}

const list = v => v == null ? [] : Array.isArray(v) ? v : [v];

export function closePopup() {
  closeSub();
  $('#popup').hidden = true;
  D = null;
}

// ---- drawing -------------------------------------------------------------------------------

function fillForm() {
  iconRow();

  $('#f-title').value = D.title;
  $('#f-scope').hidden = !(D.occ && D.occ.seriesId);
  for (const b of document.querySelectorAll('[data-scope]'))
    b.setAttribute('aria-pressed', String(b.dataset.scope === D.scope));

  flagsRow();
  $('#f-start-date').value = D.startDate;
  $('#f-start-time').value = D.startTime;
  $('#f-end-date').value = D.endDate;
  $('#f-end-time').value = D.endTime;
  $('#f-start-time').disabled = D.allDay;
  $('#f-end-time').disabled = D.allDay;

  detailRows();

  const isOcc = D.occ && D.occ.seriesId && D.scope === 'occurrence';
  $('#f-skip').hidden = !isOcc;
  $('#f-path').textContent = !D.occ ? 'New entry.'
    : D.scope === 'series' && D.occ.seriesId ? D.occ.seriesPath
      : isOcc ? `${D.occ.seriesPath} · occurrence ${D.occ.recId}${D.occ.override ? ` · override ${D.occ.path}` : ''}`
        : D.occ.path;
}

// A ticked square and a calendar page choose the type, then a short vertical dash, then the six
// field icons, which open their popups. Every button is an icon; none carries a letter. An icon
// whose field is set is shown enabled, so the row doubles as a summary of what the entry carries.
function iconRow() {
  const kids = [];
  for (const [t, ic, label] of [['task', 'check', 'Task'], ['event', 'cal', 'Event']]) {
    const b = iconBtn(ic, label, D.type === t ? 'on' : '');
    b.setAttribute('aria-pressed', String(D.type === t));
    b.addEventListener('click', () => { D.type = t; fillForm(); });
    kids.push(b);
  }
  // What the entry is comes first and governs the rest, so it is set apart from it.
  kids.push(el('span', 'vdash'));
  for (const f of FIELDS) {
    const b = iconBtn(f.ic, f.label, f.set(D.v[f.k]) ? 'on' : '');
    if (f.k === 'recurrence' && !canRule()) b.disabled = true;
    b.addEventListener('click', () => openSub(f));
    kids.push(b);
  }
  kids.push(el('span', 'spacer'));

  const x = iconBtn('x', 'Close and discard');
  x.addEventListener('click', closePopup);
  kids.push(x);
  if (D.occ) {
    const t = iconBtn('trash', D.occ.seriesId ? 'Delete the whole repeating entry' : 'Delete',
      'bad');
    t.addEventListener('click', removeEntry);
    kids.push(t);
  }
  const disk = iconBtn('disk', 'Save', 'primary');
  disk.type = 'submit';
  kids.push(disk);

  $('#f-icons').replaceChildren(...kids);
}

// The all-day row: a sun, and on a task stage, priority and estimate beside it.
function flagsRow() {
  const kids = [allDayBtn()];
  if (D.type === 'task') kids.push(stageBtn(), prioBtn(), estBtn());
  $('#f-flags').replaceChildren(...kids);
}

// All-day is a clickable icon rather than a checkbox, and it lights with the ordinary enabled
// background - deliberately not the save button's green, which in Mine means a save.
function allDayBtn() {
  const b = iconBtn('sun', 'All-day', D.allDay ? 'on' : '');
  b.setAttribute('aria-pressed', String(D.allDay));
  b.addEventListener('click', () => {
    D.allDay = !D.allDay;
    if (D.allDay) { D.startTime = ''; D.endTime = ''; }
    else { D.startTime = D.startTime || '09:00'; D.endTime = D.endTime || '10:00'; }
    fillForm();
  });
  return b;
}

// Stage, priority and estimate are three small values rather than fields with a form each, so
// they are edited in the row itself and show their value - as a badge on the icon's corner,
// which is why the enabled rule above is about the six field icons alone. Only the estimate
// opens a popup, because a number has to be typed.
const badged = (b, text, cls, color) => {
  const s = el('span', ['badge', cls].filter(Boolean).join(' '), text);
  if (color) { s.style.background = color; s.style.color = inkOn(color); }
  b.append(s);
  return b;
};

function stageBtn() {
  const b = badged(iconBtn('cols', `Stage: ${D.stage}`), '', '', STAGE_COLOR[D.stage]);
  b.addEventListener('click', () => {
    D.stage = STAGES[(STAGES.indexOf(D.stage) + 1) % STAGES.length];
    fillForm();
  });
  return b;
}

function prioBtn() {
  const p = D.priority ?? 0;
  const b = iconBtn('flag', `Priority: ${p || 'none'}`);
  if (p) badged(b, String(p), `p${p}`);
  b.addEventListener('click', () => { D.priority = p === 3 ? null : p + 1; fillForm(); });
  return b;
}

function estBtn() {
  const b = iconBtn('glass', `Estimate: ${D.estimate ? `${D.estimate} day(s)` : 'none'}`);
  if (D.estimate) badged(b, `${D.estimate}d`, 'wide');
  b.addEventListener('click', () => openSub(EST));
  return b;
}

// One row per field that is set, in the order of the icons above - so a location that has been
// given appears at the bottom. A pen reopens its popup, a trashcan clears it.
function detailRows() {
  const rows = [];
  for (const f of FIELDS) {
    if (!f.set(D.v[f.k])) continue;
    if (f.k === 'recurrence' && !canRule()) continue;
    const row = el('div', 'frow');
    row.append(el('span', 'flab', f.label), el('span', 'fval', f.sum(D.v[f.k])));
    const pen = iconBtn('pen', `Edit ${f.label}`);
    pen.addEventListener('click', () => openSub(f));
    const tr = iconBtn('trash', `Clear ${f.label}`, 'bad');
    tr.addEventListener('click', () => { D.v[f.k] = f.empty; fillForm(); });
    row.append(pen, tr);
    rows.push(row);
  }
  $('#f-rows').replaceChildren(...rows);
}

// ---- sub-popups ----------------------------------------------------------------------------

function openSub(f) {
  const ed = f.ed(readField(f));
  sub = { f, read: ed.read };
  $('#sub-title').textContent = f.label;
  $('#sub-body').replaceChildren(ed.node);
  $('#sub').hidden = false;
  $('#sub-scrim').hidden = false;
  requestAnimationFrame(() => $('#sub-body').querySelector('input, select, textarea')?.focus());
}

function closeSub() {
  $('#sub').hidden = true;
  $('#sub-scrim').hidden = true;
  sub = null;
}

// Every sub-popup has the same three: a trashcan that clears that one field, an x that abandons
// the sub-edit, and a disk that commits the value into the draft and lights the icon.
$('#sub-clear').addEventListener('click', () => {
  writeField(sub.f, sub.f.empty);
  closeSub();
  fillForm();
});
$('#sub-cancel').addEventListener('click', closeSub);
$('#sub-ok').addEventListener('click', () => {
  const v = sub.read();
  if (v !== undefined) writeField(sub.f, v);
  closeSub();
  fillForm();
});
$('#sub-scrim').addEventListener('click', closeSub);

// ---- the editors ---------------------------------------------------------------------------

function field(labelText, control, hint) {
  const l = el('label', '', labelText);
  l.append(control);
  if (hint) l.append(el('small', '', hint));
  return l;
}

// A declaration, not a const arrow: FIELDS calls this while the module is still evaluating.
function textEditor(labelText, placeholder) {
  return cur => {
    const i = el('input');
    i.value = cur || '';
    i.placeholder = placeholder;
    return { node: field(labelText, i), read: () => i.value.trim() };
  };
}

function estimateEditor(cur) {
  const i = el('input');
  i.type = 'number';
  i.min = '0';
  i.step = '0.5';
  i.inputMode = 'decimal';
  i.value = cur ?? '';
  return {
    node: field('Days', i, 'Cleared, the task simply has no estimate.'),
    read: () => { const n = Number(i.value); return Number.isFinite(n) && n > 0 ? n : null; }
  };
}

function alertsEditor(cur) {
  const i = el('input');
  i.inputMode = 'numeric';
  i.placeholder = '0, 15';
  i.value = (cur || []).join(', ');
  return {
    node: field('Minutes before start', i,
      '0 is at start. Stored and exported only — nothing fires while the app is closed.'),
    read: () => splitList(i.value).map(Number).filter(Number.isFinite)
  };
}

function participantsEditor(cur) {
  const t = el('textarea');
  t.rows = 3;
  t.spellcheck = false;
  t.className = 'body-in';
  t.value = (cur || []).join('\n');
  return { node: field('Email addresses', t, 'One per line.'), read: () => splitList(t.value) };
}

function bodyEditor(cur) {
  const t = el('textarea');
  t.rows = 8;
  t.spellcheck = false;
  t.className = 'body-in';
  t.value = cur || '';
  return { node: field('Notes', t, 'Raw markdown — exactly what lands in the file.'),
           read: () => t.value };
}

// The groups, each with its colour, and a + to add one. Adding writes groups.md straight away:
// it is a different file from the entry, and a category must not vanish because the entry was
// discarded. Its stored name is derived from the label and never shown, which is why
// relabelling or recolouring later touches no entry.
function groupPicker(cur) {
  let chosen = cur || '';
  const wrap = el('div', 'glist');
  const draw = () => {
    const kids = [];
    for (const [name, g] of Object.entries(S.model.groups)) {
      const b = el('button', `gpick${name === chosen ? ' on' : ''}`);
      b.type = 'button';
      const sw = el('span', 'swatch');
      sw.style.background = g.color || '#9aa5b1';
      b.append(sw, el('span', '', g.label || name));
      b.addEventListener('click', () => { chosen = name; draw(); });
      kids.push(b);
    }
    const none = el('button', `gpick${chosen === '' ? ' on' : ''}`, 'no category');
    none.type = 'button';
    none.addEventListener('click', () => { chosen = ''; draw(); });
    kids.push(none);

    const label = el('input');
    label.placeholder = 'New category';
    const color = el('input');
    color.type = 'color';
    color.value = '#2980b9';
    const add = iconBtn('plus', 'Add category');
    add.addEventListener('click', async () => {
      const text = label.value.trim();
      if (!text) return;
      chosen = await createGroup(S.model.groups, text, color.value);
      S.model = await S.reload();
      S.push(`calendar: add category ${text}`);
      label.value = '';
      draw();
    });
    const form = el('div', 'gadd');
    form.append(label, color, add);
    kids.push(form);
    wrap.replaceChildren(...kids);
  };
  draw();
  return { node: wrap, read: () => chosen };
}

// ---- repetition ----------------------------------------------------------------------------
// A dropdown, not an RRULE field. Files may be hand-written or imported, so a rule the dropdown
// cannot express is shown as a non-selectable custom state and written back untouched.

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const CHOICES = [
  ['none', 'does not repeat'], ['daily', 'daily'], ['weekly', 'weekly'],
  ['biweekly', 'every 2 weeks'], ['monthday', 'monthly on the x-th'],
  ['monthdow', 'monthly on the x-th weekday'], ['yearly', 'yearly']
];

const clean = rule => String(rule || '').trim().replace(/^RRULE:/i, '');

function ruleParts(rule) {
  const out = {};
  for (const bit of clean(rule).split(';')) {
    const [k, v] = bit.split('=');
    if (k) out[k.toUpperCase()] = v ?? '';
  }
  return out;
}

function buildRule(choice, startKey, ends) {
  const dow = WD[dowOf(startKey)];
  const d = partsOf(startKey)[2];
  const core = {
    daily: 'FREQ=DAILY',
    weekly: `FREQ=WEEKLY;BYDAY=${dow}`,
    biweekly: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dow}`,
    monthday: `FREQ=MONTHLY;BYMONTHDAY=${d}`,
    monthdow: `FREQ=MONTHLY;BYDAY=${Math.floor((d - 1) / 7) + 1}${dow}`,
    yearly: 'FREQ=YEARLY'
  }[choice];
  if (!core) return '';
  if (ends.kind === 'until' && ends.until) return `${core};UNTIL=${ends.until.replace(/-/g, '')}T000000Z`;
  if (ends.kind === 'count' && ends.count > 0) return `${core};COUNT=${ends.count}`;
  return core;
}

// The test is round-tripping, not parsing: FREQ=MONTHLY;BYDAY=-1FR parses fine and is still
// custom, because no dropdown entry regenerates it.
function choiceOf(rule, startKey) {
  if (!clean(rule)) return { choice: 'none', ends: { kind: 'never' } };
  const p = ruleParts(rule);
  const ends = p.UNTIL
    ? { kind: 'until', until: `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}` }
    : p.COUNT ? { kind: 'count', count: Number(p.COUNT) } : { kind: 'never' };
  for (const [c] of CHOICES)
    if (c !== 'none' && buildRule(c, startKey, ends) === clean(rule)) return { choice: c, ends };
  return { choice: 'custom', ends };
}

function ruleText(rule) {
  const { choice, ends } = choiceOf(rule, D ? D.startDate : todayKey());
  const name = choice === 'custom' ? clean(rule) : CHOICES.find(([c]) => c === choice)[1];
  return ends.kind === 'until' ? `${name}, until ${ends.until}`
    : ends.kind === 'count' ? `${name}, ${ends.count} times` : name;
}

function recurrenceEditor(cur) {
  const startKey = D.startDate || todayKey();
  const { choice, ends } = choiceOf(cur, startKey);
  const wrap = el('div', 'rec');

  const sel = el('select');
  if (choice === 'custom') {
    const o = el('option', '', `custom · ${clean(cur)}`);
    o.value = 'custom';
    o.disabled = true;
    o.selected = true;
    sel.append(o);
  }
  for (const [v, text] of CHOICES) {
    const o = el('option', '', text);
    o.value = v;
    if (v === choice) o.selected = true;
    sel.append(o);
  }

  const kind = el('select');
  for (const [v, text] of [['never', 'never'], ['until', 'on a date'], ['after', 'after n times']]) {
    const o = el('option', '', text);
    o.value = v;
    if ((v === 'after' ? 'count' : v) === ends.kind) o.selected = true;
    kind.append(o);
  }
  const until = el('input');
  until.type = 'date';
  until.value = ends.until || '';
  const count = el('input');
  count.type = 'number';
  count.min = '1';
  count.value = ends.count || '';

  const syncEnds = () => {
    until.hidden = kind.value !== 'until';
    count.hidden = kind.value !== 'after';
    wrap.querySelector('.ends').hidden = sel.value === 'none';
  };
  kind.addEventListener('change', syncEnds);
  sel.addEventListener('change', syncEnds);

  const endsRow = el('div', 'ends');
  endsRow.append(el('span', 'flab', 'Ends'), kind, until, count);

  wrap.append(field('Repeats', sel, choice === 'custom'
    ? 'This rule was written by hand and the dropdown cannot express it. It is kept exactly as it is; choosing an option above replaces it.'
    : null), endsRow);
  syncEnds();

  return {
    node: wrap,
    read: () => sel.value === 'custom' ? clean(cur) : buildRule(sel.value, startKey, {
      kind: kind.value === 'after' ? 'count' : kind.value,
      until: until.value,
      count: Number(count.value)
    })
  };
}

// ---- the form ------------------------------------------------------------------------------

$('#f-title').addEventListener('input', e => { D.title = e.target.value; });
for (const [id, k] of [['#f-start-date', 'startDate'], ['#f-start-time', 'startTime'],
  ['#f-end-date', 'endDate'], ['#f-end-time', 'endTime']])
  $(id).addEventListener('input', e => { D[k] = e.target.value; });

for (const b of document.querySelectorAll('[data-scope]'))
  b.addEventListener('click', () => { D = draft(D.occ, b.dataset.scope, {}); fillForm(); });

$('#popup').addEventListener('click', e => { if (e.target === $('#popup')) closePopup(); });

function collect() {
  const data = { ...D.base };
  for (const k of FORM_KEYS) delete data[k];

  data.title = D.title.trim();
  data.type = D.type;
  if (D.allDay) {
    data.start = D.startDate;
    if (D.endDate && D.endDate !== D.startDate) data.end = D.endDate;
  } else {
    data.start = toInstant(D.startDate, D.startTime || '00:00');
    if (D.endDate || D.endTime)
      data.end = toInstant(D.endDate || D.startDate, D.endTime || D.startTime || '00:00');
  }
  if (D.type === 'task') {
    data.stage = STAGES.includes(D.stage) ? D.stage : 'todo';
    const p = priorityOf(D.priority);
    if (p) data.priority = p;
    if (D.estimate) data.estimate = D.estimate;
  }
  if (D.v.group) data.group = D.v.group;
  if (D.v.location) data.location = D.v.location;
  if (canRule() && D.v.recurrence) data.recurrence = D.v.recurrence;
  if (D.v.alerts.length) data.alerts = D.v.alerts;
  if (D.v.participants.length) data.participants = D.v.participants;
  return data;
}

// Saving closes the popup and returns to the calendar immediately: the local mirror already
// holds the change, and the push to GitHub is reported in the sync line, not in the popup.
$('#entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { occ, scope } = D;
  const data = collect();
  const body = D.v.body;
  await run(`${occ ? 'edit' : 'add'} ${data.title || 'entry'}`, () => {
    if (!occ) return createEntry(data, body);
    if (occ.seriesId && scope === 'occurrence') return saveOverride(occ, data, body);
    return updateEntry(occ.seriesId ? occ.seriesPath : occ.path, data, body);
  });
});

$('#f-skip').addEventListener('click', () =>
  run(`skip ${D.occ.title} on ${D.occ.dayKey}`, () => skipOccurrence(D.occ)));

function removeEntry() {
  const occ = D.occ;
  const what = occ.seriesId
    ? `Delete the whole repeating entry "${occ.title}"? Its override files stay behind.`
    : `Delete "${occ.title}"?`;
  if (!confirm(what)) return;
  run(`delete ${occ.title}`, () => deleteEntry(occ.seriesId ? occ.seriesPath : occ.path));
}

async function run(what, fn) {
  try {
    await fn();
  } catch (err) {
    $('#f-msg').textContent = `not saved: ${err.message}`;
    $('#f-msg').className = 'msg bad';
    return;
  }
  closePopup();
  S.model = await S.reload();
  S.render();
  S.push(`calendar: ${what}`);
}
