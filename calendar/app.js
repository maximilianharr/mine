// Month view, entry popup, group filter. Phone and desktop are the same screens with
// different cell contents: rows of text where there is room, group-coloured dots and a
// bottom sheet where there is not.
import { getConfig, getKV, setKV, queuedCount } from '../shared/store.js';
import { pull } from '../shared/github.js';
import {
  loadModel, occurrences, byStart, groupColor, groupLabel, timeLabel, todayKey, localKey,
  isAllDay, createEntry, updateEntry, deleteEntry, saveOverride, skipOccurrence
} from './data.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const phone = () => !matchMedia('(min-width: 600px)').matches;
const pad = n => String(n).padStart(2, '0');
const MONTH = { month: 'long', year: 'numeric' };
const DAY = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

let model = { groups: {}, dated: [], rules: [], overrides: new Map() };
let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
let hiddenGroups = new Set();
let visible = new Map();          // occurrence key -> occurrence, for what is on screen
let editing = null;               // { occ, dayKey, scope }
let pick = { mode: 'days', y: view.y, m: view.m, base: view.y - 8 };

// ---- month arithmetic (local, at noon, so no DST hour can shift a date) ----

const at = (y, m, d) => new Date(y, m, d, 12);

function monthCells(y, m) {
  const back = (at(y, m, 1).getDay() + 6) % 7;            // Monday = 0
  const days = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((back + days) / 7);
  const out = [];
  for (let i = 0; i < weeks * 7; i++) out.push(at(y, m, 1 - back + i));
  return out;
}

// ---- rendering ----

function renderWeekhead() {
  $('#weekhead').replaceChildren(...['M', 'T', 'W', 'T', 'F', 'S', 'S']
    .map((n, i) => el('span', i > 4 ? 'we' : '', n)));
}

function render() {
  $('#period-label').textContent = at(view.y, view.m, 1).toLocaleDateString(undefined, MONTH);

  const cells = monthCells(view.y, view.m);
  const all = occurrences(model, localKey(cells[0]), localKey(cells[cells.length - 1]));
  const byDay = new Map();
  visible = new Map();
  for (const o of all) {
    if (hiddenGroups.has(o.group || '')) continue;
    visible.set(o.key, o);
    if (!byDay.has(o.dayKey)) byDay.set(o.dayKey, []);
    byDay.get(o.dayKey).push(o);
  }

  const today = todayKey();
  $('#grid').replaceChildren(...cells.map(d => {
    const k = localKey(d);
    const dow = (d.getDay() + 6) % 7;
    const cell = el('div', ['day', dow > 4 ? 'we' : '', d.getMonth() !== view.m ? 'out' : '',
      k === today ? 'today' : ''].filter(Boolean).join(' '));
    cell.dataset.day = k;
    cell.append(el('span', 'num', String(d.getDate())));

    const items = byDay.get(k) || [];
    const dots = el('div', 'dots');
    for (const o of items.slice(0, 6)) {
      const s = el('span', `dot${o.type === 'task' && o.done ? ' done' : ''}`);
      s.style.setProperty('--c', groupColor(model.groups, o.group));
      dots.append(s);
    }
    if (items.length > 6) dots.append(el('span', 'more', `+${items.length - 6}`));

    const rows = el('div', 'rows');
    for (const o of items) rows.append(entryRow(o));
    cell.append(dots, rows);
    return cell;
  }));

  if (!$('#day-sheet').hidden) fillDaySheet($('#day-sheet').dataset.day);
}

function entryRow(o) {
  const r = el('div', `erow${o.done ? ' done' : ''}`);
  r.dataset.key = o.key;
  const bar = el('span', 'bar');
  bar.style.setProperty('--c', groupColor(model.groups, o.group));
  r.append(bar);
  if (!o.allDay) r.append(el('span', 'when', timeLabel(o.start)));
  r.append(el('span', 'what', o.title));
  if (o.type === 'task') r.append(tickButton(o));
  return r;
}

function tickButton(o) {
  const t = el('button', 'tick');
  t.type = 'button';
  t.dataset.tick = o.key;
  t.setAttribute('aria-label', o.done ? `Mark "${o.title}" not done` : `Mark "${o.title}" done`);
  t.style.setProperty('--c', groupColor(model.groups, o.group));
  return t;
}

