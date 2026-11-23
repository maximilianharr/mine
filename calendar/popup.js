// Two popups for one entry. An entry that already exists opens **read-only** - a view popup
// showing it, with a pen into the edit popup - because most openings are to read, and a form
// answers those questions in input boxes that are harder to read and one slip away from being
// changed by a tap meant to scroll. A new entry has nothing to read and opens the edit popup
// directly.
//
// The edit popup is a row of icon buttons, the title, the dates, the toggle row, then one row
// per field. Each field row opens a sub-popup, and a sub-popup only ever writes into the draft
// held here - nothing reaches the repo until the edit popup's own disk, so one entry edit is one
// commit and its x discards the staged fields with everything else. It is also what makes a
// brand-new entry work, since it has no file for a sub-popup to write to. Adding a category used
// to be the one exception; it lives in settings now, so there is none.
import {
  isAllDay, todayKey, toInstant, wallParts, dowOf, partsOf, timeLabel, STAGES, pad, list,
  createEntry, updateEntry, deleteEntry, saveOverride, skipOccurrence, createGroup, saveGroups
} from './data.js';
import { setKV } from '../shared/store.js';
import { render } from '../shared/markdown.js';
import { S, $, el, icon, iconBtn, labelOf, longDayLabel, inkOn, STAGE_COLOR } from './ui.js';

const splitList = v => String(v).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

// Keys the form owns: cleared from the file's data before collect() writes them back, so
// anything else - exdate, rdate, status, a hand-added key - survives a save untouched.
const FORM_KEYS = ['title', 'type', 'start', 'end', 'stage', 'important',
  'estimate', 'group', 'location', 'recurrence', 'alerts', 'participants'];

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

// An entry that already exists opens read-only. Every way in lands here: a grid, the day
// preview and a card on the board alike.
export function openEntry(occ) {
  if (!occ) return;
  $('#view-card').replaceChildren(...viewCard(occ));
  $('#viewpop').hidden = false;
}

export function closeView() {
  $('#viewpop').hidden = true;
}
$('#viewpop').addEventListener('click', e => { if (e.target === $('#viewpop')) closeView(); });

function open(occ, scope, seed) {
  closeView();
  D = draft(occ, scope, seed);
  D.clean = snapshot(D);
  $('#popup').hidden = false;
  $('#f-msg').textContent = '';
  fillForm();
  requestAnimationFrame(() => $('#f-title').focus());
}

// ---- the view popup ------------------------------------------------------------------------

// The row carries the type as a marker, not a choice, and then the trashcan, the pen and the x.
// The trashcan stays here rather than moving behind the pen: deleting is not an edit of a field,
// and the board's rule that a card is deleted from its popup in two taps depends on it.
function viewCard(o) {
  const mark = el('span', 'ib on');
  mark.title = o.type === 'task' ? 'Task' : 'Event';
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', mark.title);
  mark.append(icon(o.type === 'task' ? 'check' : 'cal'));

  const trash = iconBtn('trash', o.seriesId ? 'Delete the whole repeating entry' : 'Delete', 'bad');
  trash.addEventListener('click', () => removeEntry(o));
  const pen = iconBtn('pen', 'Edit');
  pen.addEventListener('click', () => open(o, 'occurrence', {}));
  const x = iconBtn('x', 'Close');
  x.addEventListener('click', closeView);

  const bar = el('div', 'iconbar');
  bar.append(mark, el('span', 'spacer'), trash, pen, x);
  const out = [bar, el('h2', 'vtitle', o.title || 'Untitled'), el('p', 'vwhen', whenLine(o))];

  // A repeating entry says so, and carries its skip: dropping one occurrence is an action on
  // the entry like deleting it. The scope pair is not here - it governs what an edit writes.
  if (o.seriesId) {
    const note = el('div', 'vrep');
    const skip = el('button', 'link', 'skip this one');
    skip.type = 'button';
    skip.addEventListener('click', () =>
      run(`skip ${o.title} on ${o.dayKey}`, () => skipOccurrence(o)));
    note.append(el('span', 'scope-note', 'Part of a repeating entry.'), skip);
    out.push(note);
  }

  // Only the fields that are set, in the canonical order. Nothing here is a row waiting to be
  // filled - that is what the pen is for - so an unset field has nothing to say.
  const rows = el('div', 'vrows');
  for (const f of FIELDS) {
    if (f.k === 'body') continue;              // the body is rendered below, not summarised
    const v = viewValue(o, f.k);
    if (!f.set(v)) continue;
    const r = el('div', 'vrow');
    r.append(icon(f.ic), el('span', 'flab', f.label), el('span', 'fval', f.sum(v)));
    rows.append(r);
  }
  if (rows.children.length) out.push(rows);

  // In full and rendered, not clipped to two lines and not as raw markdown: two lines on a card
  // and the whole text here are the difference between a glance and having opened the thing.
  if (o.body.trim()) {
    const body = el('div', 'vbody');
    body.append(render(o.body));
    out.push(body);
  }
  return out;
}

