// The panel behind the hamburger: the filter at the top, the settings below it, under a heading
// each. They are one panel because they are one errand - both are things you adjust about the
// view in front of you and then leave alone, and two buttons a thumb's width apart asked which
// of the two a given switch was before you could reach it. Merging them also freed the slot the
// zoom took, which is what keeps the pane at four controls.
//
// Everything here is stored on the device except the groups, the sprint length and the first
// sprint date: those three are data and live in the repo, because the sprint a task belongs to
// is derived from them and two devices that disagreed would put the same card in different
// sprints. Theme and date format are Mine-wide, not the calendar's.
//
// Every row is two halves - the label on the left, its control on the right - so the controls
// line up in one column. That alignment is the whole of what the panel was missing: a select, a
// text box, a checkbox and a date field each started wherever its own label happened to end.
// The groups are behind a button rather than listed, because a list grew with the repo and
// pushed the nine settings that never change below the fold.
import { setKV } from '../shared/store.js';
import { saveSettings, setZone, getZone } from './data.js';
import { THEMES, DATE_FORMATS, applyTheme, setPref } from '../shared/prefs.js';
import { openGroups } from './popup.js';
import { S, $, el, closePops, openCentred, colorOf, labelOf } from './ui.js';

export function openPanel() {
  closePops();
  build();
  renderFilter();
  openCentred($('#settings-panel'));
}

// ---- the filter ----------------------------------------------------------------------------
// A view filter, remembered per device. Groups are named and coloured below, in the settings
// section's `edit groups`, not here.

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
// same checkboxes. Folded is how it starts, and that is load bearing twice over now - a repo
// with twenty groups would otherwise give the panel a filter taller than the screen and push
// the nine settings rows below the fold.
let groupsOpen = false;

export function renderFilter() {
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
      S.render();
    });
    const sw = el('span', 'swatch');
    sw.style.background = colorOf(name);
    lab.append(box, sw, el('span', '', label || name));
    kids.push(lab);
  }

  // Importance and assignee narrow the board, where a sprint can hold more cards than fit. One
  // switch, now that importance is a yes or no rather than three tiers to pick between.
  if (S.view.mode === 'K') {
    const chip = el('button', `chip${S.kfilter.importantOnly ? ' on' : ''}`, '!');
    chip.type = 'button';
    chip.title = 'Important only';
    chip.setAttribute('aria-label', 'Important only');
    chip.setAttribute('aria-pressed', String(S.kfilter.importantOnly));
    chip.addEventListener('click', () => {
      S.kfilter.importantOnly = !S.kfilter.importantOnly;
      S.render();
    });
    kids.push(row('Important only', chip));

    const people = [...new Set([...S.model.dated, ...S.model.rules]
      .flatMap(e => [].concat(e.data.participants ?? []).map(String)))].sort();
    kids.push(row('Assignee', choose([['', 'anyone'], ...people.map(p => [p, p])],
      S.kfilter.assignee, v => { S.kfilter.assignee = v; S.render(); })));
  }

  $('#filter-body').replaceChildren(...kids);
}

// Nine rows and nothing after them: there is no paragraph explaining what is stored where,
// because that belongs in REQUIREMENTS.md and not on a panel opened to change the theme.
function build() {
  $('#settings-body').replaceChildren(
    row('Groups', groupsButton()),
    row('Start week on', choose([[1, 'Monday'], [0, 'Sunday']], S.prefs.weekStart,
      v => local('weekStart', Number(v)))),
    row('Time zone', zoneField()),
    row('Date format', choose(DATE_FORMATS.map(f => [f, f]), S.prefs.dateFormat,
      v => mine('dateFormat', v))),
    row('Calendar weeks', toggle(S.prefs.showWeeks, v => local('showWeeks', v))),
    // The way back on. A prompt silenced from inside itself needs a row that can restore it,
    // because nothing in Mine may be switched off from a place that cannot switch it back on.
    row('Confirm discard', toggle(S.prefs.confirmDiscard, v => local('confirmDiscard', v))),
    row('Sprint length', numberField(S.model.settings.interval, 1,
      v => sprints({ interval: v })), 'weeks'),
    row('First sprint', dateField(S.model.settings.anchor, v => sprints({ anchor: v }))),
    row('Theme', choose(THEMES.map(t => [t, t]), S.prefs.theme, v => mine('theme', v)))
  );
}

// ---- rows ----------------------------------------------------------------------------------

// Two halves. A unit shares the right half with its control rather than dropping below it,
// which is the one place a row would otherwise go ragged again.
function row(label, control, suffix) {
  const r = el('div', 'srow');
  r.append(el('span', 'slab', label));
  if (!suffix) r.append(control);
  else {
    const v = el('div', 'sval');
    v.append(control, el('span', 'ssuf', suffix));
    r.append(v);
  }
  return r;
}

// The same popup the entry popup's category field opens, in its manage-only form: one place
// where a group is named or coloured, so there is no second list to keep in step.
function groupsButton() {
  const b = el('button', 'link', 'edit groups');
  b.type = 'button';
  b.id = 'edit-groups';
  b.addEventListener('click', openGroups);
  return b;
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

// ---- writes --------------------------------------------------------------------------------

async function sprints(patch) {
  await saveSettings({ ...S.model.settings, ...patch });
  S.model = await S.reload();
  build();
  S.render();
  S.push('calendar: sprint settings');
}

async function local(key, value) {
  S.prefs[key] = value;
  await setKV(`calendar.${key}`, value);
  S.render();
}

// A re-render redraws the filter, because the board's two controls are only in it on the board.
// `S.render()` calls back into renderFilter, so this file does not have to.

async function mine(key, value) {
  S.prefs[key] = value;
  await setPref(key, value);
  if (key === 'theme') applyTheme(value);
  S.render();
}