$('#grid').addEventListener('click', e => {
  const tick = e.target.closest('[data-tick]');
  if (tick) return toggleDone(visible.get(tick.dataset.tick));
  const cell = e.target.closest('[data-day]');
  if (!cell) return;
  if (phone()) return openDaySheet(cell.dataset.day);
  const row = e.target.closest('[data-key]');
  if (row) openEntry(visible.get(row.dataset.key));
  else openNew(cell.dataset.day);
});

// ---- navigation ----

const go = (y, m) => { view = { y, m }; render(); };
$('#prev').addEventListener('click', () => go(view.m ? view.y : view.y - 1, (view.m + 11) % 12));
$('#next').addEventListener('click', () => go(view.m === 11 ? view.y + 1 : view.y, (view.m + 1) % 12));
const jumpToday = () => { const n = new Date(); closeAll(); go(n.getFullYear(), n.getMonth()); };
$('#today').addEventListener('click', jumpToday);
$('#menu-today').addEventListener('click', jumpToday);

// ---- dropdown date picker ----

$('#period').addEventListener('click', () => {
  if (!$('#picker').hidden) return closeAll();
  closeAll();
  pick = { mode: 'days', y: view.y, m: view.m, base: view.y - 8 };
  renderPicker();
  openPop($('#picker'), $('#period'), 'left');
});

$('#pick-title').addEventListener('click', () => {
  pick.mode = pick.mode === 'days' ? 'years' : 'days';
  pick.base = pick.y - 8;
  renderPicker();
});
$('#pick-prev').addEventListener('click', () => pagePicker(-1));
$('#pick-next').addEventListener('click', () => pagePicker(1));

function pagePicker(dir) {
  if (pick.mode === 'years') pick.base += dir * 9;
  else {
    const m = pick.m + dir;
    pick.y += Math.floor(m / 12);
    pick.m = (m + 12) % 12;
  }
  renderPicker();
}

function renderPicker() {
  const body = $('#pick-body');
  if (pick.mode === 'years') {
    // 9 years ending with the current one; the arrows page by 9.
    $('#pick-label').textContent = `${pick.base} – ${pick.base + 8}`;
    body.className = 'pick-body years';
    body.replaceChildren(...Array.from({ length: 9 }, (_, i) => {
      const y = pick.base + i;
      const b = el('button', `pk${y === view.y ? ' now' : ''}`, String(y));
      b.type = 'button';
      b.addEventListener('click', () => { pick = { ...pick, mode: 'days', y }; renderPicker(); });
      return b;
    }));
    return;
  }
  $('#pick-label').textContent = at(pick.y, pick.m, 1).toLocaleDateString(undefined, MONTH);
  body.className = 'pick-body days';
  const today = todayKey();
  body.replaceChildren(
    ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(n => el('span', 'wh', n)),
    ...monthCells(pick.y, pick.m).map(d => {
      const k = localKey(d);
      const b = el('button', `pk${d.getMonth() !== pick.m ? ' out' : ''}${k === today ? ' now' : ''}`,
        String(d.getDate()));
      b.type = 'button';
      b.addEventListener('click', () => {
        closeAll();
        go(d.getFullYear(), d.getMonth());
        if (phone()) openDaySheet(k);
      });
      return b;
    }));
}

// ---- group filter ----

function groupNames() {
  const names = new Set(Object.keys(model.groups));
  let ungrouped = false;
  for (const e of [...model.dated, ...model.rules]) {
    if (e.data.group) names.add(e.data.group); else ungrouped = true;
  }
  const out = [...names].sort().map(n => [n, groupLabel(model.groups, n)]);
  if (ungrouped) out.push(['', 'no group']);
  return out;
}

// Built per host rather than cloned: cloneNode copies attributes, not the checked property.
function renderGroups() {
  const names = groupNames();
  for (const host of [$('#groups-list'), $('#menu-groups')])
    host.replaceChildren(...names.map(([n, label]) => groupRow(n, label)));
}

function groupRow(name, label) {
  const lab = el('label', 'glab');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !hiddenGroups.has(name);
  box.dataset.group = name;
  box.addEventListener('change', onGroupToggle);
  const sw = el('span', 'swatch');
  sw.style.setProperty('--c', groupColor(model.groups, name));
  lab.append(box, sw, el('span', '', label || name));
  return lab;
}

async function onGroupToggle(e) {
  const n = e.target.dataset.group;
  if (e.target.checked) hiddenGroups.delete(n); else hiddenGroups.add(n);
  await setKV('calendar.hiddenGroups', [...hiddenGroups]);
  renderGroups();
  render();
}

