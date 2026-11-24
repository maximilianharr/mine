// The bits every view needs: DOM helpers, the icon set, and the mutable state.
//
// State lives in one object rather than being threaded through every function, and `S.render`
// / `S.status` / `S.push` are slots the shell fills in, so a view can ask for a redraw or a
// background push without importing app.js back.
import {
  todayKey, DEFAULT_ANCHOR, groupColor, groupLabel, monthGrid, weekStartOf, addDays, partsOf,
  dowOf, sprintRange, sprintOf
} from './data.js';
import { formatDate, weekdayName } from '../shared/prefs.js';

export const $ = s => document.querySelector(s);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const phone = () => !matchMedia('(min-width: 600px)').matches;

export const S = {
  model: { groups: {}, dated: [], rules: [], overrides: new Map(),
           settings: { anchor: DEFAULT_ANCHOR, interval: 2 } },
  view: { mode: 'M', anchor: todayKey(), sprint: 1, col: 0 },
  prefs: { weekStart: 1, showWeeks: false, confirmDiscard: true, timeZone: '',
           theme: 'system', dateFormat: 'auto', boardOrientation: 'horz' },
  hidden: new Set(),                 // group names switched off in the filter
  kfilter: { importantOnly: false, assignee: '' },   // kanban only
  visible: new Map(),                // occurrence key -> occurrence, for what is on screen
  render: () => {},
  status: () => {},
  push: () => {},
  refresh: async () => {},
  reload: async () => S.model
};

// The kanban's column colours. In ui.js rather than kanban.js because the entry popup's stage
// button carries the same three, and one table is the only way they cannot drift apart.
export const STAGE_COLOR = { todo: '#c0392b', doing: '#e0a500', done: '#27ae60' };

export const colorOf = g => groupColor(S.model.groups, g);
export const labelOf = g => groupLabel(S.model.groups, g);
export const dayLabel = key => formatDate(key, S.prefs.dateFormat);
export const longDayLabel = key => `${weekdayName(key)}, ${formatDate(key, S.prefs.dateFormat)}`;

// Text on a group-coloured background. Luminance rather than a fixed colour, because the
// groups are user-chosen and a light one would otherwise carry white text.
export function inkOn(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255 || 0);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1b1f24' : '#fff';
}

// The inclusive day range the current view shows.
export function viewRange() {
  const { mode, anchor, sprint } = S.view;
  if (mode === 'D') return [anchor, anchor];
  if (mode === 'W') { const a = weekStartOf(anchor, S.prefs.weekStart); return [a, addDays(a, 6)]; }
  if (mode === 'M') {
    const [y, m] = partsOf(anchor);
    const g = monthGrid(y, m - 1, S.prefs.weekStart);
    return [g[0], g[g.length - 1]];
  }
  if (mode === 'Y') { const [y] = partsOf(anchor); return [`${y}-01-01`, `${y}-12-31`]; }
  const r = sprintRange(sprint, S.model.settings);
  return [r.start, r.end];
}

export const isWeekend = key => dowOf(key) % 6 === 0;

// Locale narrow weekday names with a weekend flag, rotated to the configured first day of the
// week. 2026-01-05 is a Monday. The grids tint the weekend; the picker takes the names alone.
export const weekLetters = () => {
  const base = weekStartOf('2026-01-05', S.prefs.weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(base, i);
    return [weekdayName(k, 'narrow'), isWeekend(k)];
  });
};

export const currentSprint = () => sprintOf(todayKey(), S.model.settings) || 1;

// ---- icons ---------------------------------------------------------------------------------
// Hand-drawn on a 16x16 box. No icon font and no CDN: the CSP allows neither, and an inline
// path cannot fail to load.

