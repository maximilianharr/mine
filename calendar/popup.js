// One popup for an entry, read and written in the same rows. A row is text until it is clicked;
// then it holds the control for its value - and it holds it **without changing shape**. A row
// that grew a heading and a control beneath it moved every row under it and sent the eye hunting
// for the field it had just tapped, which is the one thing a popup opened to type one word must
// not do. So a row that can hold its control on one line does (the title, location, alerts and
// participants are an input in the line, with the field's name as the placeholder), and a row
// whose control cannot be a line opens that control in a small popup anchored to the row, which
// is left exactly as it was (the when, the category and the repetition).
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
  isAllDay, todayKey, toInstant, wallParts, dowOf, partsOf, addMonths, STAGES, pad, list,
  createEntry, updateEntry, deleteEntry, saveOverride, skipOccurrence, createGroup, saveGroups
} from './data.js';
import { setKV } from '../shared/store.js';
import { render } from '../shared/markdown.js';
import {
  S, $, el, icon, iconBtn, colorOf, inkOn, labelOf, dayLabel, shortDayLabel, openRowPop, monthDays,
  STAGE_COLOR, STAGE_LABEL
} from './ui.js';
import { parseDateText, dateTextOf, datePlaceholder } from '../shared/prefs.js';

const splitList = v => String(v).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

// Keys the form owns: cleared from the file's data before collect() writes them back, so
// anything else - exdate, rdate, status, a hand-added key - survives a save untouched.
const FORM_KEYS = ['title', 'type', 'start', 'end', 'stage', 'important',
  'group', 'location', 'recurrence', 'alerts', 'participants'];

let D = null;        // the draft
let active = null;   // the row holding an inline input: { key }
let popped = null;   // the key whose anchored popup is open
let popAnchor = null;    // the selector of the icon or row it hangs off
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
  { k: 'recurrence', ic: 'repeat', label: 'Repeat', empty: '', mode: 'flow',
    set: v => !!v, sum: v => ruleText(v), steps: repeatSteps },
  { k: 'alerts', ic: 'bell', label: 'Alerts', empty: [], mode: 'pop',
    set: v => v.length > 0, sum: v => alertsText(v), ed: alertPicker },
  { k: 'location', ic: 'pin', label: 'Location', empty: '', mode: 'inline',
    set: v => !!v, sum: v => v, ed: textEditor('Location') },
  { k: 'participants', ic: 'person', label: 'Participants', empty: [], mode: 'inline',
    set: v => v.length > 0, sum: v => v.join(', '), ed: participantsEditor }
];

const readField = f => D.v[f.k];
const writeField = (f, v) => { D.v[f.k] = v; };

// The five an entry is ever given, and `none`, which is how an alert is taken off from the icon
// row - there is no trashcan beside an icon. A file may hold anything, several alerts or a
// number that is not among these, and that is read, shown and written back as it stands.
const ALERTS = [[0, 'at start'], [5, '5 min before'], [15, '15 min before'],
  [60, '1 hour before'], [1440, '1 day before']];
const alertText = n => (ALERTS.find(([v]) => v === n) || [, `${n} min before`])[1];
const alertsText = list => list.map(alertText).join(', ');
const oneOfOurs = list => list.length === 1 && ALERTS.some(([v]) => v === list[0]);

// Only the series carries the rule: an occurrence override must never rewrite it.
const canRule = () => !D.occ || D.scope === 'series' || !D.occ.seriesId;

// The scope pair governs the trashcan as well as the disk. `this` skips the one occurrence -
// which is what the `skip this one` link beside the pair used to do - and `all` deletes the rule
// file. One choice, read by both writes in the row it sits in.
const skipping = () => !!D.occ && !!D.occ.seriesId && D.scope === 'occurrence';

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
const snapshot = d => JSON.stringify([d.type, d.stage, d.important, d.title,
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
  flow = null;
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

// Enter in a row's editor closes the row; it does not submit. The editor has been writing into
// the draft all along, so there is nothing for Enter to accept - and the key that ends a word
// must not also commit the entry and close the popup. Shift+Enter is handed straight back to the
// browser, whose own default is what puts a new line in the body's textarea, which is the whole
// reason that case is a bail-out and not code. `#fpop` lives outside `#f-rows`, so a field's own
// popup is untouched: it still closes by its x or by Escape.
$('#f-rows').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;   // a row's own buttons still work
  e.preventDefault();
  closeRow();
});

