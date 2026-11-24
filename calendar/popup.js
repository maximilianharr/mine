// One popup for an entry, read and written in the same rows. A row is text until it is clicked;
// then it holds the control for its value - and it holds it **without changing shape**. A row
// that grew a heading and a control beneath it moved every row under it and sent the eye hunting
// for the field it had just tapped, which is the one thing a popup opened to type one word must
// not do. So a row that can hold its control on one line does (the title, location, alerts and
// participants are an input in the line, with the field's name as the placeholder), and a row
// whose control cannot be a line opens that control in a small popup anchored to the row, which
// is left exactly as it was (the when, the category, the repetition and the estimate).
//
// The rows hold a draft and nothing reaches the repo until the top row's disk, so one entry edit
// is one commit and the x discards the lot. The disk appears only once the draft differs from
// the file, which is the same comparison the discard prompt makes - one definition of changed,
// so a disk cannot appear where the prompt would stay silent.
//
// Per-row write-through was rejected: the popup would hold a stale occurrence after the first
// write, a saved date would move the file out from under it, and several saves queued offline
// would write to one path more than once in a single tree.
import {
  isAllDay, todayKey, toInstant, wallParts, dowOf, partsOf, timeLabel, STAGES, pad, list,
  createEntry, updateEntry, deleteEntry, saveOverride, skipOccurrence, createGroup, saveGroups
} from './data.js';
import { setKV } from '../shared/store.js';
import { render } from '../shared/markdown.js';
import {
  S, $, el, icon, iconBtn, labelOf, longDayLabel, inkOn, openRowPop, STAGE_COLOR
} from './ui.js';

const splitList = v => String(v).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

// Keys the form owns: cleared from the file's data before collect() writes them back, so
// anything else - exdate, rdate, status, a hand-added key - survives a save untouched.
const FORM_KEYS = ['title', 'type', 'start', 'end', 'stage', 'important',
  'estimate', 'group', 'location', 'recurrence', 'alerts', 'participants'];

let D = null;        // the draft
let active = null;   // the row holding an inline input: { key }
let popped = null;   // the key whose anchored popup is open
let justClosed = null;   // the key a dismissing tap just closed, so that tap cannot reopen it

// ---- the fields behind the icons ------------------------------------------------------------

// The order is the same on a task as on an event, so the row does not reshuffle when the type
// changes - and the detail rows below follow it, which puts participants at the bottom.
// `mode` is how the field is edited: `inline` puts its input in the row, `pop` opens it in a
// popup anchored to the row, `block` is the body, which is neither.
const FIELDS = [
  { k: 'body', ic: 'lines', label: 'Details', empty: '', mode: 'block',
    set: v => !!v.trim(), sum: v => v.trim().split('\n').find(Boolean) || '', ed: bodyEditor },
  { k: 'group', ic: 'ball', label: 'Category', empty: '', mode: 'pop',
    set: v => !!v, sum: v => labelOf(v), ed: groupPicker },
  { k: 'recurrence', ic: 'repeat', label: 'Repeat', empty: '', mode: 'pop',
    set: v => !!v, sum: v => ruleText(v), ed: recurrenceEditor },
  { k: 'alerts', ic: 'bell', label: 'Alerts', empty: [], mode: 'inline',
    set: v => v.length > 0, sum: v => v.map(alertText).join(', '), ed: alertsEditor },
  { k: 'location', ic: 'pin', label: 'Location', empty: '', mode: 'inline',
    set: v => !!v, sum: v => v, ed: textEditor('Location') },
  { k: 'participants', ic: 'person', label: 'Participants', empty: [], mode: 'inline',
    set: v => v.length > 0, sum: v => v.join(', '), ed: participantsEditor }
];

