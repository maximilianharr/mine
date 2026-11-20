// The bits every view needs: DOM helpers, the icon set, and the mutable state.
//
// State lives in one object rather than being threaded through every function, and `S.render`
// / `S.status` / `S.push` are slots the shell fills in, so a view can ask for a redraw or a
// background push without importing app.js back.
import {
  todayKey, DEFAULT_ANCHOR, groupColor, groupLabel, monthGrid, weekStartOf, addDays, partsOf,
  sprintRange, sprintOf
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
  prefs: { weekStart: 1, showWeeks: false, timeZone: '', theme: 'system', dateFormat: 'auto' },
  hidden: new Set(),                 // group names switched off in the filter
  kfilter: { priority: new Set(), assignee: '' },   // kanban only
  visible: new Map(),                // occurrence key -> occurrence, for what is on screen
  render: () => {},
  status: () => {},
  push: () => {},
  reload: async () => S.model
};

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

// Where a new entry lands: today when today is in view, otherwise the first day on screen.
export function defaultDay() {
  const [from, to] = viewRange();
  const t = todayKey();
  return t >= from && t <= to ? t : from;
}

export const currentSprint = () => sprintOf(todayKey(), S.model.settings) || 1;

// ---- icons ---------------------------------------------------------------------------------
// Hand-drawn on a 16x16 box. No icon font and no CDN: the CSP allows neither, and an inline
// path cannot fail to load.

const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  repeat: { d: 'M2.6 8.4A5.4 5.4 0 0 1 12.6 5.6M13.4 7.6A5.4 5.4 0 0 1 3.4 10.4M12.9 2.6v3.2H9.7M3.1 13.4v-3.2h3.2', stroke: 1.5 },
  ball:   { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6z' },
  pin:    { d: 'M8 1.4a4.4 4.4 0 0 0-4.4 4.4C3.6 9.2 8 14.6 8 14.6s4.4-5.4 4.4-8.8A4.4 4.4 0 0 0 8 1.4zm0 6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z' },
  bell:   { d: 'M8 1.6a3.6 3.6 0 0 0-3.6 3.6v2.6L2.8 10.4h10.4L11.6 7.8V5.2A3.6 3.6 0 0 0 8 1.6zM6.3 11.6a1.8 1.8 0 0 0 3.4 0z' },
  person: { d: 'M8 2.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM2.4 14c0-3.1 2.5-4.9 5.6-4.9s5.6 1.8 5.6 4.9z' },
  trash:  { d: 'M6.2 1.6h3.6l.6 1.2h2.8v1.5H2.8V2.8h2.8l.6-1.2zM3.9 5.6h8.2l-.7 8.8H4.6z' },
  disk:   { d: 'M2.6 2h8.2L14 5.2V14H2.6zm3 0v3.6h4.6V2zM5 9h6v5H5z' },
  pen:    { d: 'M11.6 1.8l2.6 2.6-8 8-3.4.8.8-3.4z' },
  plus:   { d: 'M8 3v10M3 8h10', stroke: 1.8 },
  x:      { d: 'M4 4l8 8M12 4l-8 8', stroke: 1.8 },
  filter: { d: 'M2 3h12l-4.8 5.8V14L6.8 12.6V8.8z' },
  chev:   { d: 'M10 3.5 5.5 8l4.5 4.5', stroke: 1.8 }
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

// `name` is an icon name, or any other string to use as a glyph - T, E, D and the gear are
// letters in the design, not drawings.
export function iconBtn(name, label, cls = '') {
  const b = el('button', ['ib', cls].filter(Boolean).join(' '));
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(ICON[name] ? icon(name) : el('span', 'glyph', name));
  return b;
}

// ---- popovers ------------------------------------------------------------------------------

export function openPop(pop, anchor, align = 'left') {
  pop.hidden = false;
  $('#scrim').hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = align === 'right' ? r.right - w : r.left;
  pop.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 6}px`;
  anchor.setAttribute?.('aria-expanded', 'true');
}

const POPS = ['#picker', '#filter-pop', '#day-pop', '#settings-sheet'];

export function closePops() {
  for (const id of [...POPS, '#scrim']) $(id).hidden = true;
  for (const id of ['#period', '#filter-btn']) $(id).setAttribute('aria-expanded', 'false');
}
