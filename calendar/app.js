// The shell: the top pane, navigation, the date picker, the zoom, the hamburger's menu, the sync
// line, and which view the big calendar window holds.
import { getConfig, getKV, setKV } from '../shared/store.js';
import { createSync } from '../shared/sync.js';
import {
  loadModel, todayKey, addDays, addMonths, partsOf, weekStartOf, isoWeek, setZone,
  sprintRange, sprintOf, occurrences
} from './data.js';
import {
  S, $, el, phone, dayLabel, icon, monthDays, currentSprint, openPop, closePops, registerPops
} from './ui.js';
import { renderView, wireView, openDayPop } from './views.js';
import { renderKanban } from './kanban.js';
import { escapeEntry, openEntry } from './popup.js';
import { openFilter, openPanel, openLogs, renderFilter, renderFilterCount } from './settings.js';
import { loadPrefs, applyTheme, weekdayName } from '../shared/prefs.js';
import { openSearch, refreshSearch } from '../shared/search.js';
import { dockable } from '../shared/drag.js';

let pick = { mode: 'days', y: 2026, m: 0, base: 0 };

// ---- rendering -----------------------------------------------------------------------------

function render() {
  const k = S.view.mode === 'K';
  $('#period-label').textContent = periodLabel();

  // One slot carries the way to the other kind of view. The board is not a zoom step, which is
  // why it has a slot of its own rather than a place in the cycle the label walks.
  $('#board').replaceChildren(icon(k ? 'cal' : 'board'));
  $('#board').setAttribute('aria-label', k ? 'Back to the month view' : 'Kanban');
  $('#period').setAttribute('aria-label', k ? 'Pick a sprint' : 'Pick a date');

  if (k) renderKanban($('#view'));
  else renderView($('#view'));
  renderZoom();
  renderFilter();
  renderFilterCount();
  refreshSearch();
}

// The pane has to fit a phone, so every label is short. The month name is the device locale's
// abbreviation, upper-cased - short beats English.
const shortMonth = key => new Date(`${key}T12:00:00`)
  .toLocaleDateString(undefined, { month: 'short' }).replace(/\./g, '').toUpperCase();

function periodLabel() {
  const { mode, anchor } = S.view;
  const [y, , d] = partsOf(anchor);
  if (mode === 'D')
    return `${weekdayName(anchor, 'short').slice(0, 2).toUpperCase()} ${d}/${shortMonth(anchor)}`;
  if (mode === 'W') {
    // The ISO number is in the label whether or not the gutter is on, and the month is the one
    // the row's fourth day is in - the rule the gutter uses, so the two cannot disagree.
    const a = weekStartOf(anchor, S.prefs.weekStart);
    return `W${isoWeek(addDays(a, 3))}/${shortMonth(addDays(a, 3))}`;
  }
  if (mode === 'M') return `${shortMonth(anchor)}/${String(y).slice(2)}`;
  if (mode === 'Y') return String(y);
  return String(S.view.sprint);
}

// ---- the zoom ------------------------------------------------------------------------------
// A button beside the view switch, reading the view it is in and offering what the view it was opened in can do and nothing
// else: the four periods in a calendar view, the board's two orientations on the board. It
// replaces the label's old cycle, which asked up to three taps to reach a view and never said
// which one you were in.

const PERIODS = [['D', 'day'], ['W', 'week'], ['M', 'month'], ['Y', 'year']];
const ORIENTS = [['vert', 'vertical'], ['horz', 'horizontal']];