// The estimate has an editor but no place in D.v, so it reads and writes through these two
// rather than reaching into D.v itself. The when has no place in D.v either and no stored value
// at all - it is four parts of the draft - so its editor writes them itself.
// `popClear` is the estimate alone: its row is an icon on the toggle row with no room for a
// trashcan beside it, so the one place its popup differs from the other three is that it carries
// the trashcan in its own head.
const EST = { k: 'estimate', ic: 'glass', label: 'Estimate', empty: null, mode: 'pop',
  popClear: true, set: v => !!v, sum: v => `${v}d`, ed: estimateEditor };
const WHEN = { k: 'when', label: 'When', mode: 'pop', ed: whenEditor };
const readField = f => f.k === 'estimate' ? D.estimate : D.v[f.k];
const writeField = (f, v) => { if (f.k === 'estimate') D.estimate = v; else D.v[f.k] = v; };

const alertText = n => n === 0 ? 'at start' : `${n} min before`;

// Only the series carries the rule: an occurrence override must never rewrite it.
const canRule = () => !D.occ || D.scope === 'series' || !D.occ.seriesId;

// ---- opening -------------------------------------------------------------------------------

export function openNew(seed = {}) {
  open(null, 'occurrence', seed);
}

// Every way in lands here: a grid, the day preview and a card on the board alike. There is one
// popup, and it is both - the entry is shown as text and every value is edited in its own row.
export function openEntry(occ) {
  if (!occ) return;
  open(occ, 'occurrence', {});
}

