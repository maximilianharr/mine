// The model arithmetic, exercised in node. Everything checked here is pure: it takes files or
// date strings and returns values, with no DOM, no IndexedDB and no network - which is why it
// does not belong in the browser suite, where a date bug would surface as a misplaced cell.
//
//   node test/unit.mjs
//
// Nothing is installed and nothing is written. The output format matches check.mjs, so
// test/run.sh can print both runs as one list.
import {
  isoWeek, addDays, addMonths, diffDays, dayKeyOf, dowOf, weekStartOf, monthGrid,
  isAllDay, stageOf, importantOf, buildModel, occurrences, byStart, byImportance,
  sprintOf, sprintRange, pathFor, idTail, entryFile, groupName, setZone, toInstant, wallParts,
  timeLabel, DEFAULT_ANCHOR
} from '../calendar/data.js';
import { plain, fold, index, find, snippet } from '../shared/search.js';

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${pass || !detail ? '' : ` -- ${detail}`}`);
};
const brief = v => { const s = JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + '…' : s; };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  `got ${brief(got)}, wanted ${brief(want)}`);

// ---- calendar-date arithmetic -----------------------------------------------------------------
// All of it is UTC string arithmetic, so neither a zone nor a DST change can shift a bare date
// by a day. These are the cases where a local Date would have been wrong.

eq('addDays crosses a month', addDays('2026-01-31', 1), '2026-02-01');
eq('addDays crosses a leap day', addDays('2024-02-28', 1), '2024-02-29');
eq('addDays goes backwards over a year', addDays('2026-01-01', -1), '2025-12-31');
eq('addDays crosses a spring DST change', addDays('2026-03-28', 1), '2026-03-29');
eq('diffDays counts inclusive days exclusively', diffDays('2026-04-18', '2026-04-25'), 7);
eq('addMonths clamps a short month', addMonths('2026-01-31', 1), '2026-02-28');
eq('addMonths clamps into a leap February', addMonths('2024-01-31', 1), '2024-02-29');
eq('addMonths steps a year', addMonths('2026-04-18', 12), '2027-04-18');
eq('addMonths steps back over January', addMonths('2026-01-15', -1), '2025-12-15');
eq('dayKeyOf normalises an overflowing day', dayKeyOf(2026, 0, 32), '2026-02-01');
eq('dowOf reads Sunday as 0', dowOf('2026-04-19'), 0);
eq('dowOf reads Saturday as 6', dowOf('2026-04-18'), 6);

// ISO 8601: the week holding this date's Thursday, counted from the week holding 4 January.
// The year boundaries are where a hand-rolled version is wrong.
eq('isoWeek of mid-April 2026', isoWeek('2026-04-18'), 16);
eq('isoWeek of 4 January is 1', isoWeek('2026-01-04'), 1);
eq('isoWeek of 1 January 2026 belongs to week 1', isoWeek('2026-01-01'), 1);
eq('isoWeek of 1 January 2027 belongs to week 53', isoWeek('2027-01-01'), 53);
eq('isoWeek of 31 December 2024 belongs to week 1', isoWeek('2024-12-31'), 1);

// weekStart is 1 for Monday, 0 for Sunday.
eq('weekStartOf a Saturday, Monday weeks', weekStartOf('2026-04-18', 1), '2026-04-13');
eq('weekStartOf a Saturday, Sunday weeks', weekStartOf('2026-04-18', 0), '2026-04-12');
eq('weekStartOf a Monday is itself', weekStartOf('2026-04-13', 1), '2026-04-13');

// The grid is whole weeks covering the month, so it is a multiple of seven and it begins on the
// configured first day of the week.
const grid = monthGrid(2026, 3, 1);
eq('monthGrid is whole weeks', grid.length % 7, 0);
eq('monthGrid starts on the configured day', dowOf(grid[0]), 1);
ok('monthGrid covers the first of the month', grid.includes('2026-04-01'), grid[0]);
ok('monthGrid covers the last of the month', grid.includes('2026-04-30'), grid[grid.length - 1]);
// June 2026 begins on a Monday and has 30 days, so Monday weeks cover it in five rows exactly.
// November begins on a Sunday, which pushes it to six - the row count is not a constant.
eq('a month that fits five Monday weeks is 35 cells', monthGrid(2026, 5, 1).length, 35);
eq('and one that does not is 42', monthGrid(2026, 10, 1).length, 42);

eq('a bare date is all-day', isAllDay('2026-04-18'), true);
eq('a timestamp is not', isAllDay('2026-04-18T14:00:00Z'), false);

// ---- task fields ------------------------------------------------------------------------------
// Stage is a task's only progress field and importance is a yes or no. There are no legacy keys
// to fall back on: `done` and `priority` are not read.

eq('a stage is taken as written', stageOf({ stage: 'doing' }), 'doing');
eq('an absent stage is todo', stageOf({}), 'todo');
eq('an unknown stage is todo', stageOf({ stage: 'blocked' }), 'todo');
eq('a done boolean is not read', stageOf({ done: true }), 'todo');
eq('important: true is important', importantOf({ important: true }), true);
eq('a quoted true is too', importantOf({ important: 'true' }), true);
eq('no key is not important', importantOf({}), false);
eq('priority is not read', importantOf({ priority: 1 }), false);

// ---- sprints ----------------------------------------------------------------------------------
// Sprint n runs for `interval` weeks from `anchor + (n-1) x interval` weeks. There is no sprint
// key: a task's sprint is whichever range its start falls in, computed on bare dates.

const S2 = { anchor: '2026-01-05', interval: 2 };
eq('the anchor is in sprint 1', sprintOf('2026-01-05', S2), 1);
eq('the last day of sprint 1', sprintOf('2026-01-18', S2), 1);
eq('the first day of sprint 2', sprintOf('2026-01-19', S2), 2);
eq('a date before the anchor has no sprint', sprintOf('2026-01-04', S2), null);
eq('sprint 8 is where the sample task sits', sprintOf('2026-04-20', S2), 8);
eq('sprint 1 spans a fortnight',
  sprintRange(1, S2), { n: 1, start: '2026-01-05', end: '2026-01-18' });
eq('sprintRange and sprintOf agree', sprintOf(sprintRange(9, S2).start, S2), 9);
eq('a one-week interval is a week',
  sprintRange(3, { anchor: '2026-01-05', interval: 1 }),
  { n: 3, start: '2026-01-19', end: '2026-01-25' });
eq('the default anchor is a Monday', dowOf(DEFAULT_ANCHOR), 1);

// ---- the model and a range --------------------------------------------------------------------
// buildModel takes files rather than reading them, and classifies by content: the path is never
// the source of truth.

const file = (path, data, body = '') =>
  ({ path, text: `---\n${data}\n---\n\n${body}` });

const FILES = [
  file('calendar/groups.md', 'groups:\n  work: { color: "#c0392b", label: "Work" }'),
  file('calendar/settings.md', 'kanban-anchor: 2026-01-05\nkanban-interval: 2'),
  file('calendar/2026/04/2026-04-18-1400-k3f9.md',
    'title: Sync\ntype: event\nstart: 2026-04-18T14:00:00Z\nend: 2026-04-18T15:00:00Z\ngroup: work'),
  file('calendar/2026/04/2026-04-20-0000-t2wv.md',
    'title: Hiring plan\ntype: task\nstart: 2026-04-20\nstage: doing\nimportant: true\ngroup: work'),
  file('calendar/recurring/trash-p7qm.md',
    'title: Trash\ntype: task\nstart: 2026-04-18\nstage: todo\nrecurrence: "FREQ=WEEKLY;BYDAY=SA"\nexdate:\n  - 2026-05-02',
    'take it out'),
  // An override lives in the date tree and carries only the keys that differ.
  file('calendar/2026/04/2026-04-25-0000-ov1q.md',
    'series: trash-p7qm\nrecurrence-id: 2026-04-25\nstage: done'),
  // A conflict copy must never render, or the entry appears twice.
  file('calendar/2026/04/2026-04-18-1400-k3f9.conflict-20260418.md',
    'title: Sync\ntype: event\nstart: 2026-04-18T14:00:00Z\nconflictOf: calendar/2026/04/2026-04-18-1400-k3f9.md'),
  { path: 'calendar/README.md', text: 'not frontmatter' }
];

setZone('Europe/Berlin');
const model = buildModel(FILES);
eq('groups.md is read into the group map', model.groups.work.label, 'Work');
eq('settings.md is read', model.settings, { anchor: '2026-01-05', interval: 2 });
eq('two dated entries', model.dated.length, 2);
eq('one rule', model.rules.length, 1);
eq('the rule is keyed by its filename', model.rules[0].id, 'trash-p7qm');
eq('one override, indexed by series and occurrence', [...model.overrides.keys()],
  ['trash-p7qm|2026-04-25']);
eq('a file with no settings.md falls back to the constant',
  buildModel([]).settings, { anchor: DEFAULT_ANCHOR, interval: 2 });

const april = occurrences(model, '2026-04-01', '2026-04-30');
const titles = april.map(o => `${o.dayKey} ${o.title}`);
// All-day items first and then by time, across the whole range: a rule anchored on the 18th
// contributes the 18th and the 25th and nothing before its own start.
eq('April holds the two entries and the rule\'s two Saturdays', titles,
  ['2026-04-20 Hiring plan', '2026-04-18 Trash', '2026-04-25 Trash', '2026-04-18 Sync']);
ok('a rule does not expand before its start',
  !titles.some(t => t < '2026-04-18'), titles.join(' | '));
ok('a conflict copy does not render',
  april.filter(o => o.title === 'Sync').length === 1, titles.join(' | '));
eq('the override moves that occurrence to done',
  april.find(o => o.dayKey === '2026-04-25').stage, 'done');
eq('and is marked as an override', april.find(o => o.dayKey === '2026-04-25').override, true);
eq('an unoverridden occurrence keeps the rule stage',
  april.find(o => o.dayKey === '2026-04-18' && o.title === 'Trash').stage, 'todo');
eq('and is not marked as one',
  april.find(o => o.dayKey === '2026-04-18' && o.title === 'Trash').override, false);
eq('an occurrence inherits the series body',
  april.find(o => o.dayKey === '2026-04-18' && o.title === 'Trash').body.trim(), 'take it out');
eq('exdate drops an occurrence',
  occurrences(model, '2026-05-01', '2026-05-09').map(o => o.dayKey), ['2026-05-09']);
// An open-ended rule renders in months it was not created in - which is why rules live in
// recurring/ rather than the date tree, where there would be no month folder to find them under.
eq('an open-ended rule renders in a later year',
  occurrences(model, '2027-01-01', '2027-01-31').map(o => o.dayKey),
  ['2027-01-02', '2027-01-09', '2027-01-16', '2027-01-23', '2027-01-30']);
eq('a model with no rules renders nothing outside its dates',
  occurrences(buildModel(FILES.slice(3, 4)), '2027-01-01', '2027-01-31').length, 0);

// All-day first, then by time: a Saturday task has to come above a timed event on the same day.
const oneDay = occurrences(model, '2026-04-18', '2026-04-18').sort(byStart);
eq('all-day sorts before timed', oneDay.map(o => o.title), ['Trash', 'Sync']);
eq('byImportance puts the important one first',
  [...april].sort(byImportance)[0].title, 'Hiring plan');

// ---- paths ------------------------------------------------------------------------------------
// Derived from `start` at creation and never read back as truth. A rule goes to recurring/,
// because an open-ended rule must render in months it was not created in.

ok('an all-day entry lands in its month folder',
  /^calendar\/2026\/04\/2026-04-18-0000-[a-z0-9]{4}\.md$/.test(pathFor({ start: '2026-04-18' })),
  pathFor({ start: '2026-04-18' }));
ok('a timed entry carries its UTC time',
  /^calendar\/2026\/04\/2026-04-18-1400-[a-z0-9]{4}\.md$/
    .test(pathFor({ start: '2026-04-18T14:00:00Z' })), pathFor({ start: '2026-04-18T14:00:00Z' }));
ok('a rule goes to recurring/ with a slug',
  /^calendar\/recurring\/take-out-the-trash-[a-z0-9]{4}\.md$/
    .test(pathFor({ title: 'Take out the trash!', recurrence: 'FREQ=WEEKLY' })),
  pathFor({ title: 'Take out the trash!', recurrence: 'FREQ=WEEKLY' }));
eq('an override is named from its recurrence-id',
  pathFor({ 'recurrence-id': '2026-04-25', start: '2026-04-25' }, 'ov1q'),
  'calendar/2026/04/2026-04-25-0000-ov1q.md');
eq('two paths for the same day differ',
  pathFor({ start: '2026-04-18' }) === pathFor({ start: '2026-04-18' }), false);
eq('idTail recovers the identity a move keeps',
  idTail('calendar/2026/04/2026-04-18-0000-k3f9.md'), 'k3f9');
eq('a derived group name is a slug', groupName('Sport & Doctor', []), 'sport-doctor');
eq('a taken name gains a suffix', groupName('Work', ['work']), 'work-2');
eq('and keeps counting', groupName('Work', ['work', 'work-2']), 'work-3');

// ---- the days an entry covers -----------------------------------------------------------------
// An entry has a last day as well as a first, and the range query is an overlap rather than a
// test of where it starts: a trip that began last month is on screen all the way through this
// one. An all-day `end` is the **last day itself**, not the day after it - a documented
// divergence from RFC 5545, where an .ics export has to add the day back.

// Which day an instant falls in is the viewer's question, so the zone is pinned while these
// run - on a machine in Berlin, 22:00Z is already tomorrow.
setZone('UTC');

const span = (start, end, extra = {}) => ({
  path: 'calendar/x.md', data: { title: 'x', type: 'event', start, end, ...extra }, body: ''
});
const oneOf = files => ({ groups: {}, dated: files, rules: [], overrides: new Map(),
  settings: { anchor: '2026-01-05', interval: 2 } });
const days = (file, from, to) => occurrences(oneOf([file]), from, to)
  .map(o => [o.dayKey, o.endDayKey]);

eq('an all-day end is the last day, inclusive',
  days(span('2026-04-18', '2026-04-20'), '2026-04-01', '2026-04-30'),
  [['2026-04-18', '2026-04-20']]);
eq('a timed end at midnight ends the day before - 22:00-00:00 is one evening',
  days(span('2026-04-18T22:00:00Z', '2026-04-19T00:00:00Z'), '2026-04-01', '2026-04-30'),
  [['2026-04-18', '2026-04-18']]);
eq('a timed end past midnight covers both days',
  days(span('2026-04-18T22:00:00Z', '2026-04-19T06:00:00Z'), '2026-04-01', '2026-04-30'),
  [['2026-04-18', '2026-04-19']]);
eq('an end before its start is no end at all',
  days(span('2026-04-18', '2026-04-10'), '2026-04-01', '2026-04-30'),
  [['2026-04-18', '2026-04-18']]);
eq('an entry with no end covers its own day',
  days({ path: 'calendar/y.md', data: { title: 'y', start: '2026-04-18' }, body: '' },
    '2026-04-01', '2026-04-30'),
  [['2026-04-18', '2026-04-18']]);

// The query is the point of the two keys: a range that touches only the middle of a span still
// holds it, and one that touches neither end nor middle does not.
eq('a range inside a span holds it',
  days(span('2026-04-10', '2026-04-20'), '2026-04-14', '2026-04-15').length, 1);
eq('a range ending the day it starts holds it',
  days(span('2026-04-10', '2026-04-20'), '2026-04-01', '2026-04-10').length, 1);
eq('a range beginning the day it ends holds it',
  days(span('2026-04-10', '2026-04-20'), '2026-04-20', '2026-04-28').length, 1);
eq('and a range past it does not',
  days(span('2026-04-10', '2026-04-20'), '2026-04-21', '2026-04-28').length, 0);

// A repeating span: the window the rule is expanded over has to reach back by the length of one
// occurrence, or an occurrence that began before the range is never generated at all.
const weekly = { id: 'r1', path: 'calendar/recurring/r1.md', body: '',
  data: { title: 'r', type: 'event', start: '2026-04-06', end: '2026-04-09',
          recurrence: 'FREQ=WEEKLY' } };
eq('a repeating span that began before the range is still in it',
  occurrences({ groups: {}, dated: [], rules: [weekly], overrides: new Map(),
    settings: { anchor: '2026-01-05', interval: 2 } }, '2026-04-08', '2026-04-08')
    .map(o => [o.dayKey, o.endDayKey]),
  [['2026-04-06', '2026-04-09']]);

setZone('');

// ---- what a write puts in the repo ------------------------------------------------------------
// Empty keys are omitted, never written as `None`, which a parser hands back as the text "None".

const written = entryFile({
  title: 'Draft the Q2 hiring plan', type: 'task', start: '2026-04-20', stage: 'doing',
  important: true, group: 'work', location: '', alerts: [], participants: ['a@b.c']
}, 'notes here', 'calendar/x.md').text;
ok('the frontmatter is ordered as the samples are',
  written.indexOf('title:') < written.indexOf('type:') &&
  written.indexOf('type:') < written.indexOf('start:') &&
  written.indexOf('stage:') < written.indexOf('important:') &&
  written.indexOf('important:') < written.indexOf('group:'), written);
ok('an empty string is omitted', !written.includes('location:'), written);
ok('an empty list is omitted', !written.includes('alerts:'), written);
ok('nothing is ever written as None', !written.includes('None'), written);
ok('a list is written as one item per line', written.includes('participants:\n  - a@b.c'), written);
ok('the body is kept', written.endsWith('notes here'), JSON.stringify(written.slice(-20)));
ok('a title needing quotes gets them',
  entryFile({ title: 'Project Phoenix: Weekly Sync', start: '2026-04-18' }, '', 'x').text
    .includes('title: "Project Phoenix: Weekly Sync"'), '');
ok('a title that looks like a number gets them',
  entryFile({ title: '2026', start: '2026-04-18' }, '', 'x').text.includes('title: "2026"'), '');
ok('a round trip survives buildModel',
  buildModel([{ path: 'calendar/2026/04/a.md', text: written }]).dated[0].data.title
    === 'Draft the Q2 hiring plan', '');

// ---- the configured zone ----------------------------------------------------------------------
// One IANA name decides which day a timed entry falls in and what a typed time means. The
// conversion takes two passes, because the offset depends on the answer.

eq('a typed winter time resolves to UTC',
  (setZone('Europe/Berlin'), toInstant('2026-01-15', '14:00')), '2026-01-15T13:00:00Z');
eq('a typed summer time uses the summer offset',
  toInstant('2026-07-15', '14:00'), '2026-07-15T12:00:00Z');
eq('a wall-clock time reads back as itself in winter',
  wallParts(toInstant('2026-01-15', '14:00')), ['2026-01-15', '14:00']);
eq('and in summer', wallParts(toInstant('2026-07-15', '14:00')), ['2026-07-15', '14:00']);
// The hour a zone skips in spring has no instant. It must resolve onto the real time just before
// the gap and stay there, rather than drifting an hour further on every save.
const gap = toInstant('2026-03-29', '02:30');
eq('a skipped spring hour is stable', toInstant(...wallParts(gap)), gap);
eq('an hour either side of the autumn change round-trips',
  wallParts(toInstant('2026-10-25', '02:30')), ['2026-10-25', '02:30']);
eq('an unknown zone falls back to the device rather than throwing',
  setZone('Mars/Olympus'), Intl.DateTimeFormat().resolvedOptions().timeZone);
setZone('Europe/Berlin');
eq('midnight reads as 00:00, not 24:00', timeLabel('2026-01-15T23:00:00Z'), '00:00');
eq('an all-day entry has no time label', timeLabel('2026-01-15'), '');
// Which day a timed entry falls in follows the configured zone, not UTC: 23:30 UTC on the 15th
// is half past midnight on the 16th in Berlin, and that is the cell it belongs in.
const late = buildModel([file('calendar/2026/01/a.md', 'title: Late\nstart: 2026-01-15T23:30:00Z')]);
eq('a late UTC instant lands on the next Berlin day',
  occurrences(late, '2026-01-16', '2026-01-16').map(o => o.title), ['Late']);
eq('and not on the UTC one', occurrences(late, '2026-01-15', '2026-01-15'), []);

// ---- search ----------------------------------------------------------------------------------
// Mine's search reads files, so it is checked here against files: what counts as a document,
// what of it is matched, and in which order the matches come.

eq('markdown is matched as text', plain('# Head\n- [x] **bold** _it_ `code` [link](http://x.io) snake_case'),
  'Head\nbold it code link snake_case');
eq('accents and case fold away', fold('Café ÜBER'), 'cafe uber');
const sfiles = [
  file('calendar/groups.md', 'groups:\n  work: { color: "#000" }'),
  file('calendar/2026/05/a.md', 'title: Dentist\nstart: 2026-05-02\ngroup: health', 'Bring the **x-ray**.'),
  file('calendar/2026/03/b.md', 'title: Call about teeth\nstart: 2026-03-01', 'The dentist said [see here](https://dentist.example).'),
  file('calendar/2026/06/c.md', 'title: Dentist again\nstart: 2026-06-10'),
  file('calendar/2026/04/o.md', 'series: r\nrecurrence-id: 2026-04-01\nstage: done'),
  file('notes/z.md', 'title: Dentist elsewhere')
];
const sdocs = index(sfiles, { folder: 'calendar/', title: 'title', date: 'start', fields: ['group'] });
eq('a file without the named title key is not a document',
  sdocs.map(d => d.path).sort(), ['calendar/2026/03/b.md', 'calendar/2026/05/a.md', 'calendar/2026/06/c.md']);
eq('title matches first, then the nearest coming date, then the past',
  find(sdocs, 'dent', '2026-04-01').map(d => d.title), ['Dentist', 'Dentist again', 'Call about teeth']);
eq('every word has to match', find(sdocs, 'dentist xray', '2026-04-01').map(d => d.title), []);
eq('a hyphenated word matches by its parts', find(sdocs, 'dentist ray', '2026-04-01').map(d => d.title), ['Dentist']);
eq('a word must begin a word', find(sdocs, 'entist', '2026-04-01'), []);
eq('a link does not match on its URL', find(sdocs, 'example', '2026-04-01'), []);
eq('a named field is searched', find(sdocs, 'health', '2026-04-01').map(d => d.title), ['Dentist']);
eq('an empty query finds nothing', find(sdocs, '  ', '2026-04-01'), []);
const zettel = index([file('zk/1.md', '', '# A *thought*\n\nAbout Éclairs.'), { path: 'zk/2026-01-03-x.md', text: 'plain' }],
  { folder: 'zk/' });
eq('with no keys named, the title is the first heading, else the file name',
  zettel.map(d => d.title), ['A thought', '2026-01-03-x']);
eq('and the date comes from the path', zettel.map(d => d.date), ['', '2026-01-03']);
eq('a snippet marks the matched word in the original spelling',
  snippet('About Éclairs.', 'eclair'), [['About ', false], ['Éclair', true], ['s.', false]]);

console.log(failed ? `\n${failed} check(s) failed` : '\nall unit checks passed');
process.exit(failed ? 1 : 0);