// Read from the file's own data, the way the draft does, so an override shows the override.
const viewValue = (o, k) => {
  if (k === 'alerts') return list(o.data.alerts).map(Number).filter(Number.isFinite);
  if (k === 'participants') return list(o.data.participants).map(String);
  return String(o.data[k] ?? '');
};

// The day, the time, and - on a task - the three values the toggle row edits, which a preview
// hiding them would make you open the form to read.
function whenLine(o) {
  const parts = [longDayLabel(o.dayKey), o.allDay ? 'all-day'
    : o.end && !isAllDay(o.end) ? `${timeLabel(o.start)}–${timeLabel(o.end)}`
      : timeLabel(o.start)];
  if (o.type === 'task') {
    parts.push(o.stage);
    if (o.important) parts.push('important');
    if (o.estimate) parts.push(`${o.estimate}d`);
  }
  return parts.join(' · ');
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
    important: occ ? occ.important : false,
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

// What a discard would lose: the draft's own editable parts. A popup that was opened and not
// touched has nothing to lose, so it closes without a word.
const snapshot = d => JSON.stringify([d.type, d.stage, d.important, d.estimate, d.title,
  d.allDay, d.startDate, d.startTime, d.endDate, d.endTime, d.v]);

// Leaving a popup that holds unsaved changes asks first - the x, the backdrop and Escape are one
// way out and ask one question. A half-written new entry counts as work: it is as easy to lose
// as an edit of a saved one.
export function closePopup() {
  if (D && S.prefs.confirmDiscard && snapshot(D) !== D.clean) {
    $('#ask-never').checked = false;
    $('#ask').hidden = false;
    return;
  }
  discard();
}

function discard() {
  closeSub();
  $('#ask').hidden = true;
  $('#popup').hidden = true;
  D = null;
}

$('#ask-keep').addEventListener('click', () => { $('#ask').hidden = true; });
$('#ask').addEventListener('click', e => { if (e.target === $('#ask')) $('#ask').hidden = true; });
$('#ask-discard').addEventListener('click', async () => {
  // Ticking it silences the prompt on this device for good; the settings panel's row is what
  // puts it back, because nothing in Mine may be switched off from a place that cannot switch
  // it back on.
  if ($('#ask-never').checked) {
    S.prefs.confirmDiscard = false;
    await setKV('calendar.confirmDiscard', false);
  }
  discard();
});

// A save or a delete has nothing left to discard, and neither has a closed view popup.
function closeAll() {
  discard();
  closeView();
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

  fieldRows();
}

// A ticked square and a calendar page choose the type, and that is all the row holds besides the
// three on the right: the fields are rows below. Every button is an icon; none carries a letter.
// No dash divides the two groups - the gap to the right-aligned trio already does.
//
// The trio runs trashcan, disk, x: the x is rightmost in every popup in Mine, so the way out of
// an overlay is in the same corner wherever you are.
function iconRow() {
  const kids = [];
  for (const [t, ic, label] of [['task', 'check', 'Task'], ['event', 'cal', 'Event']]) {
    const b = iconBtn(ic, label, D.type === t ? 'on' : '');
    b.setAttribute('aria-pressed', String(D.type === t));
    // Disabled on an entry that already exists: a task turned into an event drops its stage,
    // its importance and its estimate, and a popup opened to fix a typo is not where that
    // belongs one tap away. The type is settled when the entry is made.
    b.disabled = !!D.occ;
    b.addEventListener('click', () => { D.type = t; fillForm(); });
    kids.push(b);
  }
  kids.push(el('span', 'spacer'));

  if (D.occ) {
    const t = iconBtn('trash', D.occ.seriesId ? 'Delete the whole repeating entry' : 'Delete',
      'bad');
    t.addEventListener('click', () => removeEntry(D.occ));
    kids.push(t);
  }
  const disk = iconBtn('disk', 'Save', 'save');
  disk.type = 'submit';
  kids.push(disk);
  const x = iconBtn('x', 'Close and discard');
  x.addEventListener('click', closePopup);
  kids.push(x);

  $('#f-icons').replaceChildren(...kids);
}

// The toggle row, under start and end: `24h`, and on a task stage, important and estimate.
function flagsRow() {
  const kids = [allDayBtn()];
  if (D.type === 'task') kids.push(stageBtn(), bangBtn(), estBtn());
  $('#f-flags').replaceChildren(...kids);
}

// All-day is a clickable control rather than a checkbox, and it lights with the ordinary enabled
// background - deliberately not the save button's green, which in Mine means a save.
//
// It reads `24h` rather than carrying an icon: every drawing of a whole day reads as something
// else, and the sun this replaces was taken for weather. Only the button says `24h` - the grids'
// strip and the prose still say all-day, which is the clearer word where there is room for it.
function allDayBtn() {
  const b = iconBtn('24h', 'All-day', D.allDay ? 'on' : '');
  b.setAttribute('aria-pressed', String(D.allDay));
  b.addEventListener('click', () => {
    D.allDay = !D.allDay;
    if (D.allDay) { D.startTime = ''; D.endTime = ''; }
    else { D.startTime = D.startTime || '09:00'; D.endTime = D.endTime || '10:00'; }
    fillForm();
  });
  return b;
}

// Stage, important and estimate are three small values rather than fields with a form each, so
// they are edited in the row itself. Stage and the estimate show their value as a badge on the
// icon's corner; important has nothing to put in one and lights instead. Only the estimate opens
// a popup, because a number has to be typed.
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

// A toggle, not a cycle: there is no third state to reach, and no badge, because the lit state
// has already said everything a yes or no has to say.
function bangBtn() {
  const b = iconBtn('!', 'Important', D.important ? 'on' : '');
  b.setAttribute('aria-pressed', String(D.important));
  b.addEventListener('click', () => { D.important = !D.important; fillForm(); });
  return b;
}

function estBtn() {
  const b = iconBtn('glass', `Estimate: ${D.estimate ? `${D.estimate} day(s)` : 'none'}`);
  if (D.estimate) badged(b, `${D.estimate}d`, 'wide');
  b.addEventListener('click', () => openSub(EST));
  return b;
}

// Every field is a row: its icon, its name, and its value once it is set. The rows that are set
// come first and the rest follow, in the canonical order inside each group - so setting a field
// lifts its row and shuffles nothing else. The row is the pen, and clearing a field is the
// trashcan inside its own popup; a set row is plain, because position and value already say it
// is set. A rule the popup must not rewrite has no row at all.
function fieldRows() {
  const usable = FIELDS.filter(f => f.k !== 'recurrence' || canRule());
  const isSet = f => f.set(D.v[f.k]);
  const rows = [...usable.filter(isSet), ...usable.filter(f => !isSet(f))].map(f => {
    const row = el('button', 'frow');
    row.type = 'button';
    row.setAttribute('aria-label', `${f.label}${isSet(f) ? `: ${f.sum(D.v[f.k])}` : ''}`);
    row.append(icon(f.ic), el('span', 'flab', f.label));
    if (isSet(f)) row.append(el('span', 'fval', f.sum(D.v[f.k])));
    row.addEventListener('click', () => openSub(f));
    return row;
  });
  $('#f-rows').replaceChildren(...rows);
}

// ---- sub-popups ----------------------------------------------------------------------------

function openSub(f) {
  const ed = f.ed(readField(f));
  sub = { f, read: ed.read };
  $('#sub-title').textContent = f.label;
  $('#sub-body').replaceChildren(ed.node);
  showSub(false);
  requestAnimationFrame(() => $('#sub-body').querySelector('input, select, textarea')?.focus());
}

// The group manager reached from settings shows the x alone: `clear this field` and `use this
// value` mean nothing when there is no field and the writes have already happened.
function showSub(manage) {
  for (const [id, hidden] of [['#sub-clear', manage], ['#sub-ok', manage],
    ['#sub-cancel', manage], ['#sub-close', !manage]]) $(id).hidden = hidden;
  $('#sub').hidden = false;
  $('#sub-scrim').hidden = false;
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
$('#sub-close').addEventListener('click', closeSub);
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

// One list, two forms, and the two sets of controls never appear together. From the category
// field it **only picks**: no pen, no trashcan, no `+ add` - naming, recolouring and deleting a
// group are settings, and an entry popup is not where a list the whole repo shares should be
// rewritten, least of all by a trashcan a thumb's width from the group being aimed at. From the
// settings panel's `edit groups` it **only manages**, with no way to pick, because nothing is
// being filled in.
//
// `chosen` is what tells them apart: a string when picking, null when managing. Managing writes
// groups.md straight away - a group's stored name is derived from its label and never shown,
// which is why relabelling or recolouring touches no entry, and entries naming a deleted one
// render grey.
let editing = null;      // the group whose row is in edit mode; '' is the new one

export function openGroups() {
  editing = null;
  sub = null;
  $('#sub-title').textContent = 'Groups';
  $('#sub-body').replaceChildren(groupList(null).node);
  showSub(true);
}

function groupPicker(cur) {
  return groupList(cur || '');
}

function groupList(initial) {
  let chosen = initial;
  const wrap = el('div', 'glist');

  // The list is redrawn from the reloaded model rather than from what was typed, so a failed
  // write leaves the rows showing what is actually in the repo.
  const commit = async (what, fn) => {
    const made = await fn();
    editing = null;
    if (made && chosen !== null) chosen = made;
    S.model = await S.reload();
    S.render();
    S.push(`calendar: ${what}`);
    draw();
  };

  const groupRow = (name, g) => {
    const r = el('div', 'grow');
    const text = g.label || name;
    const sw = el('span', 'swatch');
    sw.style.background = g.color || '#9aa5b1';
    if (chosen === null) r.append(sw, el('span', 'gname', text));
    else {
      const b = el('button', `gpick${name === chosen ? ' on' : ''}`);
      b.type = 'button';
      b.append(sw, el('span', '', text));
      b.addEventListener('click', () => { chosen = name; draw(); });
      r.append(b);
    }
    if (chosen !== null) return r;             // picking: the groups and nothing else
    const pen = iconBtn('pen', `Edit ${text}`);
    pen.addEventListener('click', () => { editing = name; draw(); });
    const del = iconBtn('trash', `Delete ${text}`, 'bad');
    del.addEventListener('click', () => {
      if (!confirm(`Delete the category "${text}"? Entries still naming it render grey.`)) return;
      const rest = { ...S.model.groups };
      delete rest[name];
      commit(`delete category ${text}`, () => saveGroups(rest));
    });
    r.append(pen, del);
    return r;
  };

  const groupForm = (name, g) => {
    const r = el('div', 'grow');
    const label = el('input');
    label.value = g.label || name;
    label.placeholder = 'Label';
    const color = el('input');
    color.type = 'color';
    color.value = g.color || '#2980b9';
    const ok = iconBtn('disk', 'Save', 'save');
    ok.addEventListener('click', () => {
      const text = label.value.trim();
      if (!text) return;
      commit(`${name ? 'edit' : 'add'} category ${text}`, () => name
        ? saveGroups({ ...S.model.groups, [name]: { color: color.value, label: text } })
        : createGroup(S.model.groups, text, color.value));
    });
    const cancel = iconBtn('x', 'Cancel');
    cancel.addEventListener('click', () => { editing = null; draw(); });
    r.append(label, color, ok, cancel);
    return r;
  };

  const draw = () => {
    const kids = [];
    for (const [name, g] of Object.entries(S.model.groups))
      kids.push(name === editing ? groupForm(name, g) : groupRow(name, g));
    // Picking stops here. There is no `no category` row either: clearing the field is the
    // popup's own trashcan, as in the other five, and the trio at the top is the one control
    // that sits in the same place in every field's popup.
    if (chosen === null) {
      if (editing === '') kids.push(groupForm('', { color: '#2980b9', label: '' }));
      else {
        const add = el('button', 'link', '+ add category');
        add.type = 'button';
        add.addEventListener('click', () => { editing = ''; draw(); });
        kids.push(add);
      }
    }
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

// Switching scope rebuilds the draft from the other file, so the baseline a discard is measured
// against has to be rebuilt with it. Leaving `clean` behind would read as undefined, and every
// way out of the popup would ask about changes nobody had made.
for (const b of document.querySelectorAll('[data-scope]'))
  b.addEventListener('click', () => {
    D = draft(D.occ, b.dataset.scope, {});
    D.clean = snapshot(D);
    fillForm();
  });

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
    if (D.important) data.important = true;
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

function removeEntry(occ) {
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
    // The view popup has no message line, so a delete or a skip that fails is reported in the
    // sync line instead of nowhere.
    if ($('#popup').hidden) S.status(`not saved: ${err.message}`, true);
    else {
      $('#f-msg').textContent = `not saved: ${err.message}`;
      $('#f-msg').className = 'msg bad';
    }
    return;
  }
  closeAll();
  S.model = await S.reload();
  S.render();
  S.push(`calendar: ${what}`);
}