function open(occ, scope, seed) {
  D = draft(occ, scope, seed);
  D.clean = snapshot(D);
  active = occ ? null : { key: 'title' };
  $('#popup').hidden = false;
  $('#f-msg').textContent = '';
  fillForm();
  focusRow();
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

// What a discard would lose, and - the same question - what the disk has to write: the draft's
// editable parts against the baseline taken when the popup opened. One comparison, so the disk
// cannot appear where the prompt would stay silent.
const snapshot = d => JSON.stringify([d.type, d.stage, d.important, d.estimate, d.title,
  d.allDay, d.startDate, d.startTime, d.endDate, d.endTime, d.v]);

// A new entry always has something to write, there being no file yet; the disk is disabled until
// it has a title instead.
const dirty = () => !!D && (!D.occ || snapshot(D) !== D.clean);

// ---- leaving -------------------------------------------------------------------------------

// Leaving a popup that holds unsaved changes asks first - the x, the backdrop and Escape are one
// way out and ask one question. A row's own x is not guarded and has nothing to guard: it closes
// a row and keeps what is in it.
function closePopup() {
  if (D && S.prefs.confirmDiscard && snapshot(D) !== D.clean) {
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
  active = null;
  popped = null;
  D = null;
}

// Escape unwinds the one layer there is: a field's popup, which is a real overlay with an x of
// its own, swallows it so that Escape inside a field does not throw away the edit the field is
// part of. An **inline row does not** - it is the row in its editing state, not a layer over
// anything, and leaving it loses nothing, so Escape there keeps meaning "leave the popup". A new
// entry opens with its title row already an input, and making that swallow the first Escape would
// have cost two presses to leave the commonest popup in the app.
export function escapeEntry() {
  if (popped !== null) closeFieldPop();
  else closePopup();
}

$('#ask-keep').addEventListener('click', () => { $('#ask').hidden = true; });
$('#ask').addEventListener('click', e => { if (e.target === $('#ask')) $('#ask').hidden = true; });
$('#ask-discard').addEventListener('click', async () => {
  // Ticking it silences the prompt on this device for good; the panel's settings row is what
  // puts it back, because nothing in Mine may be switched off from a place that cannot switch
  // it back on.
  if ($('#ask-never').checked) {
    S.prefs.confirmDiscard = false;
    await setKV('calendar.confirmDiscard', false);
  }
  discard();
});

$('#popup').addEventListener('click', e => {
  if (justClosed === null && e.target === $('#popup')) closePopup();
});

// ---- rows ----------------------------------------------------------------------------------
// A row is the icon, then the value - no field name beside it. Clicking it opens its control
// without moving the row: an input in the line, or a popup anchored under it.
//
// An open editor writes into the draft as it is typed, which is what lets the disk appear the
// moment something differs from the file without the row being re-rendered under the cursor -
// and it is what makes closing a row keep what was typed without a save to press.

function fillForm() {
  iconRow();
  const kids = [titleRow()];
  if (D.occ && D.occ.seriesId) kids.push(scopeRow());
  kids.push(whenRow(), flagsRow(), ...fieldRows(), bodyBlock());
  $('#f-rows').replaceChildren(...kids);
}

const is = key => !!active && active.key === key;

// Only one row is open at a time, and an inline row and a field popup are never both open:
// opening either simply closes the other, whose value is already in the draft.
function openRow(key) {
  closeFieldPop(false);
  active = { key };
  fillForm();
  focusRow();
}

// Closing a row keeps what is in it: the editor has been writing into the draft all along, so
// there is nothing to accept. Clearing the field is the trashcan beside the x, and undoing the
// edit of a whole entry is the popup's own x.
function closeRow() {
  if (!active) return;
  active = null;
  fillForm();
}

// A tap that is the whole edit - the type pair, the toggle row, the scope pair - changes the
// draft and redraws, which also closes whatever row was open, whose value is already in the
// draft. Separate from closeRow because these redraw whether or not a row was open.
function redraw() {
  active = null;
  closeFieldPop(false);
  fillForm();
}

// ---- a field's own popup -------------------------------------------------------------------
// Anchored to the row that opened it, which keeps its icon, its value and its trashcan: nothing
// about the row moves, which is the whole point. The four fields behind one are those whose
// control cannot be a single line - four date and time boxes, a list of categories, a rule and
// its end condition, a number with a unit.
//
// It carries **no scrim**, unlike every other overlay in the calendar. A scrim would make the tap
// that dismisses it stop there, so moving from one field to the next would take two taps; without
// one the tap reaches the row it landed on and opens it. `justClosed` is what keeps that tap from
// reopening the field it has just closed.

function openFieldPop(f) {
  closeRow();
  popped = f.k;
  const ed = f.ed(f.k === 'when' ? null : readField(f));
  if (f.k !== 'when') live(ed.node, () => writeField(f, ed.read()));
  $('#fpop-title').textContent = f.label;
  const head = $('#fpop-title').parentElement;
  head.querySelector('.ib.bad')?.remove();
  if (f.popClear && f.set(readField(f))) head.insertBefore(clearBtn(f), $('#fpop-close'));
  $('#fpop-body').replaceChildren(ed.node);
  // The anchor is looked up rather than passed in: on a dismissing tap the capture-phase
  // listener below re-renders the rows before the row's handler calls this, so a node passed in
  // from that handler is already detached and measures as zero.
  openRowPop($('#fpop'), $(`#f-rows [data-field="${f.k}"]`));
  requestAnimationFrame(() => $('#fpop').querySelector('input, select, textarea')?.focus());
}

function closeFieldPop(render = true) {
  if (popped === null) return;
  popped = null;
  $('#fpop').hidden = true;
  if (render) fillForm();            // the row reads the value the popup has just changed
}

$('#fpop-close').addEventListener('click', () => closeFieldPop());

// Capture, so this runs before the row's own click handler: the popup closes and the same tap
// then opens whatever it hit.
addEventListener('click', e => {
  if (popped === null || $('#fpop').contains(e.target)) return;
  justClosed = popped;
  closeFieldPop();
  setTimeout(() => { justClosed = null; }, 0);
}, true);

// One way in for every row: the popup for the four whose control cannot be a line, the row itself
// for the three that can.
function openField(f) {
  if (justClosed === f.k) return;    // the tap that closed it must not reopen it
  if (f.mode === 'pop') openFieldPop(f);
  else openRow(f.k);
}

const focusRow = () =>
  requestAnimationFrame(() => $('#f-rows').querySelector('input, select, textarea')?.focus());

// The disk's presence is the only thing that changes while a row is being typed into, so it is
// redrawn on its own - re-rendering the row would take the cursor with it.
const syncDisk = () => iconRow();

function live(node, apply) {
  for (const ev of ['input', 'change'])
    node.addEventListener(ev, () => { apply(); syncDisk(); });
}

// A ticked square and a calendar page choose the type on a new entry; on one that exists the
// type is a marker, shown and not pressable. Then the trashcan, the disk once there is
// something to save, and the x - rightmost in every popup in Mine.
function iconRow() {
  const kids = [];
  if (D.occ) {
    const mark = el('span', 'ib on');
    mark.title = D.type === 'task' ? 'Task' : 'Event';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', mark.title);
    mark.append(icon(D.type === 'task' ? 'check' : 'cal'));
    kids.push(mark);
  } else for (const [t, ic, label] of [['task', 'check', 'Task'], ['event', 'cal', 'Event']]) {
    const b = iconBtn(ic, label, D.type === t ? 'on' : '');
    b.setAttribute('aria-pressed', String(D.type === t));
    b.addEventListener('click', () => { D.type = t; redraw(); });
    kids.push(b);
  }
  kids.push(el('span', 'spacer'));

  if (D.occ) {
    const t = iconBtn('trash', D.occ.seriesId ? 'Delete the whole repeating entry' : 'Delete',
      'bad');
    t.addEventListener('click', () => removeEntry(D.occ));
    kids.push(t);
  }
  if (dirty()) {
    const disk = iconBtn('disk', 'Save', 'save');
    disk.type = 'submit';
    disk.disabled = !D.title.trim();
    kids.push(disk);
  }
  const x = iconBtn('x', 'Close');
  x.addEventListener('click', closePopup);
  kids.push(x);

  $('#f-icons').replaceChildren(...kids);
}

// The title is a row too: text until clicked, then an input in the same line at the same size.
// It is the one row with neither a trashcan nor an x - an entry must have a title, so there is
// nothing to clear, and the popup's own x, which discards the whole edit, is a thumb's width
// above this line. It closes on Escape, or by opening any other row.
function titleRow() {
  const row = el('div', `frow first${is('title') ? ' in' : ''}`);
  row.dataset.field = 'title';
  if (is('title')) {
    const i = el('input', 'title-in');
    i.value = D.title;
    i.placeholder = 'Title';
    live(i, () => { D.title = i.value; });
    row.append(i);
    return row;
  }
  row.append(tap(D.title || 'Untitled', !D.title, 'ttap',
    () => openRow('title'),
    `Title${D.title ? `: ${D.title}` : ''}`));
  return row;
}

// The when: one row reading the day and the times, opening the four inputs in a popup under it.
// Four input boxes at the top of a popup opened to find out what day something is on was the form
// at its least readable, and four of them cannot be a line, so they are the clearest case for the
// popup: the row goes on reading the day while they are open.
function whenRow() {
  const row = el('div', 'frow');
  row.dataset.field = 'when';
  row.append(tap(whenText(), false, 'wtap', () => openField(WHEN), `When: ${whenText()}`));
  return row;
}

function whenText() {
  const day = D.startDate ? longDayLabel(D.startDate) : 'no date';
  const when = D.allDay ? 'all-day'
    : D.endTime && D.endTime !== D.startTime ? `${D.startTime}–${D.endTime}`
      : D.startTime || '';
  return when ? `${day} · ${when}` : day;
}

// A repeating entry: the scope pair, which governs what the save writes, and the skip. Switching
// scope rebuilds the draft from the other file, so the baseline a discard is measured against
// has to be retaken with it - left behind it reads as changed, which puts a disk in the top row
// of a popup nobody has edited.
function scopeRow() {
  const wrap = el('div', 'scope');
  wrap.append(el('span', 'scope-note', 'Part of a repeating entry.'));
  const group = el('div', 'btngroup');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Edit scope');
  for (const [v, text] of [['occurrence', 'This occurrence'], ['series', 'Whole series']]) {
    const b = el('button', 'seg', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(D.scope === v));
    b.addEventListener('click', () => {
      D = draft(D.occ, v, {});
      D.clean = snapshot(D);
      redraw();
    });
    group.append(b);
  }
  const rep = el('div', 'vrep');
  const skip = el('button', 'link', 'skip this one');
  skip.type = 'button';
  skip.addEventListener('click', () =>
    run(`skip ${D.occ.title} on ${D.occ.dayKey}`, () => skipOccurrence(D.occ)));
  rep.append(group, skip);
  wrap.append(rep);
  return wrap;
}

// Five of the six fields are rows; the sixth is the body, at the foot. They are in the canonical
// order whether they are set or not. They used to be sorted set-first, which moved a row the
// moment it was filled - so the field just typed into was no longer where it had just been looked
// for, which is the same complaint the rows that grew answered.
function fieldRows() {
  return FIELDS
    .filter(f => f.k !== 'body' && (f.k !== 'recurrence' || canRule()))
    .map(f => f.mode === 'inline' && is(f.k) ? inlineRow(f) : closedRow(f));
}

function closedRow(f) {
  const row = el('div', 'frow');
  row.dataset.field = f.k;
  const set = f.set(readField(f));
  row.append(icon(f.ic));
  row.append(tap(set ? f.sum(readField(f)) : f.label, !set, '',
    () => openField(f),
    `${f.label}${set ? `: ${f.sum(readField(f))}` : ''}`));
  if (set) row.append(clearBtn(f));
  return row;
}

// An inline row: the input takes the line the value was on, at the same height, with the trashcan
// and the x where the closed row's trashcan already is. The field's name is the input's
// placeholder rather than a heading above it, because a heading was the line the row grew by and
// it named what the icon beside it already said.
function inlineRow(f) {
  const row = el('div', 'frow in');
  row.dataset.field = f.k;
  const ed = f.ed(readField(f));
  live(ed.node, () => writeField(f, ed.read()));
  const x = iconBtn('x', 'Close this field');
  x.addEventListener('click', closeRow);
  row.append(icon(f.ic), ed.node, clearBtn(f), x);
  return row;
}

// The row carries its field's key, and the button that opens it says the field's name even when
// the row shows only a value - a bell with `15 min before` beside it needs the name read out.
function tap(text, unset, cls, onClick, aria) {
  const b = el('button', ['ftap', cls, unset ? 'unset' : ''].filter(Boolean).join(' '), text);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

// Clearing a field is its row's own trashcan, and it clears the draft - nothing here writes.
// Clicking it must not also activate the row: the field is cleared and no input appears.
function clearBtn(f) {
  const b = iconBtn('trash', `Clear ${f.label.toLowerCase()}`, 'bad');
  b.addEventListener('click', e => {
    e.stopPropagation();
    writeField(f, f.empty);
    if (popped === f.k) return closeFieldPop();
    active = null;
    fillForm();
  });
  return b;
}

// The toggle row, under the when: `24h`, and on a task stage, important and estimate. A tap on
// one of them is the whole edit - into the draft, like everything else.
function flagsRow() {
  const bar = el('div', 'iconbar flags');
  bar.append(allDayBtn());
  if (D.type === 'task') bar.append(stageBtn(), bangBtn(), estBtn());
  return bar;
}

// All-day is a clickable control rather than a checkbox, and it lights with the ordinary enabled
// background - deliberately not the disk's green, which in Mine means a save.
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
    redraw();
  });
  return b;
}