function renderZoom() {
  const board = S.view.mode === 'K';
  const btn = $('#zoom-btn');
  btn.replaceChildren(board ? icon(S.prefs.boardOrientation === 'vert' ? 'vert' : 'horz')
    : el('span', 'glyph', S.view.mode));
  btn.setAttribute('aria-label', board
    ? `Zoom: ${S.prefs.boardOrientation === 'vert' ? 'vertical' : 'horizontal'}`
    : `Zoom: ${PERIODS.find(([v]) => v === S.view.mode)[1]}`);
  const rows = board
    ? ORIENTS.map(([v, text]) => [v, text, S.prefs.boardOrientation === v, setOrientation])
    : PERIODS.map(([v, text]) => [v, text, S.view.mode === v, setMode]);
  $('#zoom-body').replaceChildren(...rows.map(([v, text, on, pick]) => {
    const b = el('button', `zrow${on ? ' on' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.append(el('span', 'dot'), el('span', '', text));
    b.addEventListener('click', () => pick(v));
    return b;
  }));
}

function setMode(mode) {
  S.view.mode = mode;
  closePops();
  render();
}

// Remembered per device: it is a preference about this screen, like confirm discard. The
// calendar's own zoom is not - the app opens on the month, on today, as it always has.
async function setOrientation(v) {
  S.prefs.boardOrientation = v;
  await setKV('calendar.boardOrientation', v);
  S.view.col = 0;
  closePops();
  render();
}

$('#zoom-btn').addEventListener('click', () => {
  if (!$('#zoom-pop').hidden) return closePops();
  closePops();
  renderZoom();
  openPop($('#zoom-pop'), $('#zoom-btn'));
});

// ---- navigation ----------------------------------------------------------------------------

$('#board').addEventListener('click', () => {
  if (S.view.mode === 'K') S.view.mode = 'M';
  else {
    S.view.mode = 'K';
    S.view.sprint = sprintOf(S.view.anchor, S.model.settings) || currentSprint();
  }
  closePops();
  render();
});

function step(dir) {
  const v = S.view;
  if (v.mode === 'D') v.anchor = addDays(v.anchor, dir);
  else if (v.mode === 'W') v.anchor = addDays(v.anchor, 7 * dir);
  else if (v.mode === 'M') v.anchor = addMonths(v.anchor, dir);
  else if (v.mode === 'Y') v.anchor = addMonths(v.anchor, 12 * dir);
  else v.sprint = Math.max(1, v.sprint + dir);
  closePops();
  render();
}
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));

// There is no jump-to-today button and no `+` in the pane: today is the highlighted day in the
// dropdown, and an entry is created where it will live - a cell, the day preview, or a kanban
// column header.

for (const [id, name] of [['#home', 'house'], ['#search-btn', 'search'], ['#filter-btn', 'filter'],
  ['#menu-btn', 'menu'],
  ['#day-add', 'plus'], ['#day-close', 'x'], ['#sub-close', 'x'], ['#settings-close', 'x'],
  ['#filter-close', 'x'], ['#filter-sub-close', 'x'], ['#fpop-close', 'x'], ['#logs-close', 'x']])
  $(id).append(icon(name));

// ---- search --------------------------------------------------------------------------------
// The search is Mine's, in ../shared/search.js; what the calendar tells it is its folder, which
// keys hold the title and the date, and what opening a result is. A file without a title is not
// an entry - groups.md, settings.md and an override recording only what it changed - so a
// repeating entry is one result, its rule file.

$('#search-btn').addEventListener('click', () => openSearch({
  folder: 'calendar/', title: 'title', date: 'start', fields: ['group', 'participants', 'location'],
  open: openFound
}));

// A dated entry opens as itself. A repeating one opens on its next occurrence from today, or on
// its last if the series is over.
function openFound(path) {
  const today = todayKey();
  const rule = S.model.rules.find(r => r.path === path);
  if (rule) {
    const mine = (from, to) => occurrences(S.model, from, to).filter(o => o.seriesPath === path);
    const start = String(rule.data.start).slice(0, 10);
    const next = mine(today, addDays(today, 3660)).find(o => o.dayKey >= today);
    return openEntry(next || mine(start < today ? start : today, today).pop());
  }
  const e = S.model.dated.find(d => d.path === path)
    || [...S.model.overrides.values()].find(d => d.path === path);
  if (!e) return;
  const day = String(e.data.start ?? e.data['recurrence-id']).slice(0, 10);
  openEntry(occurrences(S.model, addDays(day, -1), addDays(day, 1)).find(o => o.path === path));
}

// ---- the filter, and the hamburger's menu --------------------------------------------------
// The filter has a button of its own in the pane: it is opened daily, and a menu in front of it
// was a tap spent naming the one errand you came for. The hamburger keeps the two you open
// rarely, each named before it is opened - the settings, and the logs, which you reach for when
// the sync line says something you did not expect.
const MENU = [['gear', 'settings', openPanel], ['logs', 'logs', openLogs]];

function openMenu() {
  if (!$('#menu-pop').hidden) return closePops();
  closePops();
  $('#menu-body').replaceChildren(...MENU.map(([ic, text, open]) => {
    const b = el('button', 'mrow');
    b.type = 'button';
    b.append(icon(ic), el('span', '', text));
    b.addEventListener('click', open);   // each one closes the menu on its way in
    return b;
  }));
  openPop($('#menu-pop'), $('#menu-btn'), 'right');
}

$('#menu-btn').addEventListener('click', openMenu);
$('#filter-btn').addEventListener('click', openFilter);
$('#filter-close').addEventListener('click', closePops);
// The one `x` that leaves what is under it open.
$('#filter-sub-close').addEventListener('click', () => { $('#filter-sub').hidden = true; });
$('#settings-close').addEventListener('click', closePops);
$('#logs-close').addEventListener('click', closePops);

// The sync line is the thing you are looking at when you want to know why, so it is the way in
// as well as the report. Reaching the panel through the hamburger only helps once you know it
// is there.
$('#sync').addEventListener('click', openLogs);

// ---- the dropdown date picker --------------------------------------------------------------
// A month at a time, a 9-year grid, or - in the kanban - a list of sprints.

// The label opens the picker, and that is all it does, in every view and on both platforms. The
// caret existed only because the label's own tap was taken by the zoom; the zoom is a button of
// its own now, so the label is free to be the one thing it was always read as.
function openPicker() {
  if (!$('#picker').hidden) return closePops();
  closePops();
  const [y, m] = partsOf(S.view.anchor);
  pick = S.view.mode === 'K'
    ? { mode: 'sprints', base: Math.max(1, S.view.sprint - 4) }
    : { mode: 'days', y, m: m - 1, base: y - 8 };
  renderPicker();
  openPop($('#picker'), $('#period'), 'right');
}
$('#period').addEventListener('click', openPicker);

// There is no swipe. The label was swiped only because a phone's pane had no `‹` `›` to press;
// they are on its second row now, and a gesture doing what a visible button does is a second
// mechanism for one action. So no sideways gesture does anything, in any view, and nothing has
// to be told apart from a card drag on the board or a scroll in a grid.

$('#pick-title').addEventListener('click', () => {
  if (pick.mode === 'sprints') return;
  pick.mode = pick.mode === 'days' ? 'years' : 'days';
  pick.base = pick.y - 8;
  renderPicker();
});
$('#pick-prev').addEventListener('click', () => pagePicker(-1));
$('#pick-next').addEventListener('click', () => pagePicker(1));

function pagePicker(dir) {
  if (pick.mode === 'years') pick.base += dir * 9;
  else if (pick.mode === 'sprints') pick.base = Math.max(1, pick.base + dir * 9);
  else {
    const m = pick.m + dir;
    pick.y += Math.floor(m / 12);
    pick.m = (m + 12) % 12;
  }
  renderPicker();
}

function renderPicker() {
  const body = $('#pick-body');

  if (pick.mode === 'sprints') {
    $('#pick-label').textContent = 'Sprints';
    body.className = 'pick-body sprints';
    body.replaceChildren(...Array.from({ length: 9 }, (_, i) => {
      const r = sprintRange(pick.base + i, S.model.settings);
      // The sprint today falls in reads `current` and carries the brighter background; the
      // selected one is marked, not renamed, so the two can be the same row.
      const cur = r.n === currentSprint();
      const b = el('button', `pk wide${cur ? ' cur' : ''}${r.n === S.view.sprint ? ' now' : ''}`,
        `${cur ? 'current' : `Sprint ${r.n}`} · ${dayLabel(r.start)} – ${dayLabel(r.end)}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        closePops();
        S.view.sprint = r.n;
        S.view.anchor = r.start;
        render();
      });
      return b;
    }));
    return;
  }

  if (pick.mode === 'years') {
    // 9 years ending with the current one; the arrows page by 9.
    $('#pick-label').textContent = `${pick.base} – ${pick.base + 8}`;
    body.className = 'pick-body years';
    body.replaceChildren(...Array.from({ length: 9 }, (_, i) => {
      const y = pick.base + i;
      const b = el('button', `pk${y === partsOf(S.view.anchor)[0] ? ' now' : ''}`, String(y));
      b.type = 'button';
      b.addEventListener('click', () => { pick = { ...pick, mode: 'days', y }; renderPicker(); });
      return b;
    }));
    return;
  }

  $('#pick-label').textContent =
    new Date(pick.y, pick.m, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  body.className = 'pick-body days';
  // The grid is ../calendar/ui.js's, shared with the when's date steps and the repetition's end
  // date; the head above it is this picker's, because the year and sprint grids page from it too.
  body.replaceChildren(...monthDays(pick.y, pick.m, {
    onPick: k => {
      closePops();
      S.view.anchor = k;
      render();
      // Picking a date in a view that cannot show the day's entries in place opens the preview.
      if (S.view.mode === 'Y' || (S.view.mode === 'M' && phone())) openDayPop(k);
    }
  }));
}