async function setAllGroups(hide) {
  hiddenGroups = new Set(hide ? groupNames().map(([n]) => n) : []);
  await setKV('calendar.hiddenGroups', [...hiddenGroups]);
  renderGroups();
  render();
}
$('#groups-all').addEventListener('click', () => setAllGroups(false));
$('#groups-none').addEventListener('click', () => setAllGroups(true));

$('#groups-btn').addEventListener('click', () => {
  if (!$('#groups-pop').hidden) return closeAll();
  closeAll();
  openPop($('#groups-pop'), $('#groups-btn'), 'right');
});

// ---- popovers, sheets ----

function openPop(pop, anchor, align) {
  pop.hidden = false;
  $('#scrim').hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = align === 'right' ? r.right - w : r.left;
  pop.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');
}

function openSheet(sheet) {
  closeAll();
  sheet.hidden = false;
  $('#scrim').hidden = false;
}

function closeAll() {
  for (const id of ['#picker', '#groups-pop', '#menu-sheet', '#day-sheet', '#scrim'])
    $(id).hidden = true;
  $('#period').setAttribute('aria-expanded', 'false');
  $('#groups-btn').setAttribute('aria-expanded', 'false');
}

$('#scrim').addEventListener('click', closeAll);
$('#menu-btn').addEventListener('click', () => openSheet($('#menu-sheet')));
$('#menu-close').addEventListener('click', closeAll);
$('#day-close').addEventListener('click', closeAll);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#popup').hidden) closePopup(); else closeAll();
});

// ---- day sheet (phone) ----

function openDaySheet(dayKey) {
  $('#day-sheet').dataset.day = dayKey;
  fillDaySheet(dayKey);
  openSheet($('#day-sheet'));
}

function fillDaySheet(dayKey) {
  $('#day-title').textContent =
    new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, DAY);
  const items = [...visible.values()].filter(o => o.dayKey === dayKey).sort(byStart);
  const list = $('#day-list');
  if (!items.length) {
    list.replaceChildren(el('p', 'day-empty', 'Nothing on this day.'));
  } else {
    list.replaceChildren(...items.map(o => {
      const b = el('div', `dentry${o.done ? ' done' : ''}`);
      b.dataset.key = o.key;
      const bar = el('span', 'bar');
      bar.style.setProperty('--c', groupColor(model.groups, o.group));
      const mid = el('div', 'mid');
      mid.append(el('span', 'dt', [o.allDay ? 'all-day' : timeLabel(o.start),
        groupLabel(model.groups, o.group), o.seriesId ? 'repeats' : ''].filter(Boolean).join(' · ')));
      mid.append(el('span', 'dn', o.title));
      b.append(bar, mid);
      if (o.type === 'task') b.append(tickButton(o));
      return b;
    }));
  }
}

$('#day-list').addEventListener('click', e => {
  const tick = e.target.closest('[data-tick]');
  if (tick) return toggleDone(visible.get(tick.dataset.tick));
  const row = e.target.closest('[data-key]');
  if (row) openEntry(visible.get(row.dataset.key));
});
$('#day-add').addEventListener('click', () => openNew($('#day-sheet').dataset.day));

// ---- the entry popup ----

const F = {
  title: $('#f-title'), done: $('#f-done'), allday: $('#f-allday'),
  startDate: $('#f-start-date'), startTime: $('#f-start-time'),
  endDate: $('#f-end-date'), endTime: $('#f-end-time'),
  group: $('#f-group'), location: $('#f-location'), recurrence: $('#f-recurrence'),
  alerts: $('#f-alerts'), participants: $('#f-participants'), body: $('#f-body')
};
// Keys the form owns. Anything else in the file - exdate, rdate, a hand-added key - survives.
const FORM_KEYS = ['title', 'type', 'start', 'end', 'done', 'group', 'location',
  'recurrence', 'alerts', 'participants'];
let curType = 'event';

function openNew(dayKey) {
  closeAll();
  openPopup({ occ: null, dayKey, scope: 'occurrence' });
}

function openEntry(occ) {
  if (!occ) return;
  closeAll();
  openPopup({ occ, dayKey: occ.dayKey, scope: 'occurrence' });
}

function openPopup(state) {
  editing = state;
  fillForm();
  $('#popup').hidden = false;
  $('#f-msg').textContent = '';
  requestAnimationFrame(() => { grow(); F.title.focus(); });
}