// Stage, important and estimate are three small values rather than fields with a form each, so
// they are edited in the row itself. Stage and the estimate show their value as a badge on the
// icon's corner; important has nothing to put in one and lights instead. Only the estimate opens
// an editor, because a number has to be typed - and it opens in a popup under the hourglass, so
// the toggle row stays one line like every other.
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
    redraw();
  });
  return b;
}

// A toggle, not a cycle: there is no third state to reach, and no badge, because the lit state
// has already said everything a yes or no has to say.
function bangBtn() {
  const b = iconBtn('!', 'Important', D.important ? 'on' : '');
  b.setAttribute('aria-pressed', String(D.important));
  b.addEventListener('click', () => { D.important = !D.important; redraw(); });
  return b;
}

function estBtn() {
  const b = iconBtn('glass', `Estimate: ${D.estimate ? `${D.estimate} day(s)` : 'none'}`,
    popped === 'estimate' ? 'on' : '');
  b.dataset.field = 'estimate';
  if (D.estimate) badged(b, `${D.estimate}d`, 'wide');
  b.addEventListener('click', () => openField(EST));
  return b;
}

// The body, last in the popup and shown in full and rendered: two lines on a card and the whole
// text here are the difference between a glance and having opened the thing. Clicking it
// replaces the rendered nodes with the raw markdown in a textarea.
function bodyBlock() {
  const f = FIELDS.find(x => x.k === 'body');
  if (is('body')) return bodyRow(f);
  const wrap = el('div', 'vbody');
  wrap.dataset.field = 'body';
  const head = el('div', 'ftitle');
  head.append(icon('lines'), el('span', '', 'Details'), el('span', 'spacer'));
  if (f.set(D.v.body)) head.append(clearBtn(f));
  const b = el('button', 'vbody-tap');
  b.type = 'button';
  b.setAttribute('aria-label', 'Details');
  b.addEventListener('click', () => openRow('body'));
  if (f.set(D.v.body)) b.append(render(D.v.body));
  else b.append(el('span', 'ftap unset', 'Details'));
  wrap.append(head, b);
  return wrap;
}

