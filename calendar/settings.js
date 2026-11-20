// The settings panel behind the gear.
//
// Everything here is stored on the device except the groups, the kanban interval and the kanban
// first week start date: those three are data and live in the repo, because the sprint a task
// belongs to is derived from them and two devices that disagreed would put the same card in
// different sprints. Theme and date format are Mine-wide, not the calendar's.
import { setKV } from '../shared/store.js';
import { saveGroups, saveSettings, createGroup, setZone, getZone } from './data.js';
import { THEMES, DATE_FORMATS, applyTheme, setPref } from '../shared/prefs.js';
import { S, $, el, iconBtn, closePops } from './ui.js';

let editing = null;        // the group name whose row is in edit mode

export function openSettings() {
  closePops();
  editing = null;
  build();
  $('#settings-sheet').hidden = false;
  $('#scrim').hidden = false;
}

function build() {
  $('#settings-body').replaceChildren(
    el('h3', 'shead', 'Groups'),
    groupList(),
    row('Start week on', choose([[1, 'Monday'], [0, 'Sunday']], S.prefs.weekStart,
      v => local('weekStart', Number(v)))),
    row('Time zone', zoneField()),
    row('Date format', choose(DATE_FORMATS.map(f => [f, f]), S.prefs.dateFormat,
      v => mine('dateFormat', v))),
    row('Show calendar weeks', toggle(S.prefs.showWeeks, v => local('showWeeks', v))),
    row('Kanban interval', numberField(S.model.settings.interval, 1,
      v => sprints({ interval: v })), 'weeks'),
    row('Kanban first week start date', dateField(S.model.settings.anchor,
      v => sprints({ anchor: v }))),
    row('Theme', choose(THEMES.map(t => [t, t]), S.prefs.theme, v => mine('theme', v))),
    el('p', 'note', 'Stored on this device, except the groups, the kanban interval and the '
      + 'kanban first week start date: those are data and live in the repo, so they follow you '
      + 'and mean the same thing everywhere. Theme and date format apply to all of Mine.')
  );
}

// ---- rows ----------------------------------------------------------------------------------

function row(label, control, suffix) {
  const r = el('div', 'srow');
  r.append(el('span', 'slab', label), control);
  if (suffix) r.append(el('span', 'ssuf', suffix));
  return r;
}

function choose(options, current, onChange) {
  const s = el('select');
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = String(v);
    if (String(v) === String(current)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function toggle(current, onChange) {
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!current;
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}

function numberField(current, min, onChange) {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.value = String(current);
  i.addEventListener('change', () => {
    const n = Number(i.value);
    if (Number.isInteger(n) && n >= min) onChange(n); else i.value = String(current);
  });
  return i;
}

function dateField(current, onChange) {
  const i = el('input');
  i.type = 'date';
  i.value = current;
  i.addEventListener('change', () => { if (i.value) onChange(i.value); });
  return i;
}

// A zone name, not an offset: a plain UTC+1 is an hour wrong for half the year in any zone with
// daylight saving. Empty means the device's own.
function zoneField() {
  const i = el('input');
  i.value = S.prefs.timeZone;
  i.placeholder = getZone();
  i.autocapitalize = 'off';
  i.spellcheck = false;
  i.addEventListener('change', () => {
    const typed = i.value.trim();
    const chosen = setZone(typed);
    if (typed && chosen !== typed) {
      i.value = '';
      S.status(`"${typed}" is not a zone name — using ${chosen}.`, true);
    }
    local('timeZone', i.value.trim());
    i.placeholder = getZone();
  });
  return i;
}

// ---- groups --------------------------------------------------------------------------------
// A group's stored name is derived from its label and never shown, which is why relabelling or
// recolouring touches no entry. Entries naming a deleted group render grey.

function groupList() {
  const wrap = el('div', 'glist');
  for (const [name, g] of Object.entries(S.model.groups))
    wrap.append(name === editing ? groupForm(name, g) : groupRow(name, g));
  if (editing === '') wrap.append(groupForm('', { color: '#2980b9', label: '' }));
  else {
    const add = el('button', 'link', '+ add group');
    add.type = 'button';
    add.addEventListener('click', () => { editing = ''; build(); });
    wrap.append(add);
  }
  return wrap;
}

function groupRow(name, g) {
  const r = el('div', 'grow');
  const sw = el('span', 'swatch');
  sw.style.background = g.color || '#9aa5b1';
  r.append(sw, el('span', 'gname', g.label || name));
  const pen = iconBtn('pen', `Edit ${g.label || name}`);
  pen.addEventListener('click', () => { editing = name; build(); });
  const del = iconBtn('trash', `Delete ${g.label || name}`);
  del.addEventListener('click', () => removeGroup(name, g));
  r.append(pen, del);
  return r;
}

function groupForm(name, g) {
  const r = el('div', 'grow');
  const label = el('input');
  label.value = g.label || name;
  label.placeholder = 'Label';
  const color = el('input');
  color.type = 'color';
  color.value = g.color || '#2980b9';
  const ok = iconBtn('disk', 'Save');
  ok.addEventListener('click', async () => {
    const text = label.value.trim();
    if (!text) return;
    if (name) await write({ ...S.model.groups, [name]: { color: color.value, label: text } },
      `edit category ${text}`);
    else {
      await createGroup(S.model.groups, text, color.value);
      await after(`add category ${text}`);
    }
  });
  const cancel = iconBtn('x', 'Cancel');
  cancel.addEventListener('click', () => { editing = null; build(); });
  r.append(label, color, ok, cancel);
  return r;
}

function removeGroup(name, g) {
  if (!confirm(`Delete the category "${g.label || name}"? Entries still naming it render grey.`)) return;
  const rest = { ...S.model.groups };
  delete rest[name];
  write(rest, `delete category ${g.label || name}`);
}

async function write(groups, what) {
  await saveGroups(groups);
  await after(what);
}

async function sprints(patch) {
  await saveSettings({ ...S.model.settings, ...patch });
  await after('sprint settings');
}

async function after(what) {
  editing = null;
  S.model = await S.reload();
  build();
  S.render();
  S.push(`calendar: ${what}`);
}

// ---- device preferences --------------------------------------------------------------------

async function local(key, value) {
  S.prefs[key] = value;
  await setKV(`calendar.${key}`, value);
  S.render();
}

async function mine(key, value) {
  S.prefs[key] = value;
  await setPref(key, value);
  if (key === 'theme') applyTheme(value);
  S.render();
}
