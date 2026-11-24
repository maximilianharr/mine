// The calendar's model: the local mirror in, entries and occurrences out.
//
// Three rules run through all of this:
//   * The path is never the source of truth for a date - frontmatter `start` is. After a move
//     or an override the two legitimately disagree, so nothing here parses a filename.
//   * A bare date (2026-04-18) is a calendar date. All arithmetic on it is UTC string
//     arithmetic, never a local Date, so neither a zone nor DST can shift it by a day.
//   * An instant (2026-04-18T14:00:00Z) is placed in the *configured* zone, which defaults to
//     the device's. rrule.js works in UTC: an all-day rule is anchored at UTC midnight and read
//     back with getUTC*(), because getDate() on it returns the previous day east of UTC.
import { parse, serialize } from '../shared/md.js';
import { RRule } from '../shared/vendor/rrule.mjs';
import { allFiles, getFile } from '../shared/store.js';
import { write, remove } from '../shared/github.js';

const ROOT = 'calendar';
const UNKNOWN_COLOR = '#9aa5b1';          // group not in groups.md renders grey
export const STAGES = ['todo', 'doing', 'done'];
export const DEFAULT_ANCHOR = '2024-01-01';   // a Monday. Every device agrees until settings.md exists.

export const pad = n => String(n).padStart(2, '0');

// ---- the configured zone -----------------------------------------------------------------
// Which day a timed entry lands in, and what a typed time means, follow this zone rather than
// the device's. Set once at boot and whenever the setting changes.

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
let zone = deviceZone();
const formatters = new Map();

export function setZone(name) {
  const z = name || deviceZone();
  try { new Intl.DateTimeFormat('en-CA', { timeZone: z }); zone = z; }
  catch { zone = deviceZone(); }           // an unknown zone name must not break rendering
  return zone;
}
export const getZone = () => zone;

function wall(d) {
  let f = formatters.get(zone);
  if (!f) formatters.set(zone, f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }));
  const p = {};
  for (const { type, value } of f.formatToParts(d)) p[type] = value;
  return p;
}

// The zone's offset in minutes at that instant - read off the wall clock, so DST is included
// without a table.
function offsetAt(d) {
  const p = wall(d);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return (asUTC - Math.floor(d.getTime() / 60000) * 60000) / 60000;
}

// Wall clock in the configured zone -> the instant we store. Two passes, because the offset
// depends on the answer: a time an hour either side of a DST change resolves on the first pass
// with the wrong offset and on the second with the right one. A wall-clock time that does not
// exist (the hour a zone skips in spring) resolves onto the real time before the gap, which is
// stable: it reads back as that time rather than drifting on every save.
export function toInstant(dateKey, time) {
  const naive = Date.parse(`${dateKey}T${time || '00:00'}:00Z`);
  if (isNaN(naive)) return '';
  let t = naive - offsetAt(new Date(naive)) * 60000;
  t = naive - offsetAt(new Date(t)) * 60000;
  return instant(new Date(t));
}

// The date and time inputs show the configured zone's wall clock.
export function wallParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return [String(iso).slice(0, 10), String(iso).slice(11, 16)];
  const p = wall(d);
  return [`${p.year}-${p.month}-${p.day}`, `${pad(+p.hour % 24)}:${p.minute}`];
}

// ---- dates -------------------------------------------------------------------------------

export const isAllDay = v => !String(v).includes('T');
const utcKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const todayKey = () => { const p = wall(new Date()); return `${p.year}-${p.month}-${p.day}`; };

// Calendar-date arithmetic: bare keys in, bare keys out, UTC throughout.
export const dayKeyOf = (y, m, d) => utcKey(new Date(Date.UTC(y, m, d)));
export const addDays = (key, n) => utcKey(new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000));
export const diffDays = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const partsOf = key => key.split('-').map(Number);          // [y, m 1-12, d]
export const dowOf = key => new Date(Date.parse(`${key}T00:00:00Z`)).getUTCDay();   // 0 = Sunday
export const addMonths = (key, n) => {
  const [y, m, d] = partsOf(key);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return dayKeyOf(y, m - 1 + n, Math.min(d, last));
};
// weekStart is 1 for Monday, 0 for Sunday.
export const weekStartOf = (key, weekStart) => addDays(key, -((dowOf(key) - weekStart + 7) % 7));