// The body is the one field whose open shape still carries a line of its own: its editor is a
// textarea, so its name, trashcan and x cannot sit beside it. That line is the same header the
// closed body already shows, so nothing moves here either.
function bodyRow(f) {
  const row = el('div', 'frow open vbody');
  row.dataset.field = 'body';
  const ed = f.ed(D.v.body);
  live(ed.node, () => writeField(f, ed.read()));
  const head = el('div', 'ftitle');
  head.append(icon(f.ic), el('span', '', f.label), el('span', 'spacer'));
  if (f.set(D.v.body)) head.append(clearBtn(f));
  const x = iconBtn('x', 'Close this field');
  x.addEventListener('click', closeRow);
  head.append(x);
  const wrap = el('div', 'fedit');
  wrap.append(ed.node);
  row.append(head, wrap);
  return row;
}

// ---- the editors ---------------------------------------------------------------------------
// Every editor returns the bare control: an inline row puts it in the line, a popup puts it in
// its body, and only the ones with more than one control of their own wrap them in labels.

function field(labelText, control, hint, cls) {
  const l = el('label', cls || '', labelText);
  l.append(control);
  if (hint) l.append(el('small', '', hint));
  return l;
}

// A declaration, not a const arrow: FIELDS calls this while the module is still evaluating.
function textEditor(placeholder) {
  return cur => {
    const i = el('input');
    i.value = cur || '';
    i.placeholder = placeholder;
    return { node: i, read: () => i.value.trim() };
  };
}