$('#scrim').addEventListener('click', closePops);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#ask').hidden) $('#ask-keep').click();
  else if (!$('#sub').hidden) $('#sub-close').click();
  else if (!$('#popup').hidden) escapeEntry();
  else closePops();
});
matchMedia('(min-width: 600px)').addEventListener('change', () => { closePops(); render(); });

// ---- sync ----------------------------------------------------------------------------------
// The sequence - drain the queue, then pull, and report on one line - is in ../shared/sync.js,
// because the queue and the mirror are shared and every screen in Mine runs it. The line here
// is a button to the logs, so a failure says where to look.

const sync = createSync({
  line: $('#sync'),
  hint: ' — tap for details',
  onPulled: async () => { S.model = await loadModel(); render(); }
});

// ---- boot ----------------------------------------------------------------------------------

S.render = render;
S.status = sync.status;
S.push = sync.push;
S.refresh = sync.refresh;
S.reload = loadModel;
S.sync = sync;              // the logs panel pushes and retries through it
wireView();

// The overlays this app closes together. closePops() takes them from here rather than from a
// list of its own, so it can live in ../shared/ui.js without knowing what the calendar has.
registerPops(['#search-pop', '#picker', '#zoom-pop', '#day-pop', '#menu-pop', '#filter-pop', '#filter-sub',
  '#settings-panel',
  '#logs-panel']);

