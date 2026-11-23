// The shell: the top pane, navigation, the date picker, the group filter, the sync line, and
// which view the big calendar window holds.
import { getConfig, getKV, setKV, queuedCount } from '../shared/store.js';
import { pull, drain } from '../shared/github.js';
import {
  loadModel, todayKey, addDays, addMonths, partsOf, monthGrid, weekStartOf, isoWeek, setZone,
  sprintRange, sprintOf
} from './data.js';
import {
  S, $, el, phone, colorOf, labelOf, dayLabel, icon, weekLetters, currentSprint, openPop,
  closePops
} from './ui.js';
import { renderView, wireView, openDayPop } from './views.js';
import { renderKanban } from './kanban.js';
import { closePopup, closeView } from './popup.js';
import { openSettings } from './settings.js';
import { loadPrefs, applyTheme, weekdayName } from '../shared/prefs.js';

let pick = { mode: 'days', y: 2026, m: 0, base: 0 };

// ---- rendering -----------------------------------------------------------------------------

function render() {
  const k = S.view.mode === 'K';
  $('#period-label').textContent = periodLabel();

  // One slot carries the way to the other kind of view. The board is not a zoom step, which is
  // why it has a slot of its own rather than a place in the cycle the label walks.
  $('#board').replaceChildren(icon(k ? 'cal' : 'board'));
  $('#board').setAttribute('aria-label', k ? 'Back to the month view' : 'Kanban');
  $('#period').setAttribute('aria-label', k ? 'Pick a sprint' : 'Zoom');

  if (k) renderKanban($('#view'));
  else renderView($('#view'));
  renderFilter();
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

// ---- navigation ----------------------------------------------------------------------------

// The calendar's zoom, outermost first. Clicking the period label walks it towards the day and
// round again. It is a cycle rather than a scale with two ends, because a single target cannot
// be disabled at an end and still be the way on - so there is no `-` and no `+` in the pane.
const ZOOM = ['Y', 'M', 'W', 'D'];

function zoomIn() {
  S.view.mode = ZOOM[(ZOOM.indexOf(S.view.mode) + 1) % ZOOM.length];
  closePops();
  render();
}

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

for (const [id, name] of [['#home', 'house'], ['#filter-btn', 'filter'], ['#day-add', 'plus'],
  ['#day-close', 'x'], ['#sub-clear', 'trash'], ['#sub-ok', 'disk'], ['#sub-cancel', 'x'],
  ['#sub-close', 'x'], ['#settings-close', 'x']])
  $(id).append(icon(name));

$('#gear').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closePops);

// ---- the dropdown date picker --------------------------------------------------------------
// A month at a time, a 9-year grid, or - in the kanban - a list of sprints.

// The caret is a button of its own, because the label itself zooms now - and the picker is the
// only way back to today, so it cannot be a tap the zoom has taken.
function openPicker() {
  if (!$('#picker').hidden) return closePops();
  closePops();
  const [y, m] = partsOf(S.view.anchor);
  pick = S.view.mode === 'K'
    ? { mode: 'sprints', base: Math.max(1, S.view.sprint - 4) }
    : { mode: 'days', y, m: m - 1, base: y - 8 };
  renderPicker();
  openPop($('#picker'), $('#caret'), 'right');
}
$('#caret').addEventListener('click', openPicker);

// The label zooms; on the board it opens the sprint list instead, because the board has no zoom.
$('#period').addEventListener('click', () => {
  if (S.view.mode === 'K') openPicker();
  else zoomIn();
});

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
  body.replaceChildren(
    ...weekLetters().map(([n]) => el('span', 'wh', n)),
    ...monthGrid(pick.y, pick.m, S.prefs.weekStart).map(k => {
      const [, mm, dd] = partsOf(k);
      const b = el('button', `pk${mm !== pick.m + 1 ? ' out' : ''}${k === todayKey() ? ' now' : ''}`,
        String(dd));
      b.type = 'button';
      b.addEventListener('click', () => {
        closePops();
        S.view.anchor = k;
        render();
        // Picking a date in a view that cannot show the day's entries in place opens the preview.
        if (S.view.mode === 'Y' || (S.view.mode === 'M' && phone())) openDayPop(k);
      });
      return b;
    }));
}

// ---- the filter ----------------------------------------------------------------------------
// A view filter, remembered per device. Groups are named and coloured in settings, not here.

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

// Groups are a dropdown rather than a list: one row saying how many are on, which opens to the
// same checkboxes. Folding the list away is all it does - any subset can still be hidden, which
// a single-select control could not do - and it keeps a repo with twenty groups from giving the
// filter a panel taller than the screen.
let groupsOpen = false;

