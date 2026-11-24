// The four calendar views. All of them show seven columns beginning with the configured first
// day of the week, with Saturday and Sunday tinted wherever they land - a Saturday task has to
// be visible.
import {
  occurrences, timeLabel, todayKey, isoWeek, monthGrid, addDays, partsOf, weekStartOf,
  isAllDay, patchOccurrence, byStart, covers, pad
} from './data.js';
import {
  S, $, el, phone, colorOf, labelOf, inkOn, longDayLabel, viewRange, isWeekend, weekLetters,
  openCentred, closePops
} from './ui.js';
import { openEntry, openNew } from './popup.js';
import { weekdayName } from '../shared/prefs.js';

// What the range holds, honouring the group filter, recorded for click handling.
export function collect(from, to) {
  const out = [];
  S.visible = new Map();
  for (const o of occurrences(S.model, from, to)) {
    if (S.hidden.has(o.group || '')) continue;
    S.visible.set(o.key, o);
    out.push(o);
  }
  return out;
}

// An entry is listed under **every day it covers**, not only the day it starts: a trip is on
// screen in the middle of itself, which is the whole of what a span is for. The same occurrence
// object is listed under each day - one entry, one key, one click - and the day it is being
// drawn for is passed to whatever draws it.
const spans = o => o.endDayKey > o.dayKey;

// Spans first in a day, so a run of them reads as one band across the cells, then all-day, then
// by time - the order byStart already gives.
const bySpan = (a, b) => (spans(b) ? 1 : 0) - (spans(a) ? 1 : 0) || byStart(a, b);

const groupByDay = (items, from, to) => {
  const m = new Map();
  for (const o of items) {
    const first = o.dayKey < from ? from : o.dayKey;
    const last = o.endDayKey > to ? to : o.endDayKey;
    for (let k = first; k <= last; k = addDays(k, 1)) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
  }
  for (const list of m.values()) list.sort(bySpan);
  return m;
};

// What a day shows of an entry's time: the start on the day it starts, the end on the day it
// ends - with an arrow, because `17:00` alone on the third day of a trip reads as its start -
// and nothing on the days between.
const dayTime = (o, key) => o.allDay ? ''
  : o.dayKey === key ? timeLabel(o.start)
    : o.endDayKey === key && o.end && !isAllDay(o.end) ? `\u2192${timeLabel(o.end)}` : '';

export function renderView(host) {
  const [from, to] = viewRange();
  const byDay = groupByDay(collect(from, to), from, to);
  const mode = S.view.mode;
  host.className = `view v${mode}`;
  if (mode === 'Y') host.replaceChildren(yearGrid(byDay));
  else if (mode === 'M') host.replaceChildren(...monthView(byDay));
  else host.replaceChildren(timeGrid(mode === 'W' ? weekKeys() : [S.view.anchor], byDay));
  if (!$('#day-pop').hidden) fillDayPop($('#day-pop').dataset.day);
}

const weekKeys = () => {
  const a = weekStartOf(S.view.anchor, S.prefs.weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(a, i));
};

// ---- month ---------------------------------------------------------------------------------

function monthView(byDay) {
  const [y, m] = partsOf(S.view.anchor);
  const cells = monthGrid(y, m - 1, S.prefs.weekStart);
  const gut = S.prefs.showWeeks;
  const cap = phone() ? 2 : 4;

  const head = el('div', `weekhead${gut ? ' gut' : ''}`);
  if (gut) head.append(el('span', 'wk', ''));
  head.append(...weekLetters().map(([n, we]) => el('span', we ? 'we' : '', n)));

  const grid = el('div', `grid${gut ? ' gut' : ''}`);
  for (let i = 0; i < cells.length; i += 7) {
    // The row's fourth day, not its first. ISO weeks are defined on Monday-start weeks, so a
    // Sunday-start row holds one day of one ISO week and six of the next; the fourth day is in
    // the second either way, which is the number the row reads as.
    if (gut) grid.append(el('span', 'wk', String(isoWeek(addDays(cells[i], 3)))));
    for (const k of cells.slice(i, i + 7))
      grid.append(monthCell(k, m, byDay.get(k) || [], cap));
  }
  return [head, grid];
}

function monthCell(key, month, items, cap) {
  const [, m, d] = partsOf(key);
  const cell = el('div', ['day', isWeekend(key) ? 'we' : '', m !== month ? 'out' : '',
    key === todayKey() ? 'today' : ''].filter(Boolean).join(' '));
  cell.dataset.day = key;
  cell.append(el('span', 'num', String(d)));
  const rows = el('div', 'rows');
  // No done-rectangle in the month view: that width goes to the title instead.
  for (const o of items.slice(0, cap)) rows.append(entryLine(o, key, false));
  if (items.length > cap) rows.append(el('div', 'more', `+${items.length - cap}`));
  cell.append(rows);
  return cell;
}