function estimateEditor(cur) {
  const i = el('input');
  i.type = 'number';
  i.min = '0';
  i.step = '0.5';
  i.inputMode = 'decimal';
  i.placeholder = 'days';
  i.value = cur ?? '';
  return {
    node: i,
    read: () => { const n = Number(i.value); return Number.isFinite(n) && n > 0 ? n : null; }
  };
}

// A line of minutes, so the row holds it: the placeholder is the format, because `0, 15` is the
// one of the three that a field name would not have explained. That 0 means at start, and that
// nothing fires while the app is closed, is in REQUIREMENTS.md - the row has no line to say it on
// and gaining one is what this change removed.
function alertsEditor(cur) {
  const i = el('input');
  i.inputMode = 'numeric';
  i.placeholder = '0, 15';
  i.value = (cur || []).join(', ');
  return { node: i, read: () => splitList(i.value).map(Number).filter(Number.isFinite) };
}

// One line, commas between: splitList already breaks on commas, semicolons and spaces alike, so
// a file written with one address per line still reads back the same.
function participantsEditor(cur) {
  const i = el('input');
  i.spellcheck = false;
  i.autocapitalize = 'off';
  i.placeholder = 'a@b.com, c@d.com';
  i.value = (cur || []).join(', ');
  return { node: i, read: () => splitList(i.value) };
}