function closePopup() {
  $('#popup').hidden = true;
  editing = null;
}
$('#f-discard').addEventListener('click', closePopup);
$('#popup').addEventListener('click', e => { if (e.target === $('#popup')) closePopup(); });

function setType(t) {
  curType = t;
  for (const b of document.querySelectorAll('[data-type]'))
    b.setAttribute('aria-pressed', String(b.dataset.type === t));
  $('#f-done-wrap').classList.toggle('hidden', t !== 'task');
}
for (const b of document.querySelectorAll('[data-type]'))
  b.addEventListener('click', () => setType(b.dataset.type));

for (const b of document.querySelectorAll('[data-scope]'))
  b.addEventListener('click', () => {
    editing.scope = b.dataset.scope;
    fillForm();
    grow();
  });

F.allday.addEventListener('change', syncAllDay);
function syncAllDay() {
  const on = F.allday.checked;
  F.startTime.disabled = on;
  F.endTime.disabled = on;
  if (on) { F.startTime.value = ''; F.endTime.value = ''; }
}

F.body.addEventListener('input', grow);
function grow() {
  F.body.style.height = 'auto';
  F.body.style.height = `${F.body.scrollHeight + 2}px`;
}

function fillForm() {
  const { occ, scope } = editing;
  const series = occ && occ.seriesId && scope === 'series';
  const data = !occ ? { type: 'event', start: `${editing.dayKey}T09:00:00` }
    : series ? occ.seriesData : occ.data;
  const body = !occ ? '' : series ? occ.seriesBody : occ.body;

  $('#f-scope').hidden = !(occ && occ.seriesId);
  for (const b of document.querySelectorAll('[data-scope]'))
    b.setAttribute('aria-pressed', String(b.dataset.scope === scope));

  F.title.value = data.title ?? '';
  setType(data.type === 'task' ? 'task' : 'event');
  F.done.checked = data.done === true;

  const start = String(data.start ?? '');
  const allDay = isAllDay(start);
  F.allday.checked = allDay;
  if (allDay) {
    F.startDate.value = start.slice(0, 10);
    F.endDate.value = data.end ? String(data.end).slice(0, 10) : '';
  } else {
    const [sd, st] = localParts(start);
    F.startDate.value = sd;
    F.startTime.value = st;
    if (data.end) { const [ed, et] = localParts(String(data.end)); F.endDate.value = ed; F.endTime.value = et; }
    else if (!occ) { F.endDate.value = sd; F.endTime.value = '10:00'; }
    else { F.endDate.value = ''; F.endTime.value = ''; }
  }
  syncAllDay();

  const names = new Set([...Object.keys(model.groups), data.group].filter(Boolean));
  F.group.replaceChildren(...[['', '(no group)'], ...[...names].sort()
    .map(n => [n, groupLabel(model.groups, n)])].map(([v, t]) => {
      const o = el('option', '', t);
      o.value = v;
      return o;
    }));
  F.group.value = data.group ?? '';
  F.location.value = data.location ?? '';
  F.alerts.value = (data.alerts == null ? [] : [].concat(data.alerts)).join(', ');
  F.participants.value = (data.participants == null ? [] : [].concat(data.participants)).join(', ');
  F.body.value = body ?? '';

  // Only the series carries the rule; an occurrence override must never rewrite it.
  const canRule = !occ || series || !occ.seriesId;
  $('#f-rec-wrap').classList.toggle('hidden', !canRule);
  F.recurrence.value = canRule ? (data.recurrence ?? '') : '';

  const isOcc = occ && occ.seriesId && scope === 'occurrence';
  $('#f-skip').hidden = !isOcc;
  $('#f-delete').hidden = !occ;
  $('#f-delete').textContent = occ && occ.seriesId ? 'delete series' : 'delete';
  $('#f-path').textContent = !occ ? 'New entry.'
    : series ? occ.seriesPath
      : isOcc ? `${occ.seriesPath} · occurrence ${occ.recId}${occ.override ? ` · override ${occ.path}` : ''}`
        : occ.path;
}