// A small line carrying the title on the group's background colour. `tick` is false in the
// month view, where the width goes to the title; everywhere else a task keeps its one-tap done.
//
// A line for a day the entry only passes through is **flat on the side it continues**, so a run
// of cells reads as one bar with two rounded ends. The title is repeated on every day rather
// than drawn once across them: on a phone a true bar shows its title in the first column only,
// and the middle of a trip is exactly where you look to find out what it is.
function entryLine(o, key, tick = true) {
  const r = el('div', ['eline', o.stage === 'done' ? 'done' : '',
    o.dayKey < key ? 'from-before' : '', o.endDayKey > key ? 'goes-on' : '']
    .filter(Boolean).join(' '));
  r.dataset.key = o.key;
  const c = colorOf(o.group);
  r.style.background = c;
  r.style.color = inkOn(c);
  const when = dayTime(o, key);
  if (when) r.append(el('span', 'when', when));
  r.append(el('span', 'what', o.title));
  if (tick && o.type === 'task') r.append(tickButton(o));
  return r;
}

// The rectangular icon that moves a task straight to done, and back to todo.
function tickButton(o) {
  const t = el('button', `tick${o.stage === 'done' ? ' on' : ''}`);
  t.type = 'button';
  t.dataset.tick = o.key;
  t.setAttribute('aria-label', o.stage === 'done'
    ? `Move "${o.title}" back to todo` : `Move "${o.title}" to done`);
  return t;
}

// ---- year ----------------------------------------------------------------------------------
// A year cell has no room for a title, so a day with entries takes its group's background
// colour, split between colours where there are several.

function yearGrid(byDay) {
  const [y] = partsOf(S.view.anchor);
  const wrap = el('div', 'year');
  const letters = weekLetters();
  for (let m = 0; m < 12; m++) {
    const box = el('div', 'ymonth');
    // The caption reads as a caption but is a button: clicking it zooms into that month, and
    // the whole label is the target, because a day in a year grid is not finger-sized.
    const cap = el('button', 'ycap',
      new Date(y, m, 1, 12).toLocaleDateString(undefined, { month: 'long' }));
    cap.type = 'button';
    cap.dataset.month = String(m + 1);
    box.append(cap);
    const g = el('div', 'ygrid');
    g.append(...letters.map(([n, we]) => el('span', `ywh${we ? ' we' : ''}`, n)));
    for (const k of monthGrid(y, m, S.prefs.weekStart)) {
      const [, mm, dd] = partsOf(k);
      const c = el('button', ['yday', mm !== m + 1 ? 'out' : '', k === todayKey() ? 'today' : '']
        .filter(Boolean).join(' '), String(dd));
      c.type = 'button';
      c.dataset.day = k;
      const colors = [...new Set((byDay.get(k) || []).map(o => colorOf(o.group)))].slice(0, 4);
      if (colors.length && mm === m + 1) {
        c.style.background = splitBg(colors);
        c.style.color = inkOn(colors[0]);
      }
      g.append(c);
    }
    box.append(g);
    wrap.append(box);
  }
  return wrap;
}

const splitBg = colors => colors.length === 1 ? colors[0]
  : `linear-gradient(90deg, ${colors.map((c, i) =>
      `${c} ${i * 100 / colors.length}% ${(i + 1) * 100 / colors.length}%`).join(', ')})`;

// ---- week and day --------------------------------------------------------------------------
// Columns are the days, rows are the 24 hours. The day view is the same grid for one day, which
// leaves each block wide enough to carry its time, group and location.

function timeGrid(keys, byDay) {
  const wrap = el('div', 'tg');
  wrap.style.setProperty('--cols', String(keys.length));

  // The day view has no header row at all: its weekday and date are the period label in the top
  // pane already, and `TUE 20` directly beneath that label was the same fact twice. The week's
  // seven stay - they name seven days the pane names none of, and one of them opens the day
  // preview. Each row carries its own column template, so dropping this one shifts nothing.
  const head = keys.length === 1 ? null : el('div', 'tg-head');
  if (head) {
    head.append(el('span', 'tcorner'));
    for (const k of keys) {
      const h = el('div', ['tgd', isWeekend(k) ? 'we' : '', k === todayKey() ? 'today' : '']
        .filter(Boolean).join(' '));
      h.dataset.day = k;
      h.append(el('span', 'dw', weekdayName(k, 'short')), el('span', 'dn', String(partsOf(k)[2])));
      head.append(h);
    }
  }

  // The top row holds the all-day entries **and the spans**, timed or not: an entry that runs
  // past midnight has no place in a column of hours, and a bar continued across the strip is
  // where a span is read in every other view too. The corner is bare now - the row is no longer
  // the all-day row alone.
  const strip = el('div', 'tg-allday');
  strip.append(el('span', 'tcorner'));
  for (const k of keys) {
    const c = el('div', `adcell${isWeekend(k) ? ' we' : ''}`);
    c.dataset.day = k;
    c.dataset.allday = '1';
    for (const o of (byDay.get(k) || []).filter(o => o.allDay || spans(o)))
      c.append(entryLine(o, k));
    strip.append(c);
  }

  const body = el('div', 'tg-body');
  const hours = el('div', 'hours');
  for (let h = 0; h < 24; h++) hours.append(el('span', 'hr', `${pad(h)}:00`));
  body.append(hours);
  for (const k of keys) {
    const col = el('div', `tcol${isWeekend(k) ? ' we' : ''}`);
    col.dataset.day = k;
    for (const o of (byDay.get(k) || []).filter(o => !o.allDay && !spans(o)))
      col.append(timeBlock(o, keys.length === 1));
    body.append(col);
  }

  wrap.append(...[head, strip, body].filter(Boolean));
  return wrap;
}