const minePrefs = await loadPrefs();
applyTheme(minePrefs.theme);

if (!await getConfig()) {
  $('#needs-setup').hidden = false;
} else {
  $('#cal').hidden = false;
  S.prefs = {
    ...S.prefs, ...minePrefs,
    weekStart: (await getKV('calendar.weekStart')) ?? 1,
    showWeeks: !!(await getKV('calendar.showWeeks')),
    timeZone: (await getKV('calendar.timeZone')) || '',
    boardOrientation: (await getKV('calendar.boardOrientation')) || 'horz',
    popupExpanded: !!(await getKV('calendar.popupExpanded'))
  };
  // Held and dragged to the top or the bottom half of the screen, for all of Mine.
  dockable($('.topbar'), S.prefs.barPosition, pos => { S.prefs.barPosition = pos; });
  setZone(S.prefs.timeZone);
  S.hidden = new Set(await getKV('calendar.hiddenGroups') || []);
  S.hiddenStages = new Set(await getKV('calendar.hiddenStages') || []);
  S.kfilter.importantOnly = !!(await getKV('calendar.importantOnly'));
  S.model = await loadModel();
  S.view.anchor = todayKey();
  S.view.sprint = currentSprint();
  render();
  await sync.refresh();
  addEventListener('focus', sync.refresh);
}