function renderFilter() {
  const names = groupNames();
  const on = names.filter(([n]) => !S.hidden.has(n)).length;
  const drop = el('button', 'gdrop', `groups · ${on} of ${names.length} ${groupsOpen ? '▴' : '▾'}`);
  drop.type = 'button';
  drop.setAttribute('aria-expanded', String(groupsOpen));
  drop.addEventListener('click', () => { groupsOpen = !groupsOpen; renderFilter(); });
  const kids = [drop];

  if (groupsOpen) for (const [name, label] of names) {
    const lab = el('label', 'glab');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !S.hidden.has(name);
    box.addEventListener('change', async () => {
      if (box.checked) S.hidden.delete(name); else S.hidden.add(name);
      await setKV('calendar.hiddenGroups', [...S.hidden]);
      render();
    });
    const sw = el('span', 'swatch');
    sw.style.background = colorOf(name);
    lab.append(box, sw, el('span', '', label || name));
    kids.push(lab);
  }

  // Importance and assignee narrow the board, where a sprint can hold more cards than fit. One
  // switch, now that importance is a yes or no rather than three tiers to pick between.
  if (S.view.mode === 'K') {
    kids.push(el('div', 'pop-sub', 'Important'));
    const chips = el('div', 'chiprow');
    const b = el('button', `chip${S.kfilter.importantOnly ? ' on' : ''}`, '!');
    b.type = 'button';
    b.title = 'Important only';
    b.setAttribute('aria-label', 'Important only');
    b.setAttribute('aria-pressed', String(S.kfilter.importantOnly));
    b.addEventListener('click', () => {
      S.kfilter.importantOnly = !S.kfilter.importantOnly;
      render();
    });
    chips.append(b);
    kids.push(chips, el('div', 'pop-sub', 'Assignee'));
    const people = [...new Set([...S.model.dated, ...S.model.rules]
      .flatMap(e => [].concat(e.data.participants ?? []).map(String)))].sort();
    const sel = el('select');
    for (const [v, text] of [['', 'anyone'], ...people.map(p => [p, p])]) {
      const o = el('option', '', text);
      o.value = v;
      if (v === S.kfilter.assignee) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { S.kfilter.assignee = sel.value; render(); });
    kids.push(sel);
  }

  $('#filter-body').replaceChildren(...kids);
}

$('#filter-btn').addEventListener('click', () => {
  if (!$('#filter-pop').hidden) return closePops();
  closePops();
  openPop($('#filter-pop'), $('#filter-btn'), 'right');
});

$('#scrim').addEventListener('click', closePops);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#ask').hidden) $('#ask-keep').click();
  else if (!$('#sub').hidden) $('#sub-cancel').click();
  else if (!$('#popup').hidden) closePopup();
  else if (!$('#viewpop').hidden) closeView();
  else closePops();
});
matchMedia('(min-width: 600px)').addEventListener('change', () => { closePops(); render(); });

// ---- sync ----------------------------------------------------------------------------------

function status(text, bad) {
  const s = $('#sync');
  s.textContent = text;
  s.classList.toggle('bad', !!bad);
}

async function showSync() {
  const n = await queuedCount();
  status(n ? `${n} change(s) pending` : 'in sync');
}

// Every write reaches the local mirror first, so the view is already right and the push can run
// behind it. One drain at a time, and failures and conflicts are reported here rather than in
// the popup the user has already left.
let chain = Promise.resolve();
function push(message) {
  chain = chain.then(async () => {
    status('pushing…');
    try {
      const r = await drain(message);
      if (r.conflicts?.length)
        status(`${r.conflicts.length} change(s) kept beside the remote version as .conflict files — review them`, true);
      else await showSync();
    } catch (err) {
      status(`not pushed: ${err.message}`, true);
    }
  });
}

async function refresh() {
  if (await queuedCount()) return showSync();
  status('checking…');
  try {
    const r = await pull();                    // whole repo: the mirror and the ETag are shared
    if (!r.unchanged) { S.model = await loadModel(); render(); }
    status(r.empty ? 'repo is empty' : r.unchanged ? 'in sync' : `in sync — ${r.changed} file(s) updated`);
  } catch (err) {
    status(err.message, true);
  }
}

// ---- boot ----------------------------------------------------------------------------------

S.render = render;
S.status = status;
S.push = push;
S.reload = loadModel;
wireView();

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
    confirmDiscard: (await getKV('calendar.confirmDiscard')) ?? true,
    timeZone: (await getKV('calendar.timeZone')) || ''
  };
  setZone(S.prefs.timeZone);
  S.hidden = new Set(await getKV('calendar.hiddenGroups') || []);
  S.model = await loadModel();
  S.view.anchor = todayKey();
  S.view.sprint = currentSprint();
  render();
  await refresh();
  addEventListener('focus', refresh);
}