function timeBlock(o, detailed) {
  const b = el('div', `tev${o.stage === 'done' ? ' done' : ''}`);
  b.dataset.key = o.key;
  const c = colorOf(o.group);
  b.style.background = c;
  b.style.color = inkOn(c);
  b.style.top = `${o.minutes / 1440 * 100}%`;
  b.style.height = `${Math.min(1440 - o.minutes, minutes(o)) / 1440 * 100}%`;
  b.append(el('span', 'when', o.end && !isAllDay(o.end)
    ? `${timeLabel(o.start)}–${timeLabel(o.end)}` : timeLabel(o.start)));
  b.append(el('span', 'what', o.title));
  if (detailed) {
    const meta = [labelOf(o.group), o.location, o.seriesId ? 'repeats' : ''].filter(Boolean);
    if (meta.length) b.append(el('span', 'meta', meta.join(' · ')));
  }
  if (o.type === 'task') b.append(tickButton(o));
  return b;
}

// How tall a block is. No end, or an end that is not an instant, reads as an hour.
function minutes(o) {
  if (!o.end || isAllDay(o.end)) return 60;
  const ms = Date.parse(o.end) - Date.parse(o.start);
  return Number.isFinite(ms) && ms > 0 ? Math.max(25, ms / 60000) : 60;
}

// ---- the day preview -----------------------------------------------------------------------

export function openDayPop(key) {
  closePops();
  $('#day-pop').dataset.day = key;
  fillDayPop(key);
  openCentred($('#day-pop'));
}

function fillDayPop(key) {
  $('#day-title').textContent = longDayLabel(key);
  const items = [...S.visible.values()].filter(o => covers(o, key, key)).sort(bySpan);
  const list = $('#day-list');
  if (!items.length) return list.replaceChildren(el('p', 'day-empty', 'Nothing on this day.'));
  list.replaceChildren(...items.map(o => {
    const row = el('div', `dentry${o.stage === 'done' ? ' done' : ''}`);
    row.dataset.key = o.key;
    const bar = el('span', 'bar');
    bar.style.background = colorOf(o.group);
    const mid = el('div', 'mid');
    mid.append(el('span', 'dt', [o.allDay ? 'all-day' : dayTime(o, key) || 'continues',
      labelOf(o.group), o.type === 'task' ? o.stage : '',
      o.seriesId ? 'repeats' : ''].filter(Boolean).join(' · ')));
    mid.append(el('span', 'dn', o.title));
    row.append(bar, mid);
    if (o.type === 'task') row.append(tickButton(o));
    return row;
  }));
}

// ---- clicks --------------------------------------------------------------------------------

export function wireView() {
  $('#view').addEventListener('click', onClick);
  $('#day-list').addEventListener('click', onClick);
  $('#day-add').addEventListener('click', () => openNew({ dayKey: $('#day-pop').dataset.day }));
  $('#day-close').addEventListener('click', closePops);
}

function onClick(e) {
  const cap = e.target.closest('[data-month]');
  if (cap) return openMonth(Number(cap.dataset.month));

  const tick = e.target.closest('[data-tick]');
  if (tick) return tickTask(S.visible.get(tick.dataset.tick));
  // A control inside an entry has already done its job - a kanban card's stage arrows are the
  // only ones that reach here - so the click must not also open the entry on top of the move.
  const row = e.target.closest('[data-key]');
  if (row && e.target.closest('button')) return;
  if (row) return openEntry(S.visible.get(row.dataset.key));

  const cell = e.target.closest('[data-day]');
  if (!cell) return;
  const key = cell.dataset.day;
  if (S.view.mode === 'Y') return openDayPop(key);
  if (S.view.mode === 'M') return phone() ? openDayPop(key) : openNew({ dayKey: key });
  if (cell.dataset.allday) return openNew({ dayKey: key, allDay: true });
  if (!cell.classList.contains('tcol')) return openDayPop(key);     // the day header
  const r = cell.getBoundingClientRect();
  openNew({ dayKey: key, hour: Math.max(0, Math.min(23,
    Math.floor((e.clientY - r.top) / r.height * 24))) });
}

// Zooming from the year view into the month that was clicked, not the one the anchor is in.
function openMonth(month) {
  closePops();
  S.view.mode = 'M';
  S.view.anchor = `${partsOf(S.view.anchor)[0]}-${pad(month)}-01`;
  S.render();
}

// The change is in the local mirror before the push is attempted, so the view is right either
// way: offline it stays on screen and the queue carries it.
async function tickTask(o) {
  if (!o || o.type !== 'task') return;
  const stage = o.stage === 'done' ? 'todo' : 'done';
  await patchOccurrence(o, { stage });
  S.model = await S.reload();
  S.render();
  S.push(`calendar: ${o.title} -> ${stage}`);
}