const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  repeat: { d: 'M2.6 8.4A5.4 5.4 0 0 1 12.6 5.6M13.4 7.6A5.4 5.4 0 0 1 3.4 10.4M12.9 2.6v3.2H9.7M3.1 13.4v-3.2h3.2', stroke: 1.5 },
  ball:   { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6z' },
  cal:    { d: 'M2.8 4.6h10.4v8.8H2.8zM2.8 7.4h10.4M5.6 2.6v3M10.4 2.6v3', stroke: 1.4 },
  pin:    { d: 'M8 1.4a4.4 4.4 0 0 0-4.4 4.4C3.6 9.2 8 14.6 8 14.6s4.4-5.4 4.4-8.8A4.4 4.4 0 0 0 8 1.4zm0 6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z' },
  bell:   { d: 'M8 1.6a3.6 3.6 0 0 0-3.6 3.6v2.6L2.8 10.4h10.4L11.6 7.8V5.2A3.6 3.6 0 0 0 8 1.6zM6.3 11.6a1.8 1.8 0 0 0 3.4 0z' },
  person: { d: 'M8 2.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM2.4 14c0-3.1 2.5-4.9 5.6-4.9s5.6 1.8 5.6 4.9z' },
  trash:  { d: 'M6.2 1.6h3.6l.6 1.2h2.8v1.5H2.8V2.8h2.8l.6-1.2zM3.9 5.6h8.2l-.7 8.8H4.6z' },
  disk:   { d: 'M2.6 2h8.2L14 5.2V14H2.6zm3 0v3.6h4.6V2zM5 9h6v5H5z' },
  pen:    { d: 'M11.6 1.8l2.6 2.6-8 8-3.4.8.8-3.4z' },
  plus:   { d: 'M8 3v10M3 8h10', stroke: 1.8 },
  x:      { d: 'M4 4l8 8M12 4l-8 8', stroke: 1.8 },
  filter: { d: 'M2 3h12l-4.8 5.8V14L6.8 12.6V8.8z' },
  chev:   { d: 'M10 3.5 5.5 8l4.5 4.5', stroke: 1.8 },
  // A ticked square for task, three lines of text for details: the icon row carries no letters.
  check:  { d: 'M13.4 3.4v9.2H2.6V3.4h10.8M5.3 8.1l2.1 2.2 4.2-4.5', stroke: 1.5 },
  lines:  { d: 'M3 4.6h10M3 8h10M3 11.4h6.4', stroke: 1.6 },
  // The toggle row: three columns for the stage and an hourglass for the estimate. All-day and
  // important are the words `24h` and `!`, which iconBtn renders as glyphs - there is no icon
  // for either, deliberately: the sun was taken for weather and a flag needed a digit.
  cols:   { d: 'M3.4 12.8V9.4M8 12.8V5.8M12.6 12.8V2.8', stroke: 2 },
  glass:  { d: 'M3.8 1.8h8.4v1.3L9.1 8l3.1 4.9v1.3H3.8v-1.3L6.9 8 3.8 3.1z' },
  // The two ways out of a view, and the way out of the calendar.
  board:  { d: 'M2.6 3.6h10.8v8.8H2.6zM6.2 3.6v8.8M9.8 3.6v8.8', stroke: 1.4 },
  house:  { d: 'M8 1.9 1.5 7.4h1.8V14h3.3V9.9h2.8V14h3.3V7.4h1.8z' },
  // The zoom and the panel. Three lines of equal length for the hamburger, so `lines` keeps
  // meaning details and no icon means two things.
  zoom:   { d: 'M7.1 2.4a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zM10.6 10.6 14 14', stroke: 1.5 },
  menu:   { d: 'M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2', stroke: 1.6 },
  // A clock face for the logs: the panel's subject is when the last attempt ran and how long
  // the queue has been waiting. `lines` already means details and may not come to mean two
  // things, and a stack of lines would read as one anyway.
  logs:   { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6zM8 5.1V8.3l2.5 1.6', stroke: 1.5 },
  gear:   { d: 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM7.1 1.4h1.8l.3 1.7 1.2.5 1.4-1 1.3 1.3-1 1.4.5 1.2 1.7.3v1.8l-1.7.3-.5 1.2 1 1.4-1.3 1.3-1.4-1-1.2.5-.3 1.7H7.1l-.3-1.7-1.2-.5-1.4 1-1.3-1.3 1-1.4-.5-1.2-1.7-.3V7.1l1.7-.3.5-1.2-1-1.4 1.3-1.3 1.4 1 1.2-.5z', stroke: 1.2 }
};

export function icon(name) {
  const spec = ICON[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', spec.d);
  if (spec.stroke) {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', String(spec.stroke));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

// `name` is an icon name, or any other string to use as a glyph. The entry popup's icon row is
// icons throughout; the toggle row's `24h` and `!`, and the top pane's arrows, are characters.
export function iconBtn(name, label, cls = '') {
  const b = el('button', ['ib', cls].filter(Boolean).join(' '));
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(ICON[name] ? icon(name) : el('span', 'glyph', name));
  return b;
}

// ---- overlays ------------------------------------------------------------------------------
// Three mechanisms. `openPop` hangs a dropdown off the button that opened it - the date picker,
// the zoom, the hamburger's menu and the filter. `openCentred` is the settings panel, the day
// preview and the group manager, centred by the stylesheet and only unhidden. `openRowPop` is
// the third and the odd one: a field's popup inside the entry popup, which carries **no scrim**,
// so the tap that dismisses it still reaches the row it landed on and moving from one field to
// the next is one tap rather than two. That is the whole reason it is not one of the other two.

export const openCentred = pop => { pop.hidden = false; $('#scrim').hidden = false; };

// Under the thing that opened it, flipped above when there is no room below - a row near the
// foot of a long entry popup is the case that needs it.
function place(pop, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = align === 'right' ? r.right - w : r.left;
  pop.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  const below = r.bottom + 6;
  const above = r.top - 6 - h;
  pop.style.top = `${below + h > innerHeight - 8 && above > 8 ? above : below}px`;
}

export function openPop(pop, anchor, align = 'left') {
  pop.hidden = false;
  $('#scrim').hidden = false;
  place(pop, anchor, align);
  anchor.setAttribute?.('aria-expanded', 'true');
}

export function openRowPop(pop, anchor) {
  pop.hidden = false;
  place(pop, anchor, 'left');
}

const POPS = ['#picker', '#zoom-pop', '#day-pop', '#menu-pop', '#filter-pop', '#settings-panel',
  '#logs-panel'];

export function closePops() {
  for (const id of [...POPS, '#scrim']) $(id).hidden = true;
  for (const id of ['#period', '#zoom-btn', '#menu-btn'])
    $(id).setAttribute('aria-expanded', 'false');
}
