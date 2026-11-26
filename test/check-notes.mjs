// The notes app in a browser. Run through test/run.sh. What it checks and why is in
// TEST-REQUIREMENTS.md under "Notes".
import { ok, eq, report, sleep, ev, send, viewport, goto, shoot, seed, kv } from './cdp.mjs';

const open = async () => { await goto('/notes/'); await sleep(200); };
const titles = () => ev(`[...document.querySelectorAll('.ncard .ntitle')].map(n => n.textContent)`);
const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shown = sel => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)});
  return !!n && !n.hidden; })()`);
const icons = () => ev(`[...document.querySelectorAll('#n-icons button')].map(b => b.getAttribute('aria-label'))`);
const openCard = async title => {
  await ev(`[...document.querySelectorAll('.ncard')].find(c =>
    c.querySelector('.ntitle').textContent === ${JSON.stringify(title)}).click()`);
  await sleep(250);
};
// Typed into the active input as a user would: the value, then the event the app listens for.
const typeInto = (sel, value) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)});
  n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const pressEnter = async sel => {
  await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`);
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyDown', text: '\r' });
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyUp' });
  await sleep(250);
};
const files = () => ev(`(async () => {
  const db = await new Promise(res => { const r = indexedDB.open('mine', 1); r.onsuccess = () => res(r.result); });
  return new Promise(res => {
    const q = db.transaction('files', 'readonly').objectStore('files').getAll();
    q.onsuccess = () => res(q.result.filter(f => f.path.startsWith('notes/')));
  });
})()`);
const fileOf = async title => (await files()).find(f => f.text.includes(`title: ${title}\n`)
  || f.text.includes(`title: "${title}"\n`));
const save = async () => { await click('#n-icons [aria-label="Save"]'); await sleep(500); };

// ---- 1. the grid -----------------------------------------------------------------------------

await viewport(360);
await goto('/notes/');
ok('fixture seeded', await seed('notes') === 5);
await open();

eq('the cards are pinned first, then newest update first', await titles(),
  ['Paint the hallway', 'Groceries', 'Trip ideas', 'Quarterly report', 'Loose thought']);
const first = await ev(`(() => { const c = document.querySelectorAll('.ncard')[1];
  return { tags: c.querySelector('.ntags').textContent, date: c.querySelector('.ndate').textContent,
    boxes: c.querySelectorAll('.nbody input[type=checkbox]').length,
    strong: c.querySelector('.nbody strong')?.textContent }; })()`);
eq('a card carries its tags', first.tags, '#home #shopping');
ok('and its date', /\d/.test(first.date), first.date);
eq('and its body rendered', [first.boxes, first.strong], [3, 'good']);
const long = await ev(`(() => { const b = [...document.querySelectorAll('.ncard')][2].querySelector('.nbody');
  return b.scrollHeight > b.clientHeight; })()`);
ok('a long body is cut off', long);