// ---- rows ----------------------------------------------------------------------------------
// A row is the icon, then the value - no field name beside it. Clicking it opens its control
// without moving the row: an input in the line, or a popup anchored under it.
//
// An open editor writes into the draft as it is typed, which is what lets the disk appear the
// moment something differs from the file without the row being re-rendered under the cursor -
// and it is what makes closing a row keep what was typed without a save to press.

// The title, the when, the icon row - and then, only when the chevron is open, a line per icon
// naming what it holds. The location, the participants and the details are lines either way: a
// pin standing in for an address says only that there is one, which is the thing a row of icons
// is for and these three are not.
function fillForm() {
  iconRow();
  const rows = [titleRow(), whenRow(), quickRow()];
  if (S.prefs.popupExpanded) rows.push(...namedRows());
  rows.push(...fieldRows(LINE_FIELDS), bodyBlock());
  $('#f-rows').replaceChildren(...rows);
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
// about the row moves, which is the whole point. The fields behind one are those whose control
// cannot be a single line - a list of categories, a rule and its end condition - and the when,
// whose steps are below rather than here, because it is a walk and not one control.
//
// It carries **no scrim**, unlike every other overlay in the calendar. A scrim would make the tap
// that dismisses it stop there, so moving from one field to the next would take two taps; without
// one the tap reaches the row it landed on and opens it. `justClosed` is what keeps that tap from
// reopening the field it has just closed.

function openFieldPop(f, sel) {
  closeRow();
  popped = f.k;
  popAnchor = sel;
  flow = null;
  const ed = f.ed(f.k === 'when' ? null : readField(f));
  if (f.k !== 'when') live(ed.node, () => writeField(f, ed.read()));
  $('#fpop-title').textContent = f.label;
  const head = $('#fpop-title').parentElement;
  $('#fpop-body').replaceChildren(ed.node);
  // A selector, not the node: on a dismissing tap the capture-phase listener below re-renders
  // the rows before the row's handler calls this, so a node passed in from that handler is
  // already detached and measures as zero. It names which of the two opened it, because with
  // the chevron open a field has both an icon and a row and the popup belongs under the one
  // that was tapped.
  openRowPop($('#fpop'), $(popAnchor));
  requestAnimationFrame(() => $('#fpop').querySelector('input, select, textarea')?.focus());
}

function closeFieldPop(render = true) {
  if (popped === null) return;
  popped = null;
  flow = null;
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

// One way in for every field, from its icon or from its row: the popup for those whose control
// cannot be a line, the row itself for those that can.
const anchorSel = (key, from) => from === 'quick'
  ? `#f-rows .quick [data-field="${key}"]` : `#f-rows .frow[data-field="${key}"]`;

function openField(f, from) {
  if (justClosed === f.k) return;    // the tap that closed it must not reopen it
  if (f.mode === 'flow') startFlow(f.k, anchorSel(f.k, from), f.steps(), 0);
  else if (f.mode === 'pop') openFieldPop(f, anchorSel(f.k, from));
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
// type is a marker, shown and not pressable. On a repeating entry the scope pair follows it.
// Then the trashcan, the disk once there is something to save, and the x - rightmost in every
// popup in Mine.
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
  if (D.occ && D.occ.seriesId) kids.push(scopePair());
  kids.push(el('span', 'spacer'));

  if (D.occ) {
    const t = iconBtn('trash', !D.occ.seriesId ? 'Delete'
      : skipping() ? 'Skip this occurrence' : 'Delete every occurrence', 'bad');
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

// A repeating entry's one choice about one write, in the row with the two controls it governs:
// `this` writes an override for this occurrence and skips it on the trashcan, `all` rewrites the
// rule file and deletes it. It reads `this` and `all` and not the noun, because the noun is a
// task on one entry and an event on the next while the marker beside it already says which.
//
// Switching it rebuilds the draft from the other file, so the baseline a discard is measured
// against has to be retaken with it - left behind it reads as changed, which puts a disk in the
// top row of a popup nobody has edited.
function scopePair() {
  const group = el('div', 'btngroup');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Edit scope');
  for (const [v, text, aria] of [['occurrence', 'this', 'This occurrence'],
    ['series', 'all', 'All occurrences']]) {
    const b = el('button', 'seg', text);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.setAttribute('aria-pressed', String(D.scope === v));
    b.addEventListener('click', () => {
      D = draft(D.occ, v, {});
      D.clean = snapshot(D);
      redraw();
    });
    group.append(b);
  }
  return group;
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

// The when: one row with two halves, each the way into the flow that sets it. On one day it
// reads `THU, 19.11.26 15:00–17:00`, the end half being the end time alone - the date is the
// same one. Across days it reads two whole datings, start left and end right, because a date on
// both sides is the only thing that tells a span from a day; they wrap rather than shrink, so
// the end drops to a second line, still right, where the two do not fit one.
function whenRow() {
  const row = el('div', 'frow wrow');
  row.dataset.field = 'when';
  const { start, end, span } = whenParts();
  row.append(tap(start, false, 'wtap', () => openWhen('start'), `Start: ${start}`));
  if (!end) return row;
  if (!span) row.append(el('span', 'wdash', '–'));
  row.append(tap(end, false, `wtap${span ? ' wend' : ''}`, () => openWhen('end'), `End: ${end}`));
  return row;
}

// No time where there is none: an all-day entry reads as its dates, and the lit 24h beside the
// row is what says so - a word there would say it twice. An entry with no end reads as its
// start alone, with no dash left dangling.
function whenParts() {
  if (!D.startDate) return { start: 'no date', end: '', span: false };
  const at = (date, time) => `${shortDayLabel(date)}${D.allDay || !time ? '' : ` ${time}`}`;
  const span = !!D.endDate && D.endDate !== D.startDate;
  const start = at(D.startDate, D.startTime);
  if (span) return { start, end: at(D.endDate, D.endTime), span };
  const end = !D.allDay && D.endTime && D.endTime !== D.startTime ? D.endTime : '';
  return { start, end, span };
}

// The three the icon row stands in for, and the two it never could. The body is neither: it is
// drawn at the foot. They are in the canonical order whether they are set or not - sorting them
// set-first moved a row the moment it was filled, so the field just typed into was no longer
// where it had just been looked for.
const ICON_FIELDS = ['group', 'recurrence', 'alerts'];
const LINE_FIELDS = ['location', 'participants'];

function fieldRows(keys) {
  return FIELDS
    .filter(f => keys.includes(f.k) && (f.k !== 'recurrence' || canRule()))
    .map(f => f.mode === 'inline' && is(f.k) ? inlineRow(f) : closedRow(f));
}

// What the chevron shows: the same values the icon row holds, as lines with their names, in the
// order the icons are in. The two toggles share the first line - neither fills one on its own -
// and the stage reads the word rather than a colour.
function namedRows() {
  const out = [chipsRow()];
  if (D.type === 'task') out.push(stageRow());
  return [...out, ...fieldRows(ICON_FIELDS)];
}

// The category's ball is drawn in the colour of the category it holds: a field's icon saying
// which value it has rather than only that it has one, which is the one thing a ball can say and
// its name cannot. Unset, it is the row's ink like every other icon - a grey ball would be
// indistinguishable from a group somebody coloured grey.
function fieldIcon(f) {
  const n = icon(f.ic);
  if (f.k === 'group' && D.v.group) n.style.color = colorOf(D.v.group);
  return n;
}

function closedRow(f) {
  const row = el('div', 'frow');
  row.dataset.field = f.k;
  const set = f.set(readField(f));
  row.append(fieldIcon(f));
  row.append(tap(set ? f.sum(readField(f)) : f.label, !set, '',
    () => openField(f, 'row'),
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
  row.append(fieldIcon(f), ed.node, clearBtn(f), x);
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

// One row of icons under the when, and the whole of the popup's small print: all-day, the
// stage, important, the category, the repetition and the alerts, with no names beside them.
// Six icons are one line at 320px where six named rows are most of a screen, and the popup is
// opened far more often to read an entry than to fill one in.
//
// **A tap on an icon is the tap on its row.** The two toggles flip where they stand, the stage
// cycles, and the three fields open the same popup their line opens - so the chevron below
// changes what is written down, never what anything does.
function quickRow() {
  const bar = el('div', 'iconbar quick');
  bar.append(allDayBtn());
  if (D.type === 'task') bar.append(stageBtn());
  bar.append(bangBtn());
  for (const f of FIELDS.filter(f => ICON_FIELDS.includes(f.k)
    && (f.k !== 'recurrence' || canRule()))) bar.append(quickBtn(f));
  bar.append(el('span', 'spacer'), expandBtn());
  return bar;
}

// A field as an icon: lit when it holds something, because with the name gone the lit state is
// all that is left to say so, and the value itself is in the label a screen reader and a hover
// both read.
//
// **A lit icon lights in its field's own colour**, which is `--on` - the category's colour for
// the category, the accent for every other field. The category is the one that says more again:
// the ball on top is knocked out in whatever reads on that colour, so the icon carries the
// category twice over and does not need a name beside it.
function quickBtn(f) {
  const v = readField(f);
  const set = f.set(v);
  const b = iconBtn(f.ic, `${f.label}${set ? `: ${f.sum(v)}` : ''}`,
    set || popped === f.k ? 'on' : '');
  b.dataset.field = f.k;
  if (f.k === 'group' && D.v.group) {
    const c = colorOf(D.v.group);
    b.style.setProperty('--on', c);
    b.querySelector('svg').style.color = inkOn(c);
  } else {
    b.style.setProperty('--on', 'var(--link)');
  }
  b.addEventListener('click', () => openField(f, 'quick'));
  return b;
}

// The chevron: down for a row of icons, up for the lines. It is remembered per device, like the
// board's orientation - someone who wants the names wants them every time - and it is both the
// way out and the way back in, which is the rule every switch in Mine holds to.
function expandBtn() {
  const open = S.prefs.popupExpanded;
  const b = iconBtn('chev', open ? 'Hide the field names' : 'Show the field names',
    `more${open ? ' open' : ''}`);
  b.setAttribute('aria-expanded', String(open));
  b.addEventListener('click', () => {
    S.prefs.popupExpanded = !open;
    redraw();
    setKV('calendar.popupExpanded', !open);
  });
  return b;
}

// All-day and important on one line: two yeses and noes, each an icon and its word, lit when on
// and plain when off. There is nothing to clear and nothing to open, so the line carries neither
// a trashcan nor an x - and neither value fills a row of its own.
function chipsRow() {
  const row = el('div', 'frow chips');
  row.append(chip('24h', 'All-day', D.allDay, toggleAllDay, 'var(--link)'),
    chip('!', 'Important', D.important,
      () => { D.important = !D.important; redraw(); }, 'var(--bad)'));
  return row;
}

// The same two values the icons above carry, and the same colours: a lit chip is a tint of its
// own `--on` rather than a solid, because a chip carries a word as well as a glyph.
function chip(glyph, text, on, onClick, colour) {
  const b = el('button', `fchip${on ? ' on' : ''}`);
  b.style.setProperty('--on', colour);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', text);
  b.append(el('span', 'glyph', glyph), el('span', '', text));
  b.addEventListener('click', onClick);
  return b;
}

// The stage as a line, reading the stage it is in. Tapping it cycles, exactly as the icon above
// does: a list of three would be a second way to set one value, and the line is a name for what
// the colour already says.
function stageRow() {
  const row = el('div', 'frow');
  row.dataset.field = 'stage';
  const ic = icon('ticked');
  ic.style.color = STAGE_COLOR[D.stage];
  row.append(ic, tap(STAGE_LABEL[D.stage], false, '', cycleStage,
    `Stage: ${STAGE_LABEL[D.stage]}`));
  return row;
}

// All-day is a clickable control rather than a checkbox, and it lights with the ordinary enabled
// background - deliberately not the disk's green, which in Mine means a save.
//
// It reads `24h` rather than carrying an icon: every drawing of a whole day reads as something
// else, and the sun this replaces was taken for weather. Only the button says `24h` - the grids'
// strip and the prose still say all-day, which is the clearer word where there is room for it.
function allDayBtn() {
  const b = iconBtn('24h', 'All-day', D.allDay ? 'on' : '');
  b.style.setProperty('--on', 'var(--link)');
  b.setAttribute('aria-pressed', String(D.allDay));
  b.addEventListener('click', toggleAllDay);
  return b;
}

function toggleAllDay() {
  D.allDay = !D.allDay;
  if (D.allDay) { D.startTime = ''; D.endTime = ''; }
  else { D.startTime = D.startTime || '09:00'; D.endTime = D.endTime || '10:00'; }
  redraw();
}

// Stage and important are two small values rather than fields with a form each, so they are
// edited in the row itself. Stage is a ticked square carrying its own colour - the badge on its
// corner was a 16px icon with a 9px dot on it, and the colour it carried is the whole of what
// the badge was for. Important has nothing to colour and lights instead.
function stageBtn() {
  const b = iconBtn('ticked', `Stage: ${D.stage}`);
  b.querySelector('svg').style.color = STAGE_COLOR[D.stage];
  b.addEventListener('click', cycleStage);
  return b;
}

function cycleStage() {
  D.stage = STAGES[(STAGES.indexOf(D.stage) + 1) % STAGES.length];
  redraw();
}

// A toggle, not a cycle: there is no third state to reach, and no badge, because the lit state
// has already said everything a yes or no has to say.
function bangBtn() {
  const b = iconBtn('!', 'Important', D.important ? 'on' : '');
  // The red importance is drawn in everywhere else - the `!` on a card, the trashcan - so lit
  // importance is that red rather than the accent the other icons light in.
  b.style.setProperty('--on', 'var(--bad)');
  b.setAttribute('aria-pressed', String(D.important));
  b.addEventListener('click', () => { D.important = !D.important; redraw(); });
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

// ---- a field edited in steps ---------------------------------------------------------------
// `#fpop` holds one step at a time. The when walks start date, start time, end date, end time,
// one picker to a step, which is what four input boxes at the top of a popup opened to find out
// what day something is on were standing in for.
//
// Each step writes into the draft the moment it is picked, like every other editor here, so
// there is nothing to accept at the end of a flow: the x, Escape and a tap outside leave it and
// keep whatever it has already written. The head names the step and carries a `‹` on every step
// but the first, so a mis-tapped hour costs one tap rather than the walk again.
//
// **Which half of the row was tapped is which value you meant**: the start half enters at the
// start date and walks all four, the end half enters at the end date and walks the last two.
// The end half is always the end date, even on a single day where it reads a time alone - one
// rule, and the only way the end side can turn a day into a span.
//
// A step is `{ title, kind, get, set }` and nothing else: the kind picks the control, `get` is
// what it opens on, and `set` writes it. A `set` returning `'end'` closes the flow there, which
// is how `does not repeat` has no end condition to ask about.

let flow = null;   // { key, sel, steps, i, phase, month, hour, typing }

function startFlow(key, sel, steps, i) {
  closeRow();
  popped = key;
  flow = { key, sel, steps, i, phase: 0, typing: null };
  enterStep();
}

// What a step needs before it is drawn: the month a date picker opens on, which is the value
// the field holds, or - on an end with none yet - the start it may not fall before.
function enterStep() {
  const step = flow.steps[flow.i];
  flow.phase = 0;
  if (step.kind === 'date')
    flow.month = step.get() || (step.month ? step.month() : '') || todayKey();
  drawFlow();
}

// What a picked value does: write it, then walk on - or stop here, where what was picked makes
// the steps after it meaningless.
function took(v) {
  const r = flow.steps[flow.i].set(v);
  if (r === 'end') closeFieldPop(); else stepNext();
}

function drawFlow() {
  const step = flow.steps[flow.i];
  const head = $('#fpop-title').parentElement;
  head.querySelector('.ib.back')?.remove();
  if (flow.i > 0 || flow.phase > 0) {
    const b = iconBtn('chev', 'Back', 'back');
    b.addEventListener('click', stepBack);
    head.insertBefore(b, $('#fpop-title'));
  }
  $('#fpop-title').textContent = step.title;
  $('#fpop-body').replaceChildren(
    flow.typing !== null && step.kind !== 'list' ? typedNode(step)
      : step.kind === 'date' ? dateNode(step)
        : step.kind === 'time' ? timeNode(step)
          : step.kind === 'count' ? countNode(step) : listNode(step));
  openRowPop($('#fpop'), $(flow.sel));
  requestAnimationFrame(() => $('#fpop').querySelector('input')?.focus());
}

// A picked value and the step is done: there is nothing to confirm about a tap on a day. The
// last step closes the popup, which is what a flow walked to its end looks like.
//
// `typed` carries the typing on: a date reached by keyboard hands the keyboard to the time
// after it, because the hands that typed the date are not going to reach for an hour grid.
function stepNext(typed = false) {
  const next = flow.steps[flow.i + 1];
  if (!next) return closeFieldPop();
  flow.i += 1;
  flow.typing = typed && next.kind === 'time' ? '' : null;
  enterStep();
}

// Back over the minutes to the hours first, then step by step. It unwinds the walk and never
// the values: what a step wrote stays written, as it does when the popup is simply left.
function stepBack() {
  if (flow.phase > 0) { flow.phase = 0; flow.typing = null; return drawFlow(); }
  flow.i -= 1;
  flow.typing = null;
  enterStep();
}

// Every write of a date or a time goes through here, so the one rule about the pair cannot be
// written around: **an end never precedes its start**. A day earlier than the start moves to
// the start, and on one day a time earlier than the start's moves to the start's - silently,
// because the row the flow was opened from reads the clamped value the moment it closes, and
// that is the whole of the report such a slip needs.
function writeWhen(key, value) {
  D[key] = value;
  if (D.endDate && D.startDate && D.endDate < D.startDate) D.endDate = D.startDate;
  if (!D.allDay && D.endDate === D.startDate && D.startTime && D.endTime
      && D.endTime < D.startTime) D.endTime = D.startTime;
  syncDisk();
}

// An all-day entry has no times to walk: the 24h icon is how all-day is turned off, and two
// disabled boxes in the middle of a flow would be two taps that do nothing.
function whenSteps() {
  const date = (key, title) => ({ key, title, kind: 'date',
    get: () => D[key], set: v => writeWhen(key, v),
    // While the end is being picked the start is marked too, so the day the end may not fall
    // before is in the grid rather than in a rule the picker applies afterwards.
    highlight: () => (key === 'endDate' ? D.startDate : ''), month: () => D.startDate });
  const time = (key, title) => ({ key, title, kind: 'time',
    get: () => timeShown(key), set: v => writeWhen(key, v) });
  const steps = [date('startDate', 'Start date')];
  if (!D.allDay) steps.push(time('startTime', 'Start time'));
  steps.push(date('endDate', 'End date'));
  if (!D.allDay) steps.push(time('endTime', 'End time'));
  return steps;
}

function openWhen(which) {
  if (justClosed === 'when') return;         // the tap that closed it must not reopen it
  const steps = whenSteps();
  const i = which === 'end' ? steps.findIndex(st => st.key === 'endDate') : 0;
  startFlow('when', '#f-rows [data-field="when"]', steps, i);
}

// The month grid, with the month it is on paged from a line of its own above it: the popup's
// head is naming the step, so it has no room for a second pair of arrows.
function dateNode(step) {
  const wrap = el('div', 'dpick');
  const highlight = step.highlight ? step.highlight() : '';
  const [y, m] = partsOf(flow.month);
  const page = dir => {
    const b = iconBtn('chev', dir < 0 ? 'Previous month' : 'Next month',
      `pnav-b${dir > 0 ? ' next' : ''}`);
    b.addEventListener('click', () => { flow.month = addMonths(flow.month, dir); drawFlow(); });
    return b;
  };
  const nav = el('div', 'pnav');
  nav.append(page(-1), el('span', 'plabel',
    new Date(y, m - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
    page(1));
  const grid = el('div', 'pick-body days');
  grid.append(...monthDays(y, m - 1, {
    value: step.get() || '', highlight, onPick: k => took(k)
  }));
  wrap.append(nav, grid);
  return wrap;
}

// Twenty-four hours, then the four quarters of the one that was picked, reading as whole times
// rather than as bare minutes. Two taps, no scrolling, and 24-hour by construction - which a
// native time control cannot be, because it takes its shape from the device's locale.
// The hour grid opens on the value the field holds; an end with none yet opens an hour after
// the start, which is the gap every new timed entry is already given.
const timeShown = key => D[key] || (key === 'endTime' && D.startTime
  ? `${pad((+D.startTime.slice(0, 2) + 1) % 24)}:${D.startTime.slice(3)}` : '09:00');

function timeNode(step) {
  const cur = step.get();
  if (flow.phase === 0) {
    const grid = el('div', 'hgrid');
    for (let h = 0; h < 24; h++) {
      const b = el('button', `pk${cur.slice(0, 2) === pad(h) ? ' sel' : ''}`, pad(h));
      b.type = 'button';
      b.addEventListener('click', () => { flow.hour = pad(h); flow.phase = 1; drawFlow(); });
      grid.append(b);
    }
    return grid;
  }
  const row = el('div', 'mgrid');
  for (const mm of ['00', '15', '30', '45']) {
    const t = `${flow.hour}:${mm}`;
    const b = el('button', `pk${cur === t ? ' sel' : ''}`, t);
    b.type = 'button';
    b.addEventListener('click', () => took(t));
    row.append(b);
  }
  return row;
}

// The keyboard's way through the same steps: a digit on a picker is the first character of the
// value, so the picker gives way to a box holding it. Enter takes what is in the box and moves
// on; a value that is not a date or a time of day is refused and the box goes back to what the
// draft still holds, which is the rule the typed time has always followed.
function typedNode(step) {
  const date = step.kind === 'date';
  const i = el('input');
  i.inputMode = 'numeric';
  i.placeholder = date ? datePlaceholder(S.prefs.dateFormat) : '09:00';
  i.value = flow.typing;
  i.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = date ? parseDateText(i.value, S.prefs.dateFormat, flow.month) : hhmm(i.value);
    if (!v) {
      i.value = date ? dateTextOf(step.get(), S.prefs.dateFormat) : step.get() || '';
      return;
    }
    const r = step.set(v);
    if (r === 'end') closeFieldPop(); else stepNext(true);
  });
  return i;
}

// A list of choices, the one the field holds marked: the repetition's rules and its end
// conditions. A choice the list cannot express is a row that cannot be picked, shown as the
// file writes it and kept until one that can is chosen.
function listNode(step) {
  const cur = step.get();
  const wrap = el('div', 'glist');
  for (const [v, text, locked] of step.options()) {
    const b = el('button', `gpick${v === cur ? ' on' : ''}`);
    b.type = 'button';
    b.append(el('span', '', text));
    if (locked) b.disabled = true;
    else b.addEventListener('click', () => took(v));
    wrap.append(b);
  }
  return wrap;
}

// The one step that is a number rather than a choice: how many times a repetition runs.
function countNode(step) {
  const i = el('input');
  i.type = 'number';
  i.min = '1';
  i.value = step.get() || '';
  i.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const n = Number(i.value);
    if (!Number.isInteger(n) || n < 1) return;
    took(n);
  });
  return i;
}

// A digit typed at a picker is the start of a value, in a popup where nothing else answers to
// one. It is read on the document, because a grid of buttons has no field to hold the focus.
addEventListener('keydown', e => {
  if (!flow || flow.typing !== null || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!/^[0-9]$/.test(e.key)) return;
  const step = flow.steps[flow.i];
  if (step.kind === 'count') return;               // already a box, and already answering digits
  if (step.kind === 'list' && !step.digit) return;
  e.preventDefault();
  // A number typed at the repetition's end condition is the first character of a date, so the
  // list gives way to the step that holds one rather than to a box of its own.
  if (step.kind === 'list') step.digit();
  flow.typing = e.key;
  drawFlow();
});

// ---- the editors ---------------------------------------------------------------------------
// Every editor returns the bare control: an inline row puts it in the line and a popup puts it
// in its body. None of them carries a label any more - the popup's head names what it holds.

// A declaration, not a const arrow: FIELDS calls this while the module is still evaluating.
function textEditor(placeholder) {
  return cur => {
    const i = el('input');
    i.value = cur || '';
    i.placeholder = placeholder;
    return { node: i, read: () => i.value.trim() };
  };
}

// A list, like the category's: six rows, and picking one is the whole edit. It was a line of
// minutes typed by hand, which asked for a number in a unit the field never named and let `0,
// 15` be written where almost nobody wanted two alerts.
//
// A file holding something the list cannot express - two alerts, or 30 minutes - shows it at the
// top as a **custom row that cannot be picked**, and it is written back untouched until one of
// the six is chosen. That is the treatment a hand-written repetition rule already gets, and the
// reason is the same: this app is not the only thing that may have written the file.
function alertPicker(cur) {
  const list = cur || [];
  const f = FIELDS.find(x => x.k === 'alerts');
  const wrap = el('div', 'glist');
  const add = (text, on, pick) => {
    const b = el('button', `gpick${on ? ' on' : ''}`);
    b.type = 'button';
    b.append(el('span', '', text));
    if (pick) b.addEventListener('click', pick); else b.disabled = true;
    wrap.append(b);
  };
  const take = v => () => { writeField(f, v); closeFieldPop(); };
  if (list.length && !oneOfOurs(list)) add(`custom · ${alertsText(list)}`, true, null);
  add('none', !list.length, take([]));
  for (const [n, text] of ALERTS) add(text, list.length === 1 && list[0] === n, take([n]));
  return { node: wrap, read: () => list };
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

// The bare textarea, with no name and no hint of its own: the row it opens in already carries a
// header reading DETAILS beside the same icon, so a label under it named the field twice and a
// line about raw markdown said what the monospace face says. The name lives on, unseen, for a
// screen reader, which has no header to read the textarea against.
function bodyEditor(cur) {
  const t = el('textarea');
  t.rows = 8;
  t.spellcheck = false;
  t.className = 'body-in';
  t.setAttribute('aria-label', 'Details');
  t.value = cur || '';
  return { node: t, read: () => t.value };
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
  // The end date in the format every other date on screen is in: the row sits under a when-row
  // that reads one, and an ISO date is the file's form, not the screen's.
  return ends.kind === 'until' ? `${name}, until ${dayLabel(ends.until)}`
    : ends.kind === 'count' ? `${name}, ${ends.count} times` : name;
}

// Two steps: the rule, then when it stops. The list is the choices themselves rather than a
// select inside a popup - a dropdown in a popup is two taps to see seven options, and the
// second step would have had to appear under the first instead of replacing it.
//
// The rule is one string and each step writes half of it, so the halves are held here while the
// flow walks them and the string is rebuilt on every pick: the draft is never a half-written
// rule, and leaving after the first step leaves a rule that repeats for ever, which is what
// picking a frequency and nothing else means.
function repeatSteps() {
  const startKey = D.startDate || todayKey();
  let { choice, ends } = choiceOf(D.v.recurrence, startKey);
  const kept = clean(D.v.recurrence);
  const write = () => {
    D.v.recurrence = choice === 'custom' ? kept : buildRule(choice, startKey, ends);
    syncDisk();
  };

  // `on a date` and `after n times` need a third step each, and only one of them at a time: the
  // step list grows the one that was asked for rather than carrying both and skipping one.
  const untilStep = { title: 'Ends on', kind: 'date',
    get: () => ends.until || '', month: () => startKey,
    set: v => { ends = { kind: 'until', until: v }; write(); } };
  const countStep = { title: 'Ends after', kind: 'count',
    get: () => ends.count || '',
    set: n => { ends = { kind: 'count', count: n }; write(); } };

  const rule = { title: 'Repeat', kind: 'list',
    get: () => choice,
    options: () => [
      ...(choice === 'custom' ? [['custom', `custom · ${kept}`, true]] : []),
      ...CHOICES
    ],
    set: v => {
      choice = v;
      if (v === 'none') { ends = { kind: 'never' }; write(); return 'end'; }
      write();
    } };

  const until = { title: 'Repeat until', kind: 'list',
    get: () => (ends.kind === 'count' ? 'count' : ends.kind),
    options: () => [['never', 'never'], ['until', 'on a date'], ['count', 'after n times']],
    set: v => {
      if (v === 'never') { ends = { kind: 'never' }; write(); return 'end'; }
      ends = { ...ends, kind: v === 'count' ? 'count' : 'until' };
      flow.steps = [rule, until, v === 'count' ? countStep : untilStep];
    },
    digit: () => {
      ends = { ...ends, kind: 'until' };
      flow.steps = [rule, until, untilStep];
      flow.i = 2;
      flow.month = ends.until || startKey;
    } };

  return [rule, until];
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
  if (D.type === 'task') data.stage = STAGES.includes(D.stage) ? D.stage : 'todo';
  if (D.important) data.important = true;
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

// The one trashcan, reading the scope pair beside it. Both ways ask first: a skip is reached
// from a red trashcan now rather than from a link, and it takes an override file with it, which
// no hand edit of the rule file puts back.
function removeEntry(occ) {
  if (skipping()) {
    if (!confirm(`Skip "${occ.title}" on ${occ.dayKey}?`)) return;
    return run(`skip ${occ.title} on ${occ.dayKey}`, () => skipOccurrence(occ));
  }
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
