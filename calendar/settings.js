// The hamburger's three errands, each its own overlay. The filter is a dropdown off the hamburger,
// because it is the half you open often and the view it narrows has to stay in sight while you
// narrow it; the settings are the nine rows that change once, so they are a centred panel. One
// panel held both until the two were told apart by a heading alone - which is a weak way to
// separate a thing you open daily from a thing you open twice, and it cost the filter the room
// to show its groups. The logs are a centred panel too; what goes in it is drawn by
// ../shared/sync.js, because the queue it reports on is shared with every other app.
//
// Everything here is stored on the device except the groups, the sprint length and the first
// sprint date: those three are data and live in the repo, because the sprint a task belongs to
// is derived from them and two devices that disagreed would put the same card in different
// sprints. Theme and date format are Mine-wide, not the calendar's.
//
// Every settings row is two halves - the label on the left, its control on the right - so the
// controls line up in one column. The row and its four controls are in ../shared/ui.js. The
// groups are behind a button rather than listed, because a list grew with the repo and pushed
// the nine settings that never change below the fold.
import { setKV } from '../shared/store.js';
import { renderLogs } from '../shared/sync.js';
import { STAGES, saveSettings, setZone, getZone } from './data.js';
import { THEMES, DATE_FORMATS, applyTheme, setPref } from '../shared/prefs.js';
import { openGroups } from './popup.js';
import {
  S, $, el, closePops, openPop, openCentred, colorOf, labelOf, STAGE_COLOR, STAGE_LABEL,
  row, choose, toggle, numberField, dateField
} from './ui.js';

export function openFilter() {
  closePops();
  renderFilter();
  openPop($('#filter-pop'), $('#menu-btn'), 'right');
}

export function openPanel() {
  closePops();
  build();
  openCentred($('#settings-panel'));
}

export function openLogs() {
  closePops();
  openCentred($('#logs-panel'));
  renderLogs($('#logs-body'), S.sync);
}

// ---- the filter ----------------------------------------------------------------------------
// A view filter, remembered per device. Groups are named and coloured in the settings panel's
// `edit groups`, not here.

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

// The groups are a plain list of checkboxes. They were folded behind a `groups · 3 of 4` row for
// one reason - an open list pushed the nine settings rows below the fold - and that reason went
// when the settings moved into a panel of their own. One tap hides a group now instead of two,
// and a repo with twenty groups scrolls inside the dropdown rather than growing it.

export function renderFilter() {
  const names = groupNames();
  const kids = [];

  for (const [name, label] of names) {
    const lab = el('label', 'glab grp');
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

  // The stages and importance narrow **every** view, not only the board: a month with the done
  // ones out of it is as much a thing to want as a board of them, and importance is on an event
  // now. Both are remembered per device, like the groups - a filter that empties a month is one
  // you want to find still on after a reload, and the hamburger's count says it is.
  kids.push(el('div', 'fsep'));
  for (const stage of STAGES) {
    const lab = el('label', 'glab stg');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !S.hiddenStages.has(stage);
    box.addEventListener('change', async () => {
      if (box.checked) S.hiddenStages.delete(stage); else S.hiddenStages.add(stage);
      await setKV('calendar.hiddenStages', [...S.hiddenStages]);
      S.render();
    });
    const sw = el('span', 'swatch');
    sw.style.background = STAGE_COLOR[stage];
    lab.append(box, sw, el('span', '', STAGE_LABEL[stage]));
    kids.push(lab);
  }

  const imp = el('label', 'glab imp');
  const impBox = el('input');
  impBox.type = 'checkbox';
  impBox.checked = S.kfilter.importantOnly;
  impBox.addEventListener('change', async () => {
    S.kfilter.importantOnly = impBox.checked;
    await setKV('calendar.importantOnly', impBox.checked);
    S.render();
  });
  imp.append(impBox, el('span', 'glyph', '!'), el('span', '', 'important only'));
  kids.push(imp);

  // The assignee stays the board's own: a card is the one place a name is read off an entry.
  if (S.view.mode === 'K') {
    const people = [...new Set([...S.model.dated, ...S.model.rules]
      .flatMap(e => [].concat(e.data.participants ?? []).map(String)))].sort();
    kids.push(row('Assignee', choose([['', 'anyone'], ...people.map(p => [p, p])],
      S.kfilter.assignee, v => { S.kfilter.assignee = v; S.render(); })));
  }

  $('#filter-body').replaceChildren(...kids);
  renderFilterCount();
}

// A filter that is on says so on the hamburger, which is otherwise the one button in the pane
// that looks the same whatever it is doing. The count is **one per kind of narrowing** - the
// groups, the stages, importance, the assignee - rather than one per switched-off thing: a repo
// with twenty groups and fifteen hidden would read 16, which is a true number nobody can act
// on, where 4 says there are four things to look at in the one place that lists them.
export function filterCount() {
  return (S.hidden.size ? 1 : 0) + (S.hiddenStages.size ? 1 : 0)
    + (S.kfilter.importantOnly ? 1 : 0) + (S.kfilter.assignee ? 1 : 0);
}

export function renderFilterCount() {
  const n = filterCount();
  $('#menu-btn').querySelector('.fcount')?.remove();
  $('#menu-btn').setAttribute('aria-label',
    n ? `Filter and settings — ${n} filter${n > 1 ? 's' : ''} on` : 'Filter and settings');
  if (n) $('#menu-btn').append(el('span', 'fcount', String(n)));
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
// `row` and its four controls come from ../shared/ui.js. The two below are the calendar's own:
// one opens a popup, the other validates a zone name.

// The same popup the entry popup's category field opens, in its manage-only form: one place
// where a group is named or coloured, so there is no second list to keep in step.
function groupsButton() {
  const b = el('button', 'link', 'edit groups');
  b.type = 'button';
  b.id = 'edit-groups';
  b.addEventListener('click', openGroups);
  return b;
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