for (const scheme of ['light', 'dark']) {
  for (const width of [320, 360]) {
    await viewport(width, scheme);
    await open();
    const head = await ev(`(() => {
      const bs = [...document.querySelectorAll('.topbar .nav')];
      return { n: bs.length, rows: new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size,
        cols: getComputedStyle(document.querySelector('.ngrid')).columnCount,
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    eq(`${scheme} ${width}px: the header is five buttons in one row`, [head.n, head.rows], [5, 1]);
    eq(`${scheme} ${width}px: the cards are two columns`, head.cols, '2');
    eq(`${scheme} ${width}px: nothing scrolls sideways`, head.over, 0);
    await shoot(`notes-grid-${scheme}-${width}`);
  }
}
await viewport(1200);
await open();
const cols = () => ev(`getComputedStyle(document.querySelector('.ngrid')).columnCount`);
eq('at 1200px the cards are four columns', await cols(), '4');
await shoot('notes-grid-1200');

// ---- 2. the popup ----------------------------------------------------------------------------

await viewport(360);
await open();
await openCard('Trip ideas');
ok('a card opens its note', await shown('#popup'));
eq('with the pin left and no disk showing', await icons(), ['Pin', 'Delete', 'Close']);
eq('the pin sits at the left edge of the row', await ev(`(() => {
  const [p, t] = ['Pin', 'Delete'].map(l => document.querySelector('#n-icons [aria-label="' + l + '"]')
    .getBoundingClientRect().left);
  return p < document.querySelector('#n-icons').getBoundingClientRect().left + 30 && p < t; })()`), true);
await shoot('notes-popup');

await click('#n-rows .ttap');
await sleep(150);
await typeInto('#n-rows .title-in', 'Trip ideas 2027');
eq('changing the title shows the disk', await icons(), ['Pin', 'Delete', 'Save', 'Close']);
const before = await fileOf('Trip ideas');
await save();
ok('saving closes the popup', !(await shown('#popup')));
const after = await fileOf('Trip ideas 2027');
ok('the file has the new title', !!after);
eq('at the same path', after?.path, before.path);
ok('keeps created', after?.text.includes('created: 2026-11-18T10:00:00Z'));
ok('sets a newer updated', /updated: 20\d\d-[^\n]+/.test(after?.text)
  && !after.text.includes('updated: 2026-11-24T19:40:00Z'), after?.text.slice(0, 160));
ok('and keeps a key it does not own', after?.text.includes('source: phone'));
eq('the saved note moves to the front, behind the pinned one', (await titles()).slice(0, 2),
  ['Paint the hallway', 'Trip ideas 2027']);

// Pinning.
await openCard('Paint the hallway');
eq('a pinned note opens with its pin on',
  await ev(`document.querySelector('#n-icons [aria-label="Unpin"]')?.getAttribute('aria-pressed')`), 'true');
await click('#n-icons [aria-label="Close"]');
await sleep(150);
await openCard('Loose thought');
await click('#n-icons [aria-label="Pin"]');
eq('pinning shows the disk', await icons(), ['Unpin', 'Delete', 'Save', 'Close']);
await save();
ok('and saving writes pinned: true', (await fileOf('Loose thought'))?.text.includes('\npinned: true\n'));
eq('the pinned notes lead the grid, newest first', (await titles()).slice(0, 3),
  ['Loose thought', 'Paint the hallway', 'Trip ideas 2027']);
await openCard('Loose thought');
await click('#n-icons [aria-label="Unpin"]');
await save();
ok('unpinning drops the key', !(await fileOf('Loose thought'))?.text.includes('pinned'));
eq('and the note falls behind the pinned one', (await titles()).slice(0, 2),
  ['Paint the hallway', 'Loose thought']);

// A new note.
await click('#new-btn');
await sleep(300);
eq('+ opens an empty note with its title active',
  await ev(`document.activeElement?.classList.contains('title-in')`), true);
eq('whose disk is disabled until it has a title',
  await ev(`document.querySelector('#n-icons [aria-label="Save"]').disabled`), true);
await typeInto('#n-rows .title-in', 'Book list');
eq('and enabled once it has one',
  await ev(`document.querySelector('#n-icons [aria-label="Save"]').disabled`), false);
await click('#n-rows .trow .ftap');
await sleep(250);
ok('the tags row opens its popup', await shown('#fpop'));
await ev(`[...document.querySelectorAll('#fpop label')].find(l => l.textContent === '#home').querySelector('input').click()`);
await ev(`document.querySelector('#fpop .tag-in').value = 'Reading List'`);
await pressEnter('#fpop .tag-in');
eq('a typed tag is added, cleaned, beside a ticked one',
  await ev(`document.querySelector('#n-rows .trow .ftap').textContent`), '#home #reading-list');
await click('#n-rows .nb-tap');
await sleep(200);
ok('the popup closes when the body is tapped', !(await shown('#fpop')));
await typeInto('#n-rows .body-in', '- Dune\n- Stoner');
await shoot('notes-new');
await save();
const made = await fileOf('Book list');
ok('a new note is written under notes/YYYY/MM/', /^notes\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]{4}\.md$/.test(made?.path ?? ''), made?.path);
const stamps = made?.text.match(/created: (\S+)\nupdated: (\S+)/);
ok('with created equal to updated', !!stamps && stamps[1] === stamps[2], made?.text.slice(0, 120));
ok('and its tags and body', made?.text.includes('tags:\n  - home\n  - reading-list\n') && made.text.includes('- Stoner'));

// Deleting.
await openCard('Loose thought');
await ev(`window.confirm = () => true`);
await click('#n-icons [aria-label="Delete"]');
await sleep(400);
ok('the trashcan deletes the file', !(await fileOf('Loose thought')));
ok('and the card', !(await titles()).includes('Loose thought'));

// ---- 3. discarding ---------------------------------------------------------------------------

await openCard('Quarterly report');
await click('#n-icons [aria-label="Close"]');
ok('an untouched note closes without asking', !(await shown('#popup')) && !(await shown('#ask')));
await openCard('Quarterly report');
await click('#n-rows .ttap');
await typeInto('#n-rows .title-in', 'Quarterly');
await click('#n-icons [aria-label="Close"]');
ok('an edited one asks first', await shown('#ask'));
await click('#ask-keep');
eq('keep editing keeps the change', await ev(`document.querySelector('#n-rows .title-in').value`), 'Quarterly');
await click('#n-icons [aria-label="Close"]');
await click('#ask-never');
await click('#ask-discard');
await sleep(200);
ok('discard closes it', !(await shown('#popup')));
eq('don\'t ask again is Mine-wide', await kv('mine.confirmDiscard'), false);
await openCard('Quarterly report');
await click('#n-rows .ttap');
await typeInto('#n-rows .title-in', 'Quarterly');
await click('#n-icons [aria-label="Close"]');
ok('after which the x discards without asking', !(await shown('#popup')) && !(await shown('#ask')));
eq('nothing was written', (await titles()).includes('Quarterly report'), true);

// The settings row turns it back on.
await click('#menu-btn');
await sleep(250);
await ev(`[...document.querySelectorAll('#menu-body .mrow')].find(b => b.textContent === 'settings').click()`);
await sleep(300);
eq('the settings are theme, date format, confirm discard and columns',
  await ev(`[...document.querySelectorAll('#settings-body .slab')].map(n => n.textContent)`),
  ['Theme', 'Date format', 'Confirm discard', 'Columns']);
await shoot('notes-settings');
await ev(`(() => { const t = document.querySelectorAll('#settings-body input[type=checkbox]')[0];
  t.click(); })()`);
await sleep(200);
eq('and the row turns the prompt back on', await kv('mine.confirmDiscard'), true);
const setColumns = v => ev(`(() => { const s = document.querySelectorAll('#settings-body select')[2];
  s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);
await setColumns('3');
await sleep(200);
eq('the columns row sets the grid', await cols(), '3');
eq('and is kept on the device', await kv('notes.columns'), '3');
await open();
eq('across a reload', await cols(), '3');
await click('#menu-btn');
await sleep(250);
await ev(`[...document.querySelectorAll('#menu-body .mrow')].find(b => b.textContent === 'settings').click()`);
await sleep(300);
await setColumns('auto');
await sleep(200);
eq('auto hands it back to the screen width', await cols(), '2');
await click('#settings-close');

// ---- 4. the filter ---------------------------------------------------------------------------

const tick = async label => {
  if (!(await shown('#filter-pop'))) { await click('#filter-btn'); await sleep(250); }
  await ev(`[...document.querySelectorAll('#filter-body label')].find(l => l.textContent === ${JSON.stringify(label)}).querySelector('input').click()`);
  await sleep(250);
};
await tick('#travel');
eq('a ticked tag shows only the notes carrying it', await titles(), ['Trip ideas 2027']);
await tick('#work');
eq('two ticked tags show either', await titles(), ['Trip ideas 2027', 'Quarterly report']);
eq('the funnel counts them', await ev(`document.querySelector('#filter-btn .fcount')?.textContent`), '2');
await shoot('notes-filter');
await open();
eq('a reload keeps the filter', await titles(), ['Trip ideas 2027', 'Quarterly report']);
await tick('#travel');
await tick('#work');
eq('unticking all shows every note again', (await titles()).length, 5);
await tick('untagged');
eq('untagged shows only the notes with no tag', await titles(), []);
eq('and says so when there are none', await ev(`document.querySelector('.empty')?.textContent`),
  'No notes match the filter');
await tick('untagged');

// ---- 5. search -------------------------------------------------------------------------------

await click('#search-btn');
await sleep(400);
await ev(`(() => { const i = document.querySelector('#search-pop .sq');
  i.value = 'porto'; i.dispatchEvent(new Event('input')); })()`);
await sleep(200);
eq('search finds a note by its body', await ev(`[...document.querySelectorAll('#search-pop .hit-title')].map(n => n.textContent)`),
  ['Trip ideas 2027']);
await click('#search-pop .hit');
await sleep(300);
ok('a result opens the note', await shown('#popup')
  && await ev(`document.querySelector('#n-rows .ttap').textContent`) === 'Trip ideas 2027');
await click('#n-icons [aria-label="Close"]');
ok('closing it comes back to the search', await shown('#search-pop'));
await ev(`document.querySelector('#scrim').click()`);

// ---- 6. the header dock ----------------------------------------------------------------------

await viewport(900);
await open();
const centre = await ev(`(() => { const r = document.querySelector('.topbar').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2, innerHeight]; })()`);
const m = (type, x, y) => send('Input.dispatchMouseEvent',
  { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await m('mousePressed', centre[0], centre[1]);
await sleep(600);
for (let i = 1; i <= 6; i++) { await m('mouseMoved', centre[0], centre[1] + (centre[2] - 60 - centre[1]) * i / 6); await sleep(30); }
await m('mouseReleased', centre[0], centre[2] - 60);
await sleep(800);
eq('a held drag docks the header at the bottom',
  await ev(`document.body.classList.contains('dock-bottom')`), true);
eq('and it sits on the bottom edge of the screen', await ev(`Math.round(innerHeight
  - document.querySelector('.topbar').getBoundingClientRect().bottom)`), 0);
eq('stored for all of Mine', await kv('mine.barPosition'), 'bottom');
await shoot('notes-docked');
await goto('/calendar/');
eq('so the calendar opens docked at the bottom too',
  await ev(`document.body.classList.contains('dock-bottom')`), true);

report('notes');
