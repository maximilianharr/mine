// The bits every view needs: the calendar's own icons, its date labels, and the mutable state.
//
// The DOM helpers, the icon machinery, the overlay mechanisms and the settings row are in
// ../shared/ui.js and re-exported here, so a view keeps importing one file.
//
// State lives in one object rather than being threaded through every function, and `S.render`
// / `S.status` / `S.push` are slots the shell fills in, so a view can ask for a redraw or a
// background push without importing app.js back.
import {
  todayKey, DEFAULT_ANCHOR, groupColor, groupLabel, monthGrid, weekStartOf, addDays, partsOf,
  dowOf, sprintRange, sprintOf
} from './data.js';
import { formatDate, shortDate, weekdayName } from '../shared/prefs.js';
import { addIcons, el } from '../shared/ui.js';

export {
  $, el, phone, icon, iconBtn, openPop, openRowPop, openCentred, closePops, registerPops,
  row, choose, toggle, numberField, dateField
} from '../shared/ui.js';

export const S = {
  model: { groups: {}, dated: [], rules: [], overrides: new Map(),
           settings: { anchor: DEFAULT_ANCHOR, interval: 2 } },
  view: { mode: 'M', anchor: todayKey(), sprint: 1, col: 0 },
  prefs: { weekStart: 1, showWeeks: false, confirmDiscard: true, timeZone: '',
           theme: 'system', dateFormat: 'auto', boardOrientation: 'horz', popupExpanded: false },
  hidden: new Set(),                 // group names switched off in the filter
  hiddenStages: new Set(),           // stages switched off in the filter
  kfilter: { importantOnly: false, assignee: '' },   // the assignee is the board's alone
  visible: new Map(),                // occurrence key -> occurrence, for what is on screen
  render: () => {},
  status: () => {},
  push: () => {},
  refresh: async () => {},
  reload: async () => S.model
};

// The kanban's column colours. In ui.js rather than kanban.js because the entry popup's stage
// button carries the same three, and one table is the only way they cannot drift apart.
//
// They name custom properties rather than hexes: a stage colour has to hold on paper and at
// night, and a hex written here could only ever be one of the two. The properties are declared
// in style.css beside the rest of the palette, and an inline `color: var(--todo)` resolves to
// whichever scheme is on.
export const STAGE_COLOR = { todo: 'var(--todo)', doing: 'var(--doing)', done: 'var(--done)' };
// The stage as a word, for the places that read it rather than colour it: the popup's line and
// the filter's rows. The board draws the bare key, which is the column's own name.
export const STAGE_LABEL = { todo: 'Todo', doing: 'Doing', done: 'Done' };

export const colorOf = g => groupColor(S.model.groups, g);
export const labelOf = g => groupLabel(S.model.groups, g);
export const dayLabel = key => formatDate(key, S.prefs.dateFormat);
export const longDayLabel = key => `${weekdayName(key)}, ${formatDate(key, S.prefs.dateFormat)}`;
// The entry popup's when-row: the weekday in three characters or whatever the locale's
// abbreviation is, upper-cased, and the date with a two-digit year. Two of these share one line
// on a span, which is what both abbreviations are for.
export const shortDayLabel = key =>
  `${weekdayName(key, 'short').replace(/\./g, '').toUpperCase()}, ${shortDate(key, S.prefs.dateFormat)}`;

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

// ---- a month of days -----------------------------------------------------------------------
// The weekday letters and six rows of day buttons, drawn once for the three places that pick a
// date: the pane's dropdown, the when's date steps and the repetition's end date. Today is
// marked, so is the day the picker is set to, and `highlight` marks one more - the start date,
// while the end date is being chosen, so the day the end may not fall before is visible in the
// grid itself.
//
// It returns the cells rather than a box of its own, because `.pick-body` is the grid and a div
// between it and its cells would collapse the layout. The caller owns the month it is looking
// at and pages it: the pane's dropdown pages from the head it already has, a field's popup from
// a line in its body, and neither can be the other's.
export const monthDays = (y, m, { value, highlight, onPick }) => [
  ...weekLetters().map(([n]) => el('span', 'wh', n)),
  ...monthGrid(y, m, S.prefs.weekStart).map(k => {
    const [, mm, dd] = partsOf(k);
    const b = el('button', ['pk', mm !== m + 1 ? 'out' : '', k === value ? 'sel' : '',
      k === highlight ? 'hl' : '', k === todayKey() ? 'now' : ''].filter(Boolean).join(' '),
      String(dd));
    b.type = 'button';
    b.addEventListener('click', () => onPick(k));
    return b;
  })
];

// ---- the calendar's icons ------------------------------------------------------------------
// Its own subjects, drawn on the same 16x16 box and merged into the shared set at load. The
// verbs - a trashcan, a save, an x, a plus, a chevron, the hamburger, the gear, the clock, the
// house - are in ../shared/ui.js, because a second app drawing its own is how the conventions
// REQUIREMENTS.md states for all of Mine would quietly stop being conventions.
addIcons({
  repeat: { d: 'M2.6 8.4A5.4 5.4 0 0 1 12.6 5.6M13.4 7.6A5.4 5.4 0 0 1 3.4 10.4M12.9 2.6v3.2H9.7M3.1 13.4v-3.2h3.2', stroke: 1.5 },
  ball:   { d: 'M8 3.1a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8z', stroke: 1.4 },
  cal:    { d: 'M2.8 4.6h10.4v8.8H2.8zM2.8 7.4h10.4M5.6 2.6v3M10.4 2.6v3', stroke: 1.4 },
  pin:    { d: 'M8 1.9a4.2 4.2 0 0 0-4.2 4.2c0 3.2 4.2 8.1 4.2 8.1s4.2-4.9 4.2-8.1A4.2 4.2 0 0 0 8 1.9zM8 7.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z', stroke: 1.3 },
  bell:   { d: 'M8 2.1a3.4 3.4 0 0 0-3.4 3.4v2.3L3.3 10.2h9.4l-1.3-2.4V5.5A3.4 3.4 0 0 0 8 2.1zM6.4 11.6a1.6 1.6 0 0 0 3.2 0', stroke: 1.4 },
  person: { d: 'M8 2.7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.1 13.7c0-2.8 2.4-4.5 4.9-4.5s4.9 1.7 4.9 4.5', stroke: 1.4 },
  filter: { d: 'M2.5 3.3h11l-4.2 5.2v5.1L6.7 12.3V8.5z', stroke: 1.4 },
  // A ticked square for task, a calendar page for event: the icon row carries no letters.
  check:  { d: 'M13.4 3.4v9.2H2.6V3.4h10.8M5.3 8.1l2.1 2.2 4.2-4.5', stroke: 1.5 },
  // The stage: a bare tick, which the popup sets on a rectangle of the stage's own colour - red,
  // yellow, green. All-day and important are the words `24h` and `!`, which iconBtn renders as
  // glyphs - there is no icon for either, deliberately: the sun was taken for weather and a flag
  // needed a digit.
  tick:   { d: 'M3.2 8.4 6.5 11.7 12.8 4.6', stroke: 2 },
  // The two ways out of a view: the board, and the zoom that picks a period by name.
  board:  { d: 'M2.6 3.6h10.8v8.8H2.6zM6.2 3.6v8.8M9.8 3.6v8.8', stroke: 1.4 },
  zoom:   { d: 'M7.1 2.4a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zM10.6 10.6 14 14', stroke: 1.5 }
});