// Whole weeks covering the month, beginning on the configured first day of the week.
export function monthGrid(y, m, weekStart) {
  const first = weekStartOf(dayKeyOf(y, m, 1), weekStart);
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const weeks = Math.ceil((diffDays(first, dayKeyOf(y, m, days)) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
}

// ISO 8601 week number: the week holding this date's Thursday, counted from the week holding
// 4 January. Always ISO, whichever day the view starts the week on.
export function isoWeek(key) {
  const thu = addDays(key, 3 - ((dowOf(key) + 6) % 7));
  const [y] = partsOf(thu);
  const firstThu = addDays(`${y}-01-04`, 3 - ((dowOf(`${y}-01-04`) + 6) % 7));
  return Math.round(diffDays(firstThu, thu) / 7) + 1;
}

// The day cell an entry falls in.
function keyOf(start) {
  const s = String(start);
  if (isAllDay(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d)) return s.slice(0, 10);
  const p = wall(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// Minutes from midnight in the configured zone, or null for an all-day item (which sorts first).
function minutesOf(start) {
  const s = String(start);
  if (isAllDay(s)) return null;
  const d = new Date(s);
  if (isNaN(d)) return null;
  const p = wall(d);
  return (+p.hour % 24) * 60 + +p.minute;
}

export function timeLabel(start) {
  const m = minutesOf(start);
  return m === null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const instant = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// The occurrence id used by `recurrence-id`, `exdate` and `rdate`: the occurrence's own start
// value, in the same value type as the series start.
const occIdOf = (d, allDay) => allDay ? utcKey(d) : instant(d);

export const list = v => v == null ? [] : Array.isArray(v) ? v : [v];

// ---- task fields -------------------------------------------------------------------------

// `stage` is a task's only progress field; an unreadable or absent one is `todo`.
export const stageOf = data => STAGES.includes(data.stage) ? data.stage : 'todo';

// Importance is a yes or no. Only `true` is ever written; a task that is not important carries
// no key at all. The quoted form is read too, because a file may be written by hand.
export const importantOf = data => data.important === true || data.important === 'true';

const estimateOf = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ---- the model ---------------------------------------------------------------------------

export async function loadModel() {
  return buildModel(await allFiles(ROOT + '/'));
}

// Pure, so it can be exercised from node against the same files the browser mirrors.
export function buildModel(files) {
  const groups = {}, dated = [], rules = [], overrides = new Map();
  let settings = readSettings({});
  for (const f of files) {
    if (!f.path.endsWith('.md') || f.text == null) continue;
    const { data, body } = parse(f.text);
    if (data.conflictOf) continue;               // a conflict copy would render twice
    if (f.path === `${ROOT}/groups.md`) { Object.assign(groups, data.groups || {}); continue; }
    if (f.path === `${ROOT}/settings.md`) { settings = readSettings(data); continue; }
    const e = { path: f.path, data, body };
    // Classified by content, not by folder: the path is never the source of truth.
    if (data.series && data['recurrence-id'] != null)
      overrides.set(`${data.series}|${String(data['recurrence-id'])}`, e);
    else if (data.recurrence) { e.id = idOf(f.path); rules.push(e); }
    else if (data.start) dated.push(e);
  }
  return { groups, dated, rules, overrides, settings };
}

function readSettings(data) {
  const n = Number(data['kanban-interval']);
  const a = String(data['kanban-anchor'] ?? '');
  return {
    anchor: /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : DEFAULT_ANCHOR,
    interval: Number.isFinite(n) && n >= 1 ? Math.round(n) : 2
  };
}

const idOf = path => path.split('/').pop().replace(/\.md$/, '');

export const groupColor = (groups, name) => groups?.[name]?.color || UNKNOWN_COLOR;
export const groupLabel = (groups, name) => groups?.[name]?.label || name || '';

// ---- sprints -----------------------------------------------------------------------------
// There is no `sprint` key. Sprint n runs for `interval` weeks from `anchor + (n-1) x interval`
// weeks, and a task's sprint is whichever range its start falls in - so the number can never
// contradict the date, because there is only the date.

export function sprintOf(key, s) {
  const d = diffDays(s.anchor, key);
  return d < 0 ? null : Math.floor(d / (s.interval * 7)) + 1;
}

export function sprintRange(n, s) {
  const start = addDays(s.anchor, (n - 1) * s.interval * 7);
  return { n, start, end: addDays(start, s.interval * 7 - 1) };
}

// ---- rendering a range ------------------------------------------------------------------
// fromKey/toKey are inclusive 'YYYY-MM-DD'.

export function occurrences(model, fromKey, toKey) {
  const out = [];
  for (const e of model.dated) {
    const k = keyOf(e.data.start);
    if (k >= fromKey && k <= toKey) out.push(occurrence(e, { data: e.data, body: e.body }));
  }
  for (const r of model.rules) expandRule(r, model.overrides, fromKey, toKey, out);
  out.sort(byStart);
  return out;
}

// All-day first, then by time, then by title so the order is stable across reloads.
export function byStart(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.minutes ?? 0) - (b.minutes ?? 0) || a.title.localeCompare(b.title);
}

// Cards: the important ones first, then start. Cards are never reordered by hand.
export function byImportance(a, b) {
  return (b.important ? 1 : 0) - (a.important ? 1 : 0) || byStart(a, b);
}

function occurrence(file, { data, body, base = null, series = null, recId = null, override = null }) {
  const start = String(data.start ?? '');
  const type = data.type === 'task' ? 'task' : 'event';
  return {
    key: series ? `${series.id}|${recId}` : file.path,
    path: override ? override.path : file.path,
    seriesId: series?.id ?? null,
    seriesPath: series?.path ?? null,
    seriesData: series?.data ?? null,
    seriesBody: series?.body ?? null,
    base,                                        // the occurrence as the rule alone defines it
    recId,
    override: !!override,
    data, body,
    title: String(data.title ?? '(untitled)'),
    type,
    group: data.group ?? '',
    stage: type === 'task' ? stageOf(data) : null,
    important: type === 'task' ? importantOf(data) : false,
    estimate: type === 'task' ? estimateOf(data.estimate) : null,
    location: data.location ?? '',
    participants: list(data.participants).map(String),
    allDay: isAllDay(start),
    start,
    end: data.end == null ? '' : String(data.end),
    dayKey: keyOf(start),
    minutes: minutesOf(start)
  };
}

function expandRule(rule, overrides, fromKey, toKey, out) {
  const seriesStart = String(rule.data.start ?? '');
  const allDay = isAllDay(seriesStart);
  const rr = ruleOf(rule.data);
  if (!rr) return;

  // The range is days in the configured zone; rrule answers in UTC. A day of padding either
  // side covers the offset, and the dayKey test below drops whatever falls outside after
  // conversion.
  const from = new Date(Date.parse(`${fromKey}T00:00:00Z`) - 86400000);
  const to = new Date(Date.parse(`${toKey}T00:00:00Z`) + 2 * 86400000);
  if (isNaN(from) || isNaN(to)) return;

  const ids = new Set(rr.between(from, to, true).map(d => occIdOf(d, allDay)));
  for (const v of list(rule.data.rdate)) ids.add(String(v));
  // An exdate may be written as a bare date even for a timed series; that skips the day.
  const ex = new Set(list(rule.data.exdate).map(String));

  const dur = durationOf(rule.data);
  for (const id of ids) {
    if (ex.has(id) || ex.has(id.slice(0, 10))) continue;
    const ov = overrides.get(`${rule.id}|${id}`);
    if (ov?.data.status === 'cancelled') continue;

    // The occurrence as the rule alone defines it, then the override's keys on top. Keeping
    // the pristine form is what lets a save record only the keys that genuinely differ.
    const base = { ...rule.data, start: id, end: dur != null ? shift(id, dur) : undefined };
    delete base.exdate; delete base.rdate;       // belong to the series, not the occurrence
    const data = { ...base, ...(ov?.data || {}) };
    data.start = String(data.start); if (data.end != null) data.end = String(data.end);

    const o = occurrence(rule, {
      data, base,
      body: ov && ov.body.trim() ? ov.body : rule.body,
      series: rule, recId: id, override: ov || null
    });
    if (o.dayKey >= fromKey && o.dayKey <= toKey) out.push(o);
  }
}

// An RRULE string with no DTSTART line, anchored on `start`. UTC midnight for an all-day rule.
function ruleOf(data) {
  const s = String(data.start ?? '');
  const dtstart = new Date(isAllDay(s) ? `${s.slice(0, 10)}T00:00:00Z` : s);
  if (isNaN(dtstart)) return null;
  try { return new RRule({ ...RRule.parseString(String(data.recurrence)), dtstart }); }
  catch { return null; }
}

// There is no `duration` key: it is end - start. Days for all-day, milliseconds for an instant.
function durationOf(data) {
  if (data.end == null || data.start == null) return null;
  const a = String(data.start), b = String(data.end);
  if (isAllDay(a) !== isAllDay(b)) return null;
  if (isAllDay(a)) return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const ms = Date.parse(b) - Date.parse(a);
  return isNaN(ms) ? null : ms;
}

function shift(start, dur) {
  if (isAllDay(start)) return utcKey(new Date(Date.parse(`${start}T00:00:00Z`) + dur * 86400000));
  return instant(new Date(Date.parse(start) + dur));
}

// ---- paths ------------------------------------------------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// 4 random characters, not a counter: two devices creating entries offline on the same day
// must never mint the same name.
function rand4() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map(n => ALPHABET[n % ALPHABET.length]).join('');
}

function slug(title) {
  const s = String(title ?? '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return s || 'entry';
}

// A rule lives in recurring/ because an open-ended rule must render in months it was not
// created in, and there is no month folder to find it under. Everything else goes in the date
// tree, named from the UTC components of `start` so the name mirrors the stored string.
export function pathFor(data, id = rand4()) {
  if (data.recurrence) return `${ROOT}/recurring/${slug(data.title)}-${id}.md`;
  const s = String(data.start ?? data['recurrence-id'] ?? '');
  if (isAllDay(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${ROOT}/${y}/${m}/${y}-${m}-${d}-0000-${id}.md`;
  }
  const t = new Date(s);
  const y = t.getUTCFullYear(), m = pad(t.getUTCMonth() + 1), d = pad(t.getUTCDate());
  return `${ROOT}/${y}/${m}/${y}-${m}-${d}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}-${id}.md`;
}

// The 4 random characters, so a move keeps the entry's identity.
export const idTail = path => path.replace(/\.md$/, '').split('-').pop();

// RFC 5545 naming, ordered as the samples are. serialize() drops empty keys rather than
// writing `None`, which a parser would hand back as the string "None".
const ORDER = ['series', 'recurrence-id', 'title', 'type', 'start', 'end', 'stage', 'important',
  'estimate', 'group', 'location', 'recurrence', 'exdate', 'rdate', 'alerts', 'participants',
  'status'];

function order(data) {
  const out = {};
  for (const k of ORDER) if (data[k] !== undefined) out[k] = data[k];
  for (const k of Object.keys(data)) if (!ORDER.includes(k)) out[k] = data[k];
  return out;
}

// Pure: what a write would put in the repo. Used by the write path and by the round-trip test.
export const entryFile = (data, body, path) =>
  ({ path: path || pathFor(data), text: serialize(order(data), body || '') });

// ---- writes -----------------------------------------------------------------------------
// These only touch the local mirror and the queue. The push is drain() in app.js, run in the
// background so saving never waits on the network - and one drain is still one commit, so a
// move (delete plus create, because the date is in the path) cannot be half applied.

export async function createEntry(data, body) {
  const f = entryFile(data, body);
  await write(f.path, f.text);
  return f.path;
}

// Moves the file when `start` or `recurrence` changed where it belongs. Overrides pass
// move:false - their path legitimately disagrees with their start and nothing may move them.
export async function updateEntry(path, data, body, { move = true } = {}) {
  let target = move ? pathFor(data, idTail(path)) : path;
  // A rule file's name is permanent: override files reference it through `series`, so
  // retitling must not rename it. Only gaining or losing the rule moves it.
  if (path.startsWith(`${ROOT}/recurring/`) && target.startsWith(`${ROOT}/recurring/`)) target = path;
  const f = entryFile(data, body, target);
  if (target !== path) await remove(path);
  await write(f.path, f.text);
  return f.path;
}

export const deleteEntry = path => remove(path);

// ---- occurrences of a series ------------------------------------------------------------

// A plain skip, where there is nothing to record: exdate on the rule file. An override for the
// skipped occurrence goes with it, in the same commit: expandRule tests exdate *before* it looks
// an override up, so a file left behind would be read by nothing and shown nowhere.
export async function skipOccurrence(occ) {
  const ex = list(occ.seriesData.exdate).map(String);
  if (!ex.includes(occ.recId)) ex.push(occ.recId);
  ex.sort();
  if (occ.override) await deleteEntry(occ.path);
  return updateEntry(occ.seriesPath, { ...occ.seriesData, exdate: ex }, occ.seriesBody, { move: false });
}

// Anything that happens to a single occurrence is an override file in the date tree holding
// only the keys that differ. The rule file is never rewritten, and since each override is a
// fresh path it cannot conflict even when two devices do it offline.
export async function saveOverride(occ, data, body) {
  const diff = { series: occ.seriesId, 'recurrence-id': occ.recId };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'recurrence' || k === 'exdate' || k === 'rdate') continue;   // the series owns these
    if (same(v, occ.base[k])) continue;
    diff[k] = v;
  }
  const ownBody = body != null && body.trim() !== (occ.seriesBody || '').trim() ? body : '';
  // Nothing differs any more - unticking what was ticked. The occurrence follows the rule again.
  if (Object.keys(diff).length === 2 && !ownBody) {
    if (occ.override) await deleteEntry(occ.path);
    return occ.path;
  }
  if (occ.override) return updateEntry(occ.path, diff, ownBody, { move: false });
  const f = entryFile(diff, ownBody, pathFor({ 'recurrence-id': occ.recId, start: occ.start }));
  await write(f.path, f.text);
  return f.path;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Setting a field on one occurrence of a series is an override; on a plain entry it is an edit.
// A null in the patch clears the key.
export async function patchOccurrence(occ, patch) {
  const data = { ...occ.data, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] == null) delete data[k];
  if (occ.seriesId) return saveOverride(occ, data, occ.body);
  return updateEntry(occ.path, data, occ.body, { move: patch.start !== undefined });
}

// ---- the two files that are data, not preferences ---------------------------------------

const GROUPS_BODY = `Maps an entry's \`group\` name to a colour and a label. Editing a colour here recolours
every entry in that group; no entry files are touched.`;
const SETTINGS_BODY = `The sprint a task belongs to is derived from these two, so they are data and live here
rather than on the device - otherwise the same task would be in different sprints on a
phone and on a laptop.`;

// serialize() writes scalars and lists; groups.md is a nested map, so its one line is written
// here. An entry stores the group *name*, which is why relabelling touches no entry file.
export async function saveGroups(groups) {
  const path = `${ROOT}/groups.md`;
  const old = await getFile(path);
  const body = old ? parse(old.text).body : GROUPS_BODY;
  const lines = Object.entries(groups).map(([n, g]) =>
    `  ${n}: { color: ${JSON.stringify(String(g.color))}, label: ${JSON.stringify(String(g.label ?? n))} }`);
  await write(path, `---\ngroups:\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`);
  return path;
}

export async function saveSettings(settings) {
  const path = `${ROOT}/settings.md`;
  const old = await getFile(path);
  const body = old ? parse(old.text).body : SETTINGS_BODY;
  await write(path, serialize(
    { 'kanban-anchor': settings.anchor, 'kanban-interval': settings.interval }, body));
  return path;
}

// A group's stored name is derived from its label and never shown, so relabelling or
// recolouring later touches no entry.
export function groupName(label, taken) {
  const base = slug(label);
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createGroup(groups, label, color) {
  const name = groupName(label, Object.keys(groups));
  await saveGroups({ ...groups, [name]: { color, label } });
  return name;
}
