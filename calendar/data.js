// The calendar's model: the local mirror in, entries and occurrences out.
//
// Two rules run through all of this:
//   * The path is never the source of truth for a date - frontmatter `start` is. After a move
//     or an override the two legitimately disagree, so nothing here parses a filename.
//   * rrule.js works in UTC. An all-day rule is anchored at UTC midnight and read back with
//     getUTC*(); calling getDate() on it returns the previous day east of UTC.
import { parse, serialize } from '../shared/md.js';
import { RRule } from '../shared/vendor/rrule.mjs';
import { allFiles } from '../shared/store.js';
import { write, remove, drain } from '../shared/github.js';

export const ROOT = 'calendar';
const UNKNOWN_COLOR = '#9aa5b1';          // group not in groups.md renders grey

const pad = n => String(n).padStart(2, '0');

// ---- dates -------------------------------------------------------------------------------
// A bare date (2026-04-18) is all-day and is never run through a timezone. A timestamp is an
// instant and belongs in the viewer's local day.

export const isAllDay = v => !String(v).includes('T');
export const localKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const todayKey = () => localKey(new Date());

// The day cell an entry falls in.
function keyOf(start) {
  const s = String(start);
  if (isAllDay(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? s.slice(0, 10) : localKey(d);
}

// Minutes from local midnight, or null for an all-day item (which sorts first).
function minutesOf(start) {
  const s = String(start);
  if (isAllDay(s)) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d.getHours() * 60 + d.getMinutes();
}

export function timeLabel(start) {
  const m = minutesOf(start);
  return m === null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const instant = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// The occurrence id used by `recurrence-id`, `exdate` and `rdate`: the occurrence's own start
// value, in the same value type as the series start.
const occIdOf = (d, allDay) => allDay ? utcKey(d) : instant(d);

const list = v => v == null ? [] : Array.isArray(v) ? v : [v];

// ---- the model ---------------------------------------------------------------------------

export async function loadModel() {
  return buildModel(await allFiles(ROOT + '/'));
}

// Pure, so it can be exercised from node against the same files the browser mirrors.
export function buildModel(files) {
  const groups = {}, dated = [], rules = [], overrides = new Map();
  for (const f of files) {
    if (!f.path.endsWith('.md') || f.text == null) continue;
    const { data, body } = parse(f.text);
    if (data.conflictOf) continue;               // a conflict copy would render twice
    if (f.path === `${ROOT}/groups.md`) { Object.assign(groups, data.groups || {}); continue; }
    const e = { path: f.path, data, body };
    // Classified by content, not by folder: the path is never the source of truth.
    if (data.series && data['recurrence-id'] != null)
      overrides.set(`${data.series}|${String(data['recurrence-id'])}`, e);
    else if (data.recurrence) { e.id = idOf(f.path); rules.push(e); }
    else if (data.start) dated.push(e);
  }
  return { groups, dated, rules, overrides };
}

const idOf = path => path.split('/').pop().replace(/\.md$/, '');

export const groupColor = (groups, name) => groups?.[name]?.color || UNKNOWN_COLOR;
export const groupLabel = (groups, name) => groups?.[name]?.label || name || '';

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

// All-day first, then by local time, then by title so the order is stable across reloads.
export function byStart(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.minutes ?? 0) - (b.minutes ?? 0) || a.title.localeCompare(b.title);
}

function occurrence(file, { data, body, base = null, series = null, recId = null, override = null }) {
  const start = String(data.start ?? '');
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
    type: data.type === 'task' ? 'task' : 'event',
    group: data.group ?? '',
    done: data.done === true,
    location: data.location ?? '',
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

  // The range is local days; rrule answers in UTC. A day of padding either side covers the
  // offset, and the dayKey test below drops whatever falls outside after conversion.
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
const ORDER = ['series', 'recurrence-id', 'title', 'type', 'start', 'end', 'done', 'group',
  'location', 'recurrence', 'exdate', 'rdate', 'alerts', 'participants', 'status'];

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
// Everything goes through github.js write()/remove() and then drain(): one drain is one
// commit, so a move - delete plus create, because the date is in the path - cannot be half
// applied.

export async function createEntry(data, body) {
  const f = entryFile(data, body);
  await write(f.path, f.text);
  await drain(`calendar: add ${data.title || 'entry'}`);
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
  await drain(`calendar: edit ${data.title || 'entry'}`);
  return f.path;
}

export async function deleteEntry(path) {
  await remove(path);
  await drain(`calendar: delete ${path.split('/').pop()}`);
}

// ---- occurrences of a series ------------------------------------------------------------

// A plain skip, where there is nothing to record: exdate on the rule file.
export async function skipOccurrence(occ) {
  const ex = list(occ.seriesData.exdate).map(String);
  if (!ex.includes(occ.recId)) ex.push(occ.recId);
  ex.sort();
  await updateEntry(occ.seriesPath, { ...occ.seriesData, exdate: ex }, occ.seriesBody, { move: false });
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
  if (Object.keys(diff).length === 2 && !ownBody) return clearOverride(occ);
  if (occ.override) return updateEntry(occ.path, diff, ownBody, { move: false });
  const f = entryFile(diff, ownBody, pathFor({ 'recurrence-id': occ.recId, start: occ.start }));
  await write(f.path, f.text);
  await drain(`calendar: override ${occ.title}`);
  return f.path;
}

// Drop the override; the occurrence goes back to following the series.
async function clearOverride(occ) {
  if (occ.override) await deleteEntry(occ.path);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