// The four parts of the when, in two lines of a popup. The times are typed rather than native
// `<input type="time">`: that control takes its 12- or 24-hour shape from the device's locale and
// nothing in markup, CSS or the `lang` attribute can tell it otherwise, while every other time in
// the calendar is 24-hour by construction. The dates stay native, because a date picker is worth
// more than a format and an ISO date cannot be misread.
function whenEditor() {
  const wrap = el('div');
  const date = (labelText, k) => {
    const i = el('input');
    i.type = 'date';
    i.value = D[k];
    live(i, () => { D[k] = i.value; });
    return field(labelText, i);
  };
  const time = (labelText, k) => {
    const i = el('input');
    i.inputMode = 'numeric';
    i.placeholder = '09:00';
    i.disabled = D.allDay;
    i.value = D[k];
    // Written through on every valid reading, so the disk appears as it does for any other edit,
    // and tidied on the way out: `930` leaves the field reading `09:30`.
    live(i, () => { const t = hhmm(i.value); if (t !== null) D[k] = t; });
    i.addEventListener('blur', () => { i.value = D[k]; });
    return field(labelText, i, null, 't');
  };
  const r1 = el('div', 'row2');
  r1.append(date('Start', 'startDate'), time('Time', 'startTime'));
  const r2 = el('div', 'row2');
  r2.append(date('End', 'endDate'), time('Time', 'endTime'));
  wrap.append(r1, r2);
  return { node: wrap, read: () => null };
}

// `9` and `900` and `9:00` are all 09:00; `930` and `0930` and `9:3` are 09:30. Anything that is
// not a time of day returns null, and the field goes back to what the draft still holds.
function hhmm(text) {
  const t = String(text).trim();
  if (!t) return '';
  const m = /^(\d{3,4})$|^(\d{1,2}):?(\d{0,2})$/.exec(t);
  if (!m) return null;
  const [h, min] = m[1] ? [+m[1].slice(0, -2), +m[1].slice(-2)] : [+m[2], m[3] ? +m[3] : 0];
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
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
  $('#sub-title').textContent = 'Groups';
  $('#sub-body').replaceChildren(groupList(null).node);
  $('#sub').hidden = false;
  $('#sub-scrim').hidden = false;
}

function closeSub() {
  $('#sub').hidden = true;
  $('#sub-scrim').hidden = true;
}
$('#sub-close').addEventListener('click', closeSub);
$('#sub-scrim').addEventListener('click', closeSub);

// Picking a category closes its row: there is nothing more to say about a choice from a list,
// and with no save in the row there is nothing for a second tap to press.
function groupPicker(cur) {
  return groupList(cur || '', name => {
    writeField(FIELDS.find(f => f.k === 'group'), name);
    closeFieldPop();
  });
}

function groupList(initial, onPick) {
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
      b.addEventListener('click', () => {
        chosen = name;
        if (onPick) return onPick(name);
        draw();
      });
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

// ---- saving --------------------------------------------------------------------------------

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
    if ($('#popup').hidden) S.status(`not saved: ${err.message}`, true);
    else {
      $('#f-msg').textContent = `not saved: ${err.message}`;
      $('#f-msg').className = 'msg bad';
    }
    return;
  }
  discard();
  S.model = await S.reload();
  S.render();
  S.push(`calendar: ${what}`);
}
