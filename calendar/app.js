// The shell: the top pane, navigation, the date picker, the group filter, the sync line, and
// which view the big calendar window holds.
import { getConfig, getKV, setKV, queuedCount } from '../shared/store.js';
import { pull, drain } from '../shared/github.js';
import {
  loadModel, todayKey, addDays, addMonths, partsOf, monthGrid, weekStartOf, isoWeek, setZone,
  sprintRange, sprintOf
} from './data.js';
import {
  S, $, el, phone, colorOf, labelOf, dayLabel, longDayLabel, defaultDay, currentSprint,
  openPop, closePops
} from './ui.js';
import { renderView, wireView, openDayPop } from './views.js';
import { renderKanban } from './kanban.js';
import { openNew, closePopup } from './popup.js';
import { openSettings } from './settings.js';
import { loadPrefs, applyTheme } from '../shared/prefs.js';

let pick = { mode: 'days', y: 2026, m: 0, base: 0 };

// ---- rendering -----------------------------------------------------------------------------

function render() {
  $('#period-label').textContent = periodLabel();
  for (const b of document.querySelectorAll('[data-mode]'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === S.view.mode));
  if (S.view.mode === 'K') renderKanban($('#view'));
  else renderView($('#view'));
  renderFilter();
}

function periodLabel() {
  const { mode, anchor } = S.view;
  if (mode === 'D') return longDayLabel(anchor);
  if (mode === 'W') {
    const a = weekStartOf(anchor, S.prefs.weekStart);
    return `${S.prefs.showWeeks ? `W${isoWeek(a)} · ` : ''}${dayLabel(a)} – ${dayLabel(addDays(a, 6))}`;
  }
  if (mode === 'M') {
    const [y, m] = partsOf(anchor);
    return new Date(y, m - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (mode === 'Y') return String(partsOf(anchor)[0]);
  const r = sprintRange(S.view.sprint, S.model.settings);
  return `Sprint ${r.n} · ${dayLabel(r.start)} – ${dayLabel(r.end)}`;
}

// ---- navigation ----------------------------------------------------------------------------

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

$('#today').addEventListener('click', () => {
  closePops();
  S.view.anchor = todayKey();
  S.view.sprint = currentSprint();
  render();
});

for (const b of document.querySelectorAll('[data-mode]'))
  b.addEventListener('click', () => {
    S.view.mode = b.dataset.mode;
    if (b.dataset.mode === 'K')
      S.view.sprint = sprintOf(S.view.anchor, S.model.settings) || currentSprint();
    closePops();
    render();
  });

// Defaults to today when today is in view, otherwise to the first day on screen - in the
// kanban, the first day of the selected sprint, in its todo column.
$('#add').addEventListener('click', () => {
  closePops();
  openNew(S.view.mode === 'K'
    ? { dayKey: defaultDay(), type: 'task', stage: 'todo', allDay: true }
    : { dayKey: defaultDay() });
});

$('#gear').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closePops);

// ---- the dropdown date picker --------------------------------------------------------------
// A month at a time, a 9-year grid, or - in the kanban - a list of sprints.

$('#period').addEventListener('click', () => {
  if (!$('#picker').hidden) return closePops();
  closePops();
  const [y, m] = partsOf(S.view.anchor);
  pick = S.view.mode === 'K'
    ? { mode: 'sprints', base: Math.max(1, S.view.sprint - 4) }
    : { mode: 'days', y, m: m - 1, base: y - 8 };
  renderPicker();
  openPop($('#picker'), $('#period'));
});

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
      const b = el('button', `pk wide${r.n === S.view.sprint ? ' now' : ''}`,
        `Sprint ${r.n} · ${dayLabel(r.start)} – ${dayLabel(r.end)}`);
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
    ...weekLetters().map(n => el('span', 'wh', n)),
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

const weekLetters = () => {
  const base = weekStartOf('2026-01-05', S.prefs.weekStart);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(`${addDays(base, i)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' }));
};

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

function renderFilter() {
  const kids = [el('div', 'pop-sub', 'Groups')];
  for (const [name, label] of groupNames()) {
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

  // Priority and assignee narrow the board, where a sprint can hold more cards than fit.
  if (S.view.mode === 'K') {
    kids.push(el('div', 'pop-sub', 'Priority'));
    const chips = el('div', 'chiprow');
    for (const [v, text] of [[1, 'P1'], [2, 'P2'], [3, 'P3'], [0, 'none']]) {
      const b = el('button', `chip p${v}${S.kfilter.priority.has(v) ? ' on' : ''}`, text);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (S.kfilter.priority.has(v)) S.kfilter.priority.delete(v); else S.kfilter.priority.add(v);
        render();
      });
      chips.append(b);
    }
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
  if (!$('#sub').hidden) $('#sub-cancel').click();
  else if (!$('#popup').hidden) closePopup();
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