// Local wall clock out of a stored instant, for the date and time inputs.
function localParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return [iso.slice(0, 10), iso.slice(11, 16)];
  return [localKey(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`];
}
// What the user typed is local wall clock; stored as an instant in the Z form.
const toZ = (date, time) =>
  new Date(`${date}T${time || '00:00'}`).toISOString().replace(/\.\d{3}Z$/, 'Z');

const splitList = v => v.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

function collect(base) {
  const data = { ...base };
  for (const k of FORM_KEYS) delete data[k];

  data.title = F.title.value.trim();
  data.type = curType;
  const allDay = F.allday.checked;
  const sd = F.startDate.value, st = F.startTime.value || '00:00';
  const ed = F.endDate.value, et = F.endTime.value;
  data.start = allDay ? sd : toZ(sd, st);
  if (allDay) { if (ed && ed !== sd) data.end = ed; }
  else if (ed || et) data.end = toZ(ed || sd, et || st);
  if (curType === 'task') data.done = F.done.checked;
  if (F.group.value) data.group = F.group.value;
  if (F.location.value.trim()) data.location = F.location.value.trim();
  if (!$('#f-rec-wrap').classList.contains('hidden')) {
    const r = F.recurrence.value.trim().replace(/^RRULE:/i, '');
    if (r) data.recurrence = r;
  }
  const alerts = splitList(F.alerts.value).map(Number).filter(Number.isFinite);
  if (alerts.length) data.alerts = alerts;
  const parts = splitList(F.participants.value);
  if (parts.length) data.participants = parts;
  return data;
}

$('#entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { occ, scope } = editing;
  const series = occ && occ.seriesId && scope === 'series';
  const base = !occ ? {} : series ? occ.seriesData : occ.data;
  const data = collect(base);
  const body = F.body.value;
  await commit('save', async () => {
    if (!occ) await createEntry(data, body);
    else if (occ.seriesId && scope === 'occurrence') await saveOverride(occ, data, body);
    else if (occ.seriesId) await updateEntry(occ.seriesPath, data, body);
    else await updateEntry(occ.path, data, body);
  });
});

$('#f-skip').addEventListener('click', () =>
  commit('skip', () => skipOccurrence(editing.occ)));

$('#f-delete').addEventListener('click', () => {
  const { occ } = editing;
  const what = occ.seriesId
    ? `Delete the whole repeating entry "${occ.title}"? Its override files stay behind.`
    : `Delete "${occ.title}"?`;
  if (!confirm(what)) return;
  commit('delete', () => deleteEntry(occ.seriesId ? occ.seriesPath : occ.path));
});

// Every write already updated the local mirror before drain() pushed it, so the view is
// refreshed either way: offline the change is queued and still on screen.
async function commit(what, fn) {
  const btn = $('#f-save');
  btn.disabled = true;
  $('#f-msg').textContent = '';
  try {
    await fn();
    closePopup();
  } catch (err) {
    $('#f-msg').textContent = `${what} queued but not pushed: ${err.message}`;
    $('#f-msg').className = 'msg bad';
  } finally {
    btn.disabled = false;
    model = await loadModel();
    renderGroups();
    render();
    showSync();
  }
}

async function toggleDone(o) {
  if (!o || o.type !== 'task') return;
  try {
    if (o.seriesId) await saveOverride(o, { ...o.data, done: !o.done }, o.body);
    else await updateEntry(o.path, { ...o.data, done: !o.done }, o.body, { move: false });
  } catch (err) {
    status(`queued, not pushed: ${err.message}`, true);
  }
  model = await loadModel();
  render();
  showSync();
}

// ---- sync ----

const status = (text, bad) => {
  const s = $('#sync');
  s.textContent = text;
  s.classList.toggle('bad', !!bad);
};

async function showSync() {
  const n = await queuedCount();
  if (n) status(`${n} change(s) pending`);
  else status('in sync');
}

async function refresh() {
  if (await queuedCount()) return showSync();
  status('checking…');
  try {
    const r = await pull();                    // whole repo: the mirror and the ETag are shared
    if (!r.unchanged) { model = await loadModel(); renderGroups(); render(); }
    status(r.empty ? 'repo is empty' : r.unchanged ? 'in sync' : `in sync — ${r.changed} file(s) updated`);
  } catch (err) {
    status(err.message, true);
  }
}

// ---- boot ----

renderWeekhead();
matchMedia('(min-width: 600px)').addEventListener('change', () => { closeAll(); render(); });

if (!await getConfig()) {
  $('#needs-setup').hidden = false;
} else {
  $('#cal').hidden = false;
  hiddenGroups = new Set(await getKV('calendar.hiddenGroups') || []);
  model = await loadModel();
  renderGroups();
  render();
  await refresh();
  addEventListener('focus', refresh);
}
