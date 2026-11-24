// The browser checks. Run through test/run.sh, which starts the server and Chromium for it.
//
// Chromium is driven over CDP rather than with --window-size and --screenshot, because that
// flag pair lays the page out at a fixed 500px and only scales the capture: a 320px screenshot
// of a 500px layout passes a fit check that a real phone fails. Emulation.setDeviceMetricsOverride
// is the width the page actually sees.
//
// Node 20 has no WebSocket global, hence --experimental-websocket in run.sh.
const PORT = 8787, CDP = 9222, ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOT = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (name, pass, detail = '') => {
  failures += pass ? 0 : 1;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`);
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- CDP ------------------------------------------------------------------------------------

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chromium is still coming up */ }
    await sleep(200);
  }
  throw new Error('no CDP page target — is Chromium running with --remote-debugging-port?');
}

const ws = new WebSocket(await pageTarget());
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  waiting.set(n, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');

const viewport = (w, scheme = 'light') => Promise.all([
  send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: true }),
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
]);

// A fake token is enough: the mirror is local, and the failed push only writes the sync line.
const seed = () => ev(`(async () => {
  const files = await (await fetch('${ORIGIN}/__fixture.json')).json();
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('mine', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const t = db.transaction(['kv', 'files'], 'readwrite');
    t.objectStore('kv').put({ owner: 'demo', repo: 'mine-data', branch: 'main',
      token: 'not-a-real-token', expires: '2099-01-01' }, 'config');
    t.objectStore('kv').put(1, 'calendar.weekStart');
    t.objectStore('kv').put(true, 'calendar.showWeeks');
    for (const f of files) t.objectStore('files').put(f);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  return files.length;
})()`);

// The app opens on the month view. The zoom button picks a period by name - the label no longer
// cycles, it opens the picker - and the board has a slot of its own, which is also the way back
// to the month view.
const NAMES = { D: 'day', W: 'week', M: 'month', Y: 'year' };
const zoomPick = async name => {
  await ev(`document.querySelector('#zoom-btn').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#zoom-body .zrow')]
    .find(b => b.textContent.trim() === '${name}').click()`);
  await sleep(350);
};
const open = async (mode = 'M') => {
  await send('Page.navigate', { url: `${ORIGIN}/calendar/` });
  await sleep(1500);
  if (mode === 'K') {
    await ev(`document.querySelector('#board').click()`);
    await sleep(500);
    return;
  }
  if (mode !== 'M') await zoomPick(NAMES[mode]);
};

// There is no `+` in the pane: a new entry comes from empty space in a cell. Wide enough that
// the month view opens the popup rather than the day preview.
const newEntry = async () => {
  await ev(`document.querySelector('.day .num').click()`);
  await sleep(350);
};

const shoot = async name => {
  if (!SHOT) return;
  const s = await send('Page.captureScreenshot', { format: 'png' });
  (await import('fs')).writeFileSync(`${SHOT}/${name}.png`, Buffer.from(s.data, 'base64'));
};

// Each row as label plus background, and - on the toggle row - the badge that carries the
// value, which is the whole of what the two rows promise.
const row = sel => `[...document.querySelectorAll('${sel} .ib')].map(b => {
  const cs = getComputedStyle(b), d = b.querySelector('.badge');
  return (b.getAttribute('aria-label') || '?').split(':')[0] +
    (d ? '[' + (d.textContent || getComputedStyle(d).backgroundColor) + ']' : '') +
    (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : '@' + cs.backgroundColor);
})`;
const ROW = row('#f-icons'), FLAGS = row('#f-rows .flags');
// Icons alone is a rule about the icon row. The toggle row carries two words on purpose - `24h`,
// because every drawing of a whole day reads as something else, and `!` - so scoping this to the
// icon row is what keeps the two rules from cancelling each other out.
const glyphs = `document.querySelectorAll('#f-icons .glyph').length`;
const words = sel => `[...document.querySelectorAll('${sel} .glyph')].map(g => g.textContent)`;
// The `x` owns the rightmost place in every popup. Read from the left edges, so a row that
// reads correctly but was built in the old order cannot pass - counting three buttons would.
const rightmost = sel => ev(`[...document.querySelectorAll('${sel} button')]
  .filter(b => b.getClientRects().length)
  .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  .map(b => (b.getAttribute('aria-label') || '?').split(':')[0])`);
// There is one popup: clicking an entry opens it, shown as text, and there is no pen.
const openExisting = async sel => {
  await ev(`document.querySelector('${sel}').click()`);
  await sleep(400);
};
const closeForm = async () => {
  await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
  await sleep(300);
  // A popup left dirty asks before discarding; these checks mean to throw the edit away.
  if (!await ev(`document.querySelector('#ask').hidden`)) {
    await ev(`document.querySelector('#ask-discard').click()`);
    await sleep(300);
  }
};
const click = n => ev(`document.querySelectorAll('#f-icons .ib')[${n}].click()`);
const flag = n => ev(`document.querySelectorAll('#f-rows .flags .ib')[${n}].click()`);
const save = async () => {
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').click()`);
  await sleep(500);
};
const hasDisk = () => ev(`!!document.querySelector('#f-icons [aria-label="Save"]')`);
const queueLen = () => ev(`(async () => {
  const db = await new Promise(res => { const r = indexedDB.open('mine', 1); r.onsuccess = () => res(r.result); });
  return await new Promise(res => {
    const q = db.transaction('queue', 'readonly').objectStore('queue').count();
    q.onsuccess = () => res(q.result);
  });
})()`);
const label = g => g.split('@')[0].split('[')[0];
const badge = g => (g.match(/\[(.*)\]/) || [, ''])[1];

// A row: the field it is, the text it shows, whether that text is the muted field name rather
// than a value, and whether it carries a trashcan. A set row shows its value and no field name.
const FIELD_ROWS = `[...document.querySelectorAll('#f-rows .frow')]
  .filter(r => !['title', 'when'].includes(r.dataset.field))
  .map(r => ({
    field: r.dataset.field,
    text: r.querySelector('.ftap') ? r.querySelector('.ftap').textContent : '',
    unset: !!r.querySelector('.ftap.unset'),
    aria: r.querySelector('.ftap') ? r.querySelector('.ftap').getAttribute('aria-label') : '',
    trash: r.querySelectorAll('[aria-label^="Clear"]').length,
    open: r.classList.contains('in') || r.classList.contains('open'),
    h: Math.round(r.getBoundingClientRect().height),
    muted: r.querySelector('.ftap') ? getComputedStyle(r.querySelector('.ftap')).color : ''
  }))`;
// Clicking the row's text opens it - an input in the line for the three text fields, a popup
// anchored to the row for the four whose control cannot be a line. The title row of a new entry
// is already open and has no text to click.
const tapRow = async field => {
  await ev(`(() => {
    const t = document.querySelector('#f-rows [data-field="${field}"] .ftap')
      || document.querySelector('#f-rows [data-field="${field}"] .vbody-tap')
      || document.querySelector('#f-rows [data-field="${field}"]');
    t.click();
  })()`);
  await sleep(350);
};
const openRow = tapRow;
// A row has no save of its own: closing it keeps what is in it, because the editor has been
// writing into the draft all along. Its trashcan and its x sit at the right of the line itself.
const rowX = async field => {
  await ev(`document.querySelector('#f-rows [data-field="${field}"] [aria-label="Close this field"]').click()`);
  await sleep(250);
};
const rowButtons = field => ev(`[...document.querySelectorAll(
  '#f-rows [data-field="${field}"] .ib')]
  .map(b => (b.getAttribute('aria-label') || '?').split(':')[0])`);
const popButtons = () => ev(`[...document.querySelectorAll('#fpop .ib')]
  .map(b => (b.getAttribute('aria-label') || '?').split(':')[0])`);
// The input is in the row for a text field and in the popup for the rest, so the typing helper
// takes whichever is there.
const typeIn = async (field, value) => {
  await ev(`(() => {
    const n = document.querySelector('#f-rows [data-field="${field}"] input, '
        + '#f-rows [data-field="${field}"] textarea')
      || document.querySelector('#fpop input, #fpop textarea');
    n.value = ${JSON.stringify(value)};
    n.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
};
// One of the when popup's four boxes: 0 start date, 1 start time, 2 end date, 3 end time.
const typeWhen = async (i, value, blur) => {
  await ev(`(() => {
    const n = document.querySelectorAll('#fpop input')[${i}];
    n.value = ${JSON.stringify(value)};
    n.dispatchEvent(new Event('input', { bubbles: true }));
    ${blur ? `n.dispatchEvent(new Event('blur'));` : ''}
    return n.value;
  })()`);
  await sleep(200);
  return ev(`document.querySelectorAll('#fpop input')[${i}].value`);
};
// The hamburger names its two errands before either opens: one tap to show them, one to pick.
const menu = async which => {
  await ev(`document.querySelector('#menu-btn').click()`);
  await sleep(350);
  if (!which) return;
  await ev(`[...document.querySelectorAll('#menu-body .mrow')]
    .find(b => b.textContent === '${which}').click()`);
  await sleep(400);
};
const box = sel => ev(`(() => {
  const r = document.querySelector('${sel}').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom),
           h: document.documentElement.clientHeight };
})()`);
const centred = b => b.top > 0 && b.bottom < b.h - 8;

// ---- 1. every view fits a phone, in both schemes ----------------------------------------------

await viewport(360);
await open();
eq('fixture seeded', typeof await seed() === 'number', true);

for (const scheme of ['light', 'dark']) {
  for (const mode of ['M', 'W', 'Y', 'D', 'K']) {
    for (const width of [320, 360]) {
      await viewport(width, scheme);
      await open(mode);
      const over = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      ok(`fit ${mode} at ${width}px ${scheme}`, over === 0, over > 0 ? `overflows by ${over}px` : '');
      if (width === 360 && scheme === 'light') await shoot(`view-${mode}`);
    }
  }
}

// ---- 2. one popup, its rows, its toggle row and its one disk ----------------------------------

await viewport(900);
await open();
const good = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--good').trim()`);
const bad = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--bad').trim()`);
const rgb = async hex => ev(`(() => { const d = document.createElement('div');
  d.style.color = '${hex}'; document.body.append(d);
  const c = getComputedStyle(d).color; d.remove(); return c; })()`);
const GOOD = await rgb(good), BAD = await rgb(bad);
const MUTED = await rgb(await ev(
  `getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()`));
const FG = await rgb(await ev(
  `getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()`));

await newEntry();
const asEvent = await ev(ROW);
eq('a new entry\'s top row is the type pair, the disk and the x', asEvent.map(label),
  ['Task', 'Event', 'Save', 'Close']);
eq('the x is its rightmost control', (await rightmost('#f-icons')).slice(-1), ['Close']);
eq('no letter anywhere in the top row', await ev(glyphs), 0);
eq('and no pen anywhere in the popup',
  await ev(`document.querySelectorAll('#popup [aria-label^="Edit"]').length`), 0);
eq('a new entry is an event', (await ev(FLAGS)).map(label), ['All-day']);
eq('and its toggle row says 24h, not a sun', await ev(words('#f-rows .flags')), ['24h']);
// An entry must have a title, and that is the only way a new entry differs from an edit.
eq('the disk is disabled until the title has text',
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').disabled`), true);
eq('and its title row is already an input in its own line', await ev(
  `(() => { const r = document.querySelector('#f-rows [data-field="title"]');
    return [!!r.querySelector('input'), r.classList.contains('open')]; })()`), [true, false]);
await typeIn('title', 'A new one');
eq('and enabled once it has',
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').disabled`), false);

const disk = await ev(`(() => {
  const b = document.querySelector('#f-icons [aria-label="Save"]'), cs = getComputedStyle(b);
  return { color: cs.color, bg: cs.backgroundColor };
})()`);
eq('the save disk is a green glyph', disk.color, GOOD);
eq('and carries no background', disk.bg, 'rgba(0, 0, 0, 0)');

// The toggle row sits below the when row, not above it: read from document order, since a row
// that merely looks right can still be the old one.
eq('the toggle row is below the when row', await ev(
  `document.querySelector('#f-rows [data-field="when"]')
     .compareDocumentPosition(document.querySelector('#f-rows .flags')) & 4 ? 'after' : 'before'`),
  'after');

const rows0 = await ev(FIELD_ROWS);
eq('five field rows, in canonical order, and no details row among them',
  rows0.filter(r => r.field !== 'estimate').map(r => r.field),
  ['group', 'recurrence', 'alerts', 'location', 'participants']);
eq('each one unset shows its field name', rows0.filter(r => !r.unset).map(r => r.field), []);
eq('and shows it muted, not plain',
  [...new Set(rows0.map(r => r.muted))], [MUTED]);
eq('no row carries a trashcan while it is unset', rows0.reduce((n, r) => n + r.trash, 0), 0);
eq('the body is a block of its own, not a row',
  await ev(`!!document.querySelector('#f-rows .vbody[data-field="body"]')`), true);

// A set row shows its value - `Conference room 3B`, not `Location Conference room 3B` - and the
// field's name survives only in the button's label, for a screen reader. Clicking another row
// takes what is in the one that was open; there is no save in a row to press.
const closedH = (await ev(FIELD_ROWS)).find(r => r.field === 'location').h;
await openRow('location');
// The one measurement this whole shape exists for: an open row is exactly as tall as it was
// shut, so nothing below it moves and the field is still where it was tapped.
const openH = (await ev(FIELD_ROWS)).find(r => r.field === 'location').h;
eq('an open text row is the same height as a closed one', openH, closedH);
await typeIn('location', 'Conference room 3B');
await openRow('participants');
await rowX('participants');
const rows1 = await ev(FIELD_ROWS);
const loc = rows1.find(r => r.field === 'location');
eq('a set row stays where it was', rows1.map(r => r.field).indexOf('location'),
  rows0.map(r => r.field).indexOf('location'));
eq('and shows the value alone', loc.text, 'Conference room 3B');
eq('with the name only in its label', loc.aria, 'Location: Conference room 3B');
eq('drawn plain rather than muted', loc.muted, FG);
eq('and it now carries a trashcan', loc.trash, 1);
eq('the unset rows keep their order',
  rows1.filter(r => r.unset && r.field !== 'estimate').map(r => r.field),
  ['group', 'recurrence', 'alerts', 'participants']);

// A row being edited carries a trashcan and an x and no save: there is one save in this popup,
// and the two sit at the right of the line itself, where the closed row's trashcan already was.
await openRow('location');
eq('an open row carries a trashcan and an x, and no save', await rowButtons('location'),
  ['Clear location', 'Close this field']);
ok('all three on one line with the input', await ev(
  `(() => { const r = document.querySelector('#f-rows [data-field="location"]');
    const tops = [...r.querySelectorAll('input, .ib')]
      .map(n => Math.round(n.getBoundingClientRect().top));
    return Math.max(...tops) - Math.min(...tops) <= 4; })()`),
  'the buttons are not on the input\'s line');
ok('and the x is the rightmost of them', await ev(
  `(() => { const bs = [...document.querySelectorAll('#f-rows [data-field="location"] .ib')];
    const x = bs.find(b => b.getAttribute('aria-label') === 'Close this field');
    return bs.every(b => b === x || b.getBoundingClientRect().left < x.getBoundingClientRect().left);
  })()`), 'the x is not rightmost in the row');
eq('and the editor is inside the row',
  await ev(`!!document.querySelector('#f-rows [data-field="location"] input')`), true);
eq('with no field popup and no heading above it', await ev(
  `[document.querySelector('#fpop').hidden,
    document.querySelectorAll('#f-rows [data-field="location"] .ftitle').length]`), [true, 0]);
eq('with no sub-popup opened', await ev(`document.querySelector('#sub').hidden`), true);

// The row's x closes it and keeps what was typed: the editor has been writing into the draft all
// along, so there is nothing left to accept and nothing to lose by leaving.
await typeIn('location', 'Somewhere else');
await rowX('location');
const kept = (await ev(FIELD_ROWS)).find(r => r.field === 'location');
eq('the row\'s x closes the row', kept.open, false);
eq('and keeps what was typed', kept.text, 'Somewhere else');
eq('still without writing it', await queueLen(), 0);
await openRow('location');
await typeIn('location', 'Conference room 3B');
await rowX('location');

// Clicking a row's trashcan clears the field without opening it.
await ev(`document.querySelector('#f-rows [data-field="location"] [aria-label^="Clear"]').click()`);
await sleep(250);
const cleared = (await ev(FIELD_ROWS)).find(r => r.field === 'location');
eq('a row trashcan clears the field', [cleared.unset, cleared.text], [true, 'Location']);
eq('and does not open the row', cleared.open, false);

// ---- 2b. the four fields whose control cannot be a line ---------------------------------------
// The category, the repetition and the when open a popup anchored to their row, and the row is
// left exactly as it was: same height, same text, same trashcan. That is the whole of it - a row
// that grew a heading and a control sent the eye hunting for the field it had just tapped.

for (const [fieldName, expect] of [['group', 'Category'], ['recurrence', 'Repeat']]) {
  const before = await ev(`(() => {
    const r = document.querySelector('#f-rows [data-field="${fieldName}"]');
    return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
             rows: document.querySelectorAll('#f-rows .frow').length }; })()`);
  await tapRow(fieldName);
  const after = await ev(`(() => {
    const r = document.querySelector('#f-rows [data-field="${fieldName}"]');
    const p = document.querySelector('#fpop');
    return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
             rows: document.querySelectorAll('#f-rows .frow').length,
             open: !p.hidden, title: document.querySelector('#fpop-title').textContent,
             under: p.getBoundingClientRect().top > r.getBoundingClientRect().bottom,
             inRow: r.querySelectorAll('input, select').length,
             scrim: document.querySelector('#scrim').hidden }; })()`);
  ok(`${fieldName} opens a popup under its row`, after.open && after.under, JSON.stringify(after));
  eq(`named ${expect}`, after.title, expect);
  eq(`and the ${fieldName} row does not change`, [after.h, after.text, after.rows],
    [before.h, before.text, before.rows]);
  eq('with no control left in the row itself', after.inRow, 0);
  // No scrim, so the tap that dismisses it still reaches the row it landed on.
  eq('and no scrim behind it', after.scrim, true);
}

// One tap from one field to the next: the dismissing tap is the opening tap, which is the whole
// reason this popup has no scrim of its own.
await tapRow('group');
eq('tapping another row moves straight to it', await ev(
  `document.querySelector('#fpop-title').textContent`), 'Category');
// And tapping the row it is already on closes it rather than reopening it.
await tapRow('group');
eq('tapping the open row closes it', await ev(`document.querySelector('#fpop').hidden`), true);

// Picking a category takes it and closes the popup: there is nothing more to say about a choice
// from a list, and the entry popup behind it stays open.
await tapRow('group');
await ev(`document.querySelector('#fpop .gpick').click()`);
await sleep(350);
const tookIt = await ev(`[document.querySelector('#fpop').hidden,
  document.querySelector('#popup').hidden,
  document.querySelector('#f-rows [data-field="group"] .ftap.unset') ? 'unset' : 'set']`);
eq('picking a category closes the popup and keeps the entry', tookIt, [true, false, 'set']);
await ev(`document.querySelector('#f-rows [data-field="group"] [aria-label^="Clear"]').click()`);
await sleep(300);

// The when is the row that had the most to gain: four boxes cannot be a line, so they are in the
// popup and the row goes on reading the day while they are open.
const whenBefore = await ev(`(() => {
  const r = document.querySelector('#f-rows [data-field="when"]');
  return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent }; })()`);
await tapRow('when');
const whenOpen = await ev(`(() => {
  const r = document.querySelector('#f-rows [data-field="when"]');
  const ins = [...document.querySelectorAll('#fpop input')];
  return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
           count: ins.length, types: ins.map(i => i.type) }; })()`);
eq('the when row does not change when its popup opens',
  [whenOpen.h, whenOpen.text], [whenBefore.h, whenBefore.text]);
eq('the popup holds four boxes', whenOpen.count, 4);
// A native time input takes its 12- or 24-hour shape from the device locale and nothing in
// markup can tell it otherwise, so the two times are typed. The dates stay native.
eq('two native dates and two typed times, never a native time',
  whenOpen.types, ['date', 'text', 'date', 'text']);

// What a typed time accepts, and what it reads back as. The draft is what the row reads, so the
// row is checked too rather than only the box.
for (const [typed, shown] of [['930', '09:30'], ['9', '09:00'], ['0815', '08:15'],
  ['7:5', '07:05'], ['23:59', '23:59']]) {
  eq(`${typed} reads back as ${shown}`, await typeWhen(1, typed, true), shown);
}
// Rejected outright: the box goes back to what the draft still holds rather than keeping nonsense.
for (const bad of ['25:00', '9:70', 'noon', '99']) {
  eq(`${bad} is refused`, await typeWhen(1, bad, true), '23:59');
}
// The row does not restate the time while the popup is open - that is what keeps it still - and
// it reads it the moment the popup closes.
eq('the row holds its text while the popup is typed into',
  await ev(`document.querySelector('#f-rows [data-field="when"] .ftap').textContent`),
  whenBefore.text);
await ev(`document.querySelector('#fpop-close').click()`);
await sleep(300);
eq('the popup x closes it and leaves the entry open', await ev(
  `[document.querySelector('#fpop').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
eq('and the row then reads the time it was given', await ev(
  `document.querySelector('#f-rows [data-field="when"] .ftap').textContent.includes('23:59')`),
  true);

// Escape unwinds one layer at a time rather than throwing the edit away from inside a field.
await tapRow('recurrence');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
eq('Escape closes the field popup first', await ev(
  `[document.querySelector('#fpop').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
// An inline row is not a layer, so it does **not** swallow an Escape: leaving it loses nothing,
// and a new entry opens with its title row already an input, so swallowing the first press would
// cost two to leave the commonest popup in the app. Escape there asks the discard question.
await tapRow('location');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(350);
eq('an inline row does not swallow Escape', await ev(
  `[!!document.querySelector('#f-rows [data-field="location"] input'),
    !document.querySelector('#ask').hidden]`), [true, true]);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(250);
await rowX('location');

const allday = (await ev(FLAGS))[0];
await flag(0);
await sleep(250);
const alldayOn = (await ev(FLAGS))[0];
ok('all-day lights when on', alldayOn.includes('@'), alldayOn);
ok('and not in green', !alldayOn.endsWith('@' + GOOD), `${alldayOn} must not be the disk's green`);
await flag(0);
await sleep(200);
eq('and goes plain again', allday.includes('@'), false);

await click(0);                                   // task
await sleep(300);
const asTask = await ev(FLAGS);
eq('a task row carries the three', asTask.map(label),
  ['All-day', 'Stage', 'Important', 'Estimate']);
eq('and reads 24h and !', await ev(words('#f-rows .flags')), ['24h', '!']);
eq('the field rows do not reshuffle',
  (await ev(FIELD_ROWS)).filter(r => r.field !== 'estimate').map(r => r.field),
  ['group', 'recurrence', 'alerts', 'location', 'participants']);
eq('a new estimate is one day', badge(asTask[3]), '1d');
ok('a new task starts at todo', !!badge(asTask[1]), 'the stage badge carries its colour');

const stages = [];
for (let i = 0; i < 3; i++) { await flag(1); await sleep(220); stages.push(badge((await ev(FLAGS))[1])); }
ok('stage cycles through three colours', new Set(stages).size === 3, stages.join(' '));
ok('and returns to where it started', stages[2] === badge(asTask[1]), `${stages[2]} vs ${badge(asTask[1])}`);

const bangs = [];
for (let i = 0; i < 2; i++) { await flag(2); await sleep(220); bangs.push((await ev(FLAGS))[2]); }
ok('important lights when on', bangs[0].includes('@'), bangs[0]);
ok('and not in green', !bangs[0].endsWith('@' + GOOD), `${bangs[0]} must not be the disk's green`);
ok('two taps return it to plain', !bangs[1].includes('@'), bangs[1]);
eq('and it carries no badge either way', bangs.map(badge), ['', '']);

// The estimate is the one of the four that opens an editor, because a number has to be typed -
// and it opens in a popup under the hourglass, so the toggle row keeps its one line.
const flagsH = await ev(
  `Math.round(document.querySelector('#f-rows .flags').getBoundingClientRect().height)`);
await flag(3);
await sleep(300);
const est = await ev(`(() => {
  const p = document.querySelector('#fpop');
  const b = document.querySelector('#f-rows [data-field="estimate"]').getBoundingClientRect();
  return { open: !p.hidden, title: document.querySelector('#fpop-title').textContent,
           value: p.querySelector('input').value,
           rows: document.querySelectorAll('#f-rows [data-field="estimate"]').length,
           sub: document.querySelector('#sub').hidden,
           under: p.getBoundingClientRect().top > b.bottom,
           flagsH: Math.round(document.querySelector('#f-rows .flags').getBoundingClientRect().height) };
})()`);
ok('the estimate opens a popup under the hourglass', est.open && est.under, JSON.stringify(est));
eq('named for the field', est.title, 'Estimate');
eq('and the toggle row gains no row of its own', est.rows, 1);
eq('nor any height', est.flagsH, flagsH);
eq('and opens no sub-popup', est.sub, true);
eq('prefilled with one day', est.value, '1');
// The one popup that carries the trashcan itself: its row is an icon with no room beside it.
eq('its buttons are a trashcan and an x', await popButtons(),
  ['Clear estimate', 'Close this field']);
eq('the trashcan is red', await ev(
  `getComputedStyle(document.querySelector('#fpop [aria-label^="Clear"]')).color`), BAD);

await typeIn('estimate', '3');
await flag(3);                                   // tapping the hourglass again closes the popup
await sleep(300);
eq('the estimate badges its days', badge((await ev(FLAGS))[3]), '3d');
eq('and the popup is shut', await ev(`document.querySelector('#fpop').hidden`), true);
await flag(3);
await sleep(300);
await ev(`document.querySelector('#fpop [aria-label^="Clear"]').click()`);
await sleep(300);
eq('a cleared estimate loses its badge', badge((await ev(FLAGS))[3]), '');

await click(1);                                   // back to an event
await sleep(300);
eq('an event drops all three', (await ev(FLAGS)).map(label), ['All-day']);

// ---- 3. a trashcan is red wherever it appears --------------------------------------------------

await closeForm();

// Every icon comes from the one table in ui.js: the shell's buttons are empty in the markup and
// are filled by icon() at boot. An empty one is what a missed id or a renamed table entry leaves
// behind, and it would otherwise still pass the position and colour checks below.
const bare = await ev(`[...document.querySelectorAll(
  '#zoom-btn, #menu-btn, #board, #home, #day-add, #day-close, #sub-close, #settings-close')]
  .filter(b => !b.querySelector('svg')).map(b => b.id)`);
eq('every shell button got its icon from the table', bare, []);

// One popup: clicking an entry opens it, shown as text, with no input in it until a row is
// clicked, and its top row runs trashcan, x - no pen and no disk, nothing having changed yet.
await openExisting('.eline');
eq('an existing entry opens with no input in it', await ev(
  `document.querySelectorAll('#popup input, #popup select, #popup textarea').length`), 0);
const vrow = await rightmost('#f-icons');
eq('its top row is the trashcan and the x', vrow, ['Delete', 'Close']);
eq('no disk until something changes', await hasDisk(), false);
eq('the delete trashcan is red', await ev(
  `getComputedStyle([...document.querySelectorAll('#f-icons .ib')]
     .find(b => /^Delete/.test(b.getAttribute('aria-label')))).color`), BAD);
eq('the type is shown and not pressable', await ev(
  `document.querySelectorAll('#f-icons span.ib').length`), 1);

// The disk appears when the draft differs from the file and goes away again when it is put
// back: it reads the same comparison the discard prompt makes, not a flag set on first touch.
const was = await ev(`document.querySelector('#f-rows [data-field="title"] .ftap').textContent`);
await openRow('title');
await typeIn('title', `${was} edited`);
eq('the disk appears on a change', await hasDisk(), true);
eq('and the top row then runs trashcan, disk, x', await rightmost('#f-icons'),
  ['Delete', 'Save', 'Close']);
await typeIn('title', was);
eq('and goes away again when it is put back', await hasDisk(), false);
eq('nothing was written while it showed', await queueLen(), 0);
await closeForm();

await open('K');
eq('a kanban card has no trashcan to colour', await ev(
  `document.querySelectorAll('.kcard .ib.bad').length`), 0);
await shoot('view-K');

// A group's pen, trashcan and disk live in the popup behind *edit groups* - the one place in the
// calendar where a group is named or coloured, and the one survivor of the sub-popup, because it
// edits no field of an entry.
await open();
await menu('settings');
await ev(`document.querySelector('#edit-groups').click()`);
await sleep(450);
eq('edit groups opens the group list', await ev(
  `!document.querySelector('#sub').hidden && document.querySelector('#sub-title').textContent`),
  'Groups');
eq('and its header is the x alone', await rightmost('#sub .pop-head'), ['Close']);
eq('it deletes a group in red', await ev(
  `getComputedStyle([...document.querySelectorAll('#sub .ib')]
     .find(b => /^Delete/.test(b.getAttribute('aria-label')))).color`), BAD);
await ev(`[...document.querySelectorAll('#sub .grow .ib')]
  .find(b => /^Edit/.test(b.getAttribute('aria-label'))).click()`);
await sleep(400);
eq('and saves one in green', await ev(
  `getComputedStyle([...document.querySelectorAll('#sub .ib')]
     .find(b => /^Save/.test(b.getAttribute('aria-label')))).color`), GOOD);
eq('with no background either', await ev(
  `getComputedStyle([...document.querySelectorAll('#sub .ib')]
     .find(b => /^Save/.test(b.getAttribute('aria-label')))).backgroundColor`), 'rgba(0, 0, 0, 0)');
await ev(`document.querySelector('#sub-close').click()`);
await sleep(250);
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

// The same list reached from an entry only picks, in the category row, and a tap on a group
// closes the row - there is nothing more to say about a choice from a list. Naming, recolouring
// and deleting a group are settings, and clearing the field is the row's own trashcan, so there
// is no `no category` row either.
await open();
await newEntry();
await tapRow('group');
const pick = await ev(`({
  inPop: !!document.querySelector('#fpop .glist'),
  inRow: !!document.querySelector('#f-rows [data-field="group"] .glist'),
  sub: document.querySelector('#sub').hidden,
  rows: document.querySelectorAll('#fpop .gpick').length,
  pens: [...document.querySelectorAll('#fpop .ib')]
    .filter(b => /^Edit /.test(b.getAttribute('aria-label') || '')).length,
  trashes: [...document.querySelectorAll('#fpop .glist .ib')]
    .filter(b => /^Delete /.test(b.getAttribute('aria-label') || '')).length,
  add: [...document.querySelectorAll('#fpop .link')]
    .filter(b => /add/i.test(b.textContent)).length,
  none: [...document.querySelectorAll('#fpop .gpick')]
    .filter(b => /no category/i.test(b.textContent)).length
})`);
ok('the category popup lists the groups', pick.inPop && pick.rows > 0, JSON.stringify(pick));
eq('and the row itself holds no list', pick.inRow, false);
eq('and opens no sub-popup', pick.sub, true);
eq('with no pen', pick.pens, 0);
eq('and no trashcan', pick.trashes, 0);
eq('and no + add', pick.add, 0);
eq('and no no-category row', pick.none, 0);
eq('the popup carries no save, because the tap is the choice', await popButtons(),
  ['Close this field']);

// A tap on a group closes the popup in one tap, and writes nothing: the disk is what writes.
await ev(`document.querySelector('#fpop .gpick').click()`);
await sleep(300);
const chose = await ev(FIELD_ROWS);
eq('picking a group closes the popup', await ev(`document.querySelector('#fpop').hidden`), true);
eq('and sets it', chose.find(r => r.field === 'group').unset, false);
eq('and writes nothing on its own', await queueLen(), 0);
await closeForm();

// ---- 4. the filter and the top pane ------------------------------------------------------------

// The hamburger names its two errands and opens neither: one tap shows `filter` and `settings`,
// a second opens the one that was meant. There is still no gear and no filter button in the pane,
// because both are behind this one button.
await viewport(900);
await open();
eq('there is no gear and no filter button in the pane',
  await ev(`document.querySelectorAll('#gear, #filter-btn').length`), 0);
await menu();
eq('the hamburger opens a menu naming its two errands', await ev(
  `(() => { const p = document.querySelector('#menu-pop');
    return !p.hidden && [...p.querySelectorAll('.mrow')].map(b => b.textContent); })()`),
  ['filter', 'settings']);
eq('and opens neither of them yet', await ev(
  `[document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').hidden]`), [true, true]);
eq('the menu hangs off the hamburger, within its right edge', await ev(
  `(() => { const b = document.querySelector('#menu-btn').getBoundingClientRect();
    const p = document.querySelector('#menu-pop').getBoundingClientRect();
    return [p.top > b.bottom, Math.round(p.right) <= Math.round(b.right) + 1]; })()`),
  [true, true]);

await menu('filter');
eq('filter opens the filter alone', await ev(
  `[document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').hidden,
    document.querySelector('#menu-pop').hidden]`), [false, true, true]);
// Hanging off the hamburger rather than centred: the view it narrows has to stay in sight while
// it is narrowed, which a centred card over the middle of the screen cannot do.
ok('and hangs off the hamburger rather than being centred', await ev(
  `(() => { const b = document.querySelector('#menu-btn').getBoundingClientRect();
    const p = document.querySelector('#filter-pop').getBoundingClientRect();
    return p.top > b.bottom && p.top < b.bottom + 20; })()`), 'the filter is not under the button');
// The groups are no longer folded away: that fold existed only because an open list pushed the
// nine settings rows below the fold, and the settings are not in here any more.
const groups = await ev(`({
  drop: document.querySelectorAll('#filter-body .gdrop').length,
  shown: document.querySelectorAll('#filter-body .glab').length,
  swatches: document.querySelectorAll('#filter-body .glab .swatch').length
})`);
eq('the groups are listed, not folded behind a dropdown', groups.drop, 0);
ok('a checkbox per group, straight away', groups.shown >= 3, `${groups.shown} checkboxes`);
eq('each showing its colour', groups.swatches, groups.shown);
await ev(`document.querySelectorAll('#filter-body .glab input')[0].click()`);
await sleep(500);
const ticks = await ev(`[...document.querySelectorAll('#filter-body .glab input')].map(i => i.checked)`);
eq('unticking one leaves the rest on', [ticks[0], ticks.slice(1).every(Boolean)], [false, true]);
await ev(`document.querySelectorAll('#filter-body .glab input')[0].click()`);
await sleep(500);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);
// The settings panel holds the nine rows and nothing else: no filter section above them, so the
// last of them is above the fold at 320px with nothing to push it down.
await viewport(320);
await menu('settings');
eq('settings opens the panel alone, with no filter section in it', await ev(
  `[document.querySelector('#settings-panel').hidden,
    document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').querySelectorAll('#filter-body').length]`),
  [false, true, 0]);
const fold = await ev(`(() => {
  const rows = document.querySelectorAll('#settings-body .srow');
  const last = rows[rows.length - 1].getBoundingClientRect();
  const panel = document.querySelector('#settings-panel').getBoundingClientRect();
  return Math.round(last.bottom - panel.bottom);
})()`);
ok('the ninth settings row stays above the fold at 320px', fold <= 2, `${fold}px past it`);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await viewport(900);
await open('K');
await menu('filter');
const boardFilter = await ev(`({
  chips: [...document.querySelectorAll('#filter-body .chip')].map(c => c.textContent),
  selects: document.querySelectorAll('#filter-body select').length
})`);
eq('the board filter has one important toggle, not four chips', boardFilter.chips, ['!']);
ok('and still an assignee', boardFilter.selects >= 1, 'no assignee select on the board filter');
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await viewport(900);
await open();
await menu('filter');
eq('and neither is in a calendar view', await ev(
  `document.querySelectorAll('#filter-body .chip, #filter-body select').length`), 0);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

eq('the pane dropped Today, +, D W M Y K and the zoom pair',
  await ev(`document.querySelectorAll('#today, #add, [data-mode], #zoom-in, #zoom-out').length`), 0);
eq('home leaves for Mine', await ev(`document.querySelector('#home').getAttribute('href')`), '../');

const periodLabel = () => ev(`document.querySelector('#period-label').textContent`);
const month = m => ev(`new Date(${new Date().getFullYear()}, ${m}, 1, 12)
  .toLocaleDateString(undefined, { month: 'short' }).replace(/\\./g, '').toUpperCase()`);
const YY = String(new Date().getFullYear()).slice(2);

ok('the month label is MMM/YY', new RegExp(`^[^/]+/${YY}$`).test(await periodLabel()), await periodLabel());
await open('W');
ok('the week label is Wnn/MMM', /^W\d{1,2}\/[^/]+$/.test(await periodLabel()), await periodLabel());
await open('D');
ok('the day label is DD dd/MMM', /^\S{2} \d{1,2}\/[^/]+$/.test(await periodLabel()), await periodLabel());
await open('Y');
eq('the year label is the year', await periodLabel(), String(new Date().getFullYear()));
await open('K');
ok('the sprint label is the number alone', /^\d+$/.test(await periodLabel()), await periodLabel());

// The ISO number is in the week label whether or not the gutter is switched on.
const setWeeks = v => ev(`(async () => { await new Promise((res, rej) => {
  const q = indexedDB.open('mine', 1);
  q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite');
    t.objectStore('kv').put(${v}, 'calendar.showWeeks'); t.oncomplete = res;
    t.onerror = () => rej(t.error); };
}); return true; })()`);
await setWeeks(false);
await open('W');
ok('the week keeps its number with the gutter off', /^W\d/.test(await periodLabel()), await periodLabel());
eq('and the gutter is gone', await ev(`document.querySelectorAll('.wk').length`), 0);
await setWeeks(true);

// The label opens the picker, and that is all it does, in every view - the caret it needed when
// the label zoomed is gone, and a cycle left behind on it would show up as the view changing
// under the open picker.
eq('there is no caret in the pane', await ev(`document.querySelectorAll('#caret').length`), 0);
for (const mode of ['M', 'W', 'D', 'Y']) {
  await open(mode);
  await ev(`document.querySelector('#period').click()`);
  await sleep(350);
  const r = await ev(`({ open: !document.querySelector('#picker').hidden,
    view: document.querySelector('#view').className.replace('view v', '') })`);
  eq(`the ${mode} label opens the picker and does not zoom`, r, { open: true, view: mode });
  await ev(`document.querySelector('#scrim').click()`);
  await sleep(200);
}

await open('K');
await ev(`document.querySelector('#period').click()`);
await sleep(350);
eq('on the board the label opens the sprint list', await ev(
  `!document.querySelector('#picker').hidden && !!document.querySelector('.pick-body.sprints')`), true);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

// The zoom: anchored under its own button, offering what the view it was opened in can do and
// nothing else, with the current one marked.
await open();
await ev(`document.querySelector('#zoom-btn').click()`);
await sleep(300);
const zoom = await ev(`(() => {
  const p = document.querySelector('#zoom-pop'), b = document.querySelector('#zoom-btn');
  return { open: !p.hidden,
    below: Math.round(p.getBoundingClientRect().top - b.getBoundingClientRect().bottom),
    rows: [...p.querySelectorAll('.zrow')].map(r => r.textContent.trim()),
    on: [...p.querySelectorAll('.zrow.on')].map(r => r.textContent.trim()) };
})()`);
eq('the zoom lists the four periods in a calendar view', zoom.rows,
  ['day', 'week', 'month', 'year']);
eq('with the current one marked', zoom.on, ['month']);
ok('anchored under its own button', zoom.open && zoom.below >= 0 && zoom.below < 40,
  `${zoom.below}px below it`);
await ev(`document.querySelector('#scrim').click()`);
await sleep(200);
for (const [name, want] of [['day', 'D'], ['week', 'W'], ['year', 'Y'], ['month', 'M']]) {
  await zoomPick(name);
  eq(`picking ${name} lands in it`,
    (await ev(`document.querySelector('#view').className`)).replace('view v', ''), want);
}

await open('K');
await ev(`document.querySelector('#zoom-btn').click()`);
await sleep(300);
const zoomK = await ev(`({
  rows: [...document.querySelectorAll('#zoom-pop .zrow')].map(r => r.textContent.trim()),
  on: [...document.querySelectorAll('#zoom-pop .zrow.on')].map(r => r.textContent.trim())
})`);
eq('on the board it lists the two orientations and no period', zoomK.rows,
  ['vertical', 'horizontal']);
eq('with horizontal the default', zoomK.on, ['horizontal']);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await open();
await ev(`document.querySelector('#board').click()`);
await sleep(500);
eq('the board icon reaches the kanban', await ev(`!!document.querySelector('.kb')`), true);
await ev(`document.querySelector('#board').click()`);
await sleep(500);
eq('and the calendar icon returns to the month', await ev(`!!document.querySelector('.grid')`), true);

// Read from the left edges, so a reordering that looks right but wires the wrong button cannot
// pass - and at 320 px every control has to share one line.
const pane = `(() => {
  const on = ['#board', '#zoom-btn', '#prev', '#period', '#next', '#menu-btn', '#home']
    .map(id => [id, document.querySelector(id)])
    .filter(([, n]) => n && n.getClientRects().length)
    .map(([id, n]) => { const r = n.getBoundingClientRect();
      return { id, left: r.left, mid: r.top + r.height / 2 }; })
    .sort((a, b) => a.left - b.left);
  const mids = on.map(o => o.mid);
  return { order: on.map(o => o.id),
           spread: Math.round(Math.max(...mids) - Math.min(...mids)) };
})()`;

await viewport(900);
await open();
eq('the pane reads view, zoom, period, panel, home', (await ev(pane)).order,
  ['#board', '#zoom-btn', '#prev', '#period', '#next', '#menu-btn', '#home']);

// About half an arrow glyph either side of the label: the point is a visible separation, not a
// number, so it is measured against the arrow's own font size.
const gaps = await ev(`(() => {
  const b = sel => document.querySelector(sel).getBoundingClientRect();
  const em = parseFloat(getComputedStyle(document.querySelector('#prev')).fontSize);
  return { left: Math.round(b('#period').left - b('#prev').right),
           right: Math.round(b('#next').left - b('#period').right), em: Math.round(em) };
})()`);
ok('the label stands about half an arrow clear of each arrow',
  gaps.left >= gaps.em * 0.3 && gaps.left <= gaps.em * 0.8 &&
  Math.abs(gaps.left - gaps.right) <= 2, JSON.stringify(gaps));

await viewport(320);
await open();
// Two rows on a phone: the four that go somewhere share the first, the period takes the second.
// Rows are clustered by vertical centre rather than compared exactly, so a one-pixel difference
// between two controls of unequal height cannot read as a third row.
const narrow = await ev(`(() => {
  const on = ['#board', '#zoom-btn', '#prev', '#period', '#next', '#menu-btn', '#home']
    .map(id => [id, document.querySelector(id)])
    .filter(([, n]) => n && n.getClientRects().length)
    .map(([id, n]) => { const r = n.getBoundingClientRect();
      return { id, left: r.left, w: r.width, mid: r.top + r.height / 2,
               fs: Math.round(parseFloat(getComputedStyle(n).fontSize)),
               svg: n.querySelector('svg')
                 ? Math.round(n.querySelector('svg').getBoundingClientRect().width) : 0 }; })
    .sort((a, b) => a.mid - b.mid);
  const rows = [];
  for (const o of on) if (!rows.length || o.mid - rows[rows.length - 1] > 6) rows.push(o.mid);
  const of = i => on.filter(o => Math.abs(o.mid - rows[i]) <= 6).sort((a, b) => a.left - b.left);
  const w = sel => Math.round((of(1).find(o => o.id === sel) || { w: 0 }).w);
  const fs = sel => (on.find(o => o.id === sel) || { fs: 0 }).fs;
  return { rows: rows.length,
    first: of(0).map(o => o.id), second: of(1).map(o => o.id),
    firstW: of(0).map(o => Math.round(o.w)),
    label: w('#period'), prev: w('#prev'), next: w('#next'),
    arrowFs: fs('#prev'), iconPx: (on.find(o => o.id === '#board') || { svg: 0 }).svg };
})()`);
eq('on a phone the pane is two rows', narrow.rows, 2);
eq('the first holds the four that go somewhere', narrow.first,
  ['#board', '#zoom-btn', '#menu-btn', '#home']);
ok('sharing the row equally', Math.max(...narrow.firstW) - Math.min(...narrow.firstW) <= 2,
  narrow.firstW.join('px, ') + 'px');
eq('and the second the period, its arrows back', narrow.second,
  ['#prev', '#period', '#next']);
eq('whose two arrows are equal in size', narrow.prev, narrow.next);
ok('and whose label is larger than either', narrow.label > narrow.prev,
  `label ${narrow.label}px, arrow ${narrow.prev}px`);
// The arrows are drawn at the size of the icons on the row above, and in particular not at the
// 2rem they used to be, which made the row that steps the period the loudest thing in the pane.
ok('the second row\'s arrows match the first row\'s icons',
  Math.abs(narrow.arrowFs - narrow.iconPx) <= 2 && narrow.arrowFs < 30,
  `arrow ${narrow.arrowFs}px, icon ${narrow.iconPx}px`);

// There is no swipe left anywhere: the label was swiped only because a phone's pane had no
// `‹` `›` to press, and a gesture doing what a visible button does is a second mechanism for
// one action. The label is read before the gesture, because a step is synchronous - reading it
// afterwards would compare the new label with itself and pass whatever happened.
const swipeOn = sel => ev(`(() => {
  const n = document.querySelector('${sel}');
  const before = document.querySelector('#period-label').textContent;
  const r = n.getBoundingClientRect();
  const t = x => new Touch({ identifier: 2, target: n, clientX: x, clientY: r.top + 4 });
  n.dispatchEvent(new TouchEvent('touchstart',
    { bubbles: true, touches: [t(200)], changedTouches: [t(200)] }));
  n.dispatchEvent(new TouchEvent('touchend',
    { bubbles: true, touches: [], changedTouches: [t(40)] }));
  return before;
})()`);
for (const sel of ['#period', '.grid']) {
  const was = await swipeOn(sel);
  await sleep(400);
  eq(`a swipe on ${sel} changes nothing`, await periodLabel(), was);
}

// And the arrows that replaced it do step the period.
const beforeStep = await periodLabel();
await ev(`document.querySelector('#next').click()`);
await sleep(400);
ok('the phone pane\'s › steps the period', (await periodLabel()) !== beforeStep,
  `still ${beforeStep}`);

// A clipped label is worse than a smaller one: on its own row at twice the size, the label still
// has to fit whole at 320 px, or the date - the one thing the pane is for - is unreadable.
for (const mode of ['M', 'W', 'D', 'Y', 'K']) {
  await open(mode);
  const cut = await ev(`(() => { const n = document.querySelector('#period-label');
    return Math.round(n.scrollWidth - n.clientWidth); })()`);
  ok(`the ${mode} label fits the phone pane`, cut <= 1, `clipped by ${cut}px`);
}

// The step above left another month on screen: the checks below want the fixture's own.
await viewport(900);
await open();

// ---- 5. the month cell and the year view -------------------------------------------------------

eq('a month line carries no done-rectangle',
  await ev(`document.querySelectorAll('.grid .eline .tick').length`), 0);
eq('a month title is clipped, not ellipsised',
  await ev(`getComputedStyle(document.querySelector('.grid .eline .what')).textOverflow`), 'clip');
eq('and the line stays inside its cell', await ev(`[...document.querySelectorAll('.grid .eline')]
  .every(l => l.getBoundingClientRect().right <= l.closest('.day').getBoundingClientRect().right + 1)`), true);
await open('W');
ok('one-tap done stays in the week grid',
  await ev(`document.querySelectorAll('.tick').length`) > 0, 'no tick left in the week grid');

// The day view has no day header: the weekday and the date are the period label already. The
// week view's seven are a different thing - they name seven days the pane names none of - so
// the same check has to come out the other way in the two views.
eq('the week view keeps its seven day headers',
  await ev(`document.querySelectorAll('.tg-head .tgd').length`), 7);
await ev(`document.querySelector('.tg-head .tgd').click()`);
await sleep(400);
eq('and one of them still opens the day preview',
  await ev(`!document.querySelector('#day-pop').hidden`), true);
await ev(`document.querySelector('#day-close').click()`);
await sleep(250);
await open('D');
eq('the day view has none', await ev(`document.querySelectorAll('.tg-head .tgd').length`), 0);
ok('and still shows its hours and its all-day strip',
  await ev(`!!document.querySelector('.tg-allday') && document.querySelectorAll('.hr').length === 24`),
  'the day grid lost more than its header');

// The month fills the window: the grid's bottom reaches the calendar window's, rather than
// stopping at the height its cells happen to need - and the rows got taller, not fuller.
await viewport(900);
await open();
const fill = await ev(`(() => {
  const g = document.querySelector('.grid').getBoundingClientRect();
  const v = document.querySelector('#view').getBoundingClientRect();
  return { gap: Math.round(v.bottom - g.bottom),
           over: document.documentElement.scrollHeight - document.documentElement.clientHeight,
           lines: Math.max(...[...document.querySelectorAll('.day .rows')]
             .map(r => r.querySelectorAll('.eline').length)) };
})()`);
ok('the month fills the window', fill.gap <= 4, `${fill.gap}px short of the window`);
ok('and the page does not scroll', fill.over <= 0, `scrolls by ${fill.over}px`);
// The rows got taller, the cap did not change. The fullest cell has to hold more than a phone
// shows for the pair below to mean anything, which is what the fixture's busy day is for.
ok('a desktop cell still caps at four lines', fill.lines > 2 && fill.lines <= 4,
  `${fill.lines} lines in the fullest cell`);
await viewport(320);
await open();
const narrowCell = await ev(`({
  lines: Math.max(...[...document.querySelectorAll('.day .rows')]
    .map(r => r.querySelectorAll('.eline').length)),
  more: document.querySelectorAll('.day .more').length
})`);
eq('and a phone cell at two', narrowCell.lines, 2);
ok('with the rest behind a +N', narrowCell.more > 0, 'no +N anywhere, so nothing was capped');

// Every settings row is two halves, so the controls' left edges agree - the one measurement
// that separates the new panel from the old, where each control began wherever its label ended.
await viewport(900);
await open();
await menu('settings');
const panel = await ev(`(() => {
  const rows = [...document.querySelectorAll('#settings-body .srow')];
  const lefts = rows.map(r => Math.round(
    r.querySelector('.slab').nextElementSibling.getBoundingClientRect().left));
  const body = document.querySelector('#settings-body');
  return { rows: rows.length,
    labels: rows.map(r => r.querySelector('.slab').textContent),
    spread: Math.max(...lefts) - Math.min(...lefts),
    notes: body.querySelectorAll('.note').length,
    groups: body.querySelectorAll('.grow').length,
    last: body.lastElementChild.className };
})()`);
eq('the panel holds nine rows', panel.rows, 9);
eq('with the short labels', panel.labels,
  ['Groups', 'Start week on', 'Time zone', 'Date format', 'Calendar weeks',
    'Confirm discard', 'Sprint length', 'First sprint', 'Theme']);
ok('the controls line up in one column', panel.spread <= 1, `${panel.spread}px apart`);
eq('no group is listed in the panel itself', panel.groups, 0);
eq('and no paragraph explains what is stored where', panel.notes, 0);
eq('the last element is a row', panel.last, 'srow');
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(320);
await open();
await menu('settings');
const labelHeights = await ev(`[...document.querySelectorAll('#settings-body .slab')]
  .map(l => Math.round(l.getBoundingClientRect().height))`);
ok('no label wraps to a second line at 320px', new Set(labelHeights).size === 1,
  labelHeights.join(' '));
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

// Nothing is a bottom sheet any more: at 320 px every overlay sits clear of the bottom edge.
await ev(`document.querySelector('.day .num').click()`);     // a phone cell opens the preview
await sleep(400);
ok('the day preview is centred', centred(await box('#day-pop')), JSON.stringify(await box('#day-pop')));
await ev(`document.querySelector('#day-add').click()`);
await sleep(450);
ok('the entry popup is centred', centred(await box('#popup .card')),
  JSON.stringify(await box('#popup .card')));
// With its tallest row open - the body's textarea - the card still has to sit clear of both
// edges, because an editor inside a row is what the popup grows by now.
await openRow('body');
ok('and stays centred with its tallest row open', centred(await box('#popup .card')),
  JSON.stringify(await box('#popup .card')));
await closeForm();
await menu('settings');
ok('the settings panel is centred', centred(await box('#settings-panel')),
  JSON.stringify(await box('#settings-panel')));
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(900);
await open('Y');
await ev(`document.querySelector('.yday:not(.out)').click()`);
await sleep(400);
eq('a year day still opens the day preview',
  await ev(`!document.querySelector('#day-pop').hidden`), true);
// Centred on a desktop as well as on a phone: it is not anchored to the cell that opened it.
ok('and is centred there too, not beside the cell', centred(await box('#day-pop')),
  JSON.stringify(await box('#day-pop')));
await shoot('day-preview');
await ev(`document.querySelector('#day-close').click()`);
await sleep(250);
await ev(`document.querySelectorAll('.ycap')[4].click()`);
await sleep(500);
eq('a month name zooms into that month', await periodLabel(), `${await month(4)}/${YY}`);
eq('and lands in the month view', await ev(`!!document.querySelector('.grid')`), true);

// ---- 6. the board on a phone -------------------------------------------------------------------

await viewport(360);
await open('K');
// What is on screen, and exactly where. Both halves matter: a column strip that carries a gap
// or a padding is shifted by a little more than a column each time, so the one shown drifts
// sideways and the last one is cut off - and without the margin inside each column, that same
// drift is what leaves a sliver of the next column at the edge of the screen.
const shown = `(() => {
  const w = document.documentElement.clientWidth;
  const on = [...document.querySelectorAll('.kcol')].filter(c => {
    const r = c.getBoundingClientRect(); return r.right > 1 && r.left < w - 1; });
  const r = on[0].getBoundingClientRect();
  return { count: on.length, stage: on[0].dataset.stage,
    left: Math.round(r.left), right: Math.round(r.right) };
})()`;
const page = dir => ev(`[...document.querySelectorAll('.knav')]
  .find(b => b.getAttribute('aria-label') === '${dir} column').click()`);

eq('the header carries no count and no dot', await ev(
  `document.querySelectorAll('.khead .kcount, .khead .kdot').length`), 0);
eq('the stage name carries its colour', await ev(
  `getComputedStyle(document.querySelector('.kcol[data-stage="doing"] .kname')).color`),
  await rgb('#e0a500'));

const atTodo = await ev(shown);
eq('exactly one column is visible', atTodo.count, 1);
eq('and it is todo', atTodo.stage, 'todo');
eq('the pager is disabled at todo', await ev(`document.querySelector('.knav').disabled`), true);

// The pager fills the header: it is the only way to see another stage on a phone, and a small
// square in the middle of an otherwise empty row asked a thumb to aim at its narrowest part.
const pager = await ev(`(() => {
  const head = document.querySelector('.kcol[data-stage="todo"] .khead');
  const navs = [...head.querySelectorAll('.knav')];
  const boxes = navs.map(n => n.getBoundingClientRect());
  const hr = head.getBoundingClientRect();
  const add = head.querySelector('.kadd').getBoundingClientRect();
  return { w: boxes.map(b => Math.round(b.width)),
    left: Math.round(Math.min(...boxes.map(b => b.left)) - hr.left),
    gap: Math.round(add.left - Math.max(...boxes.map(b => b.right))),
    bg: navs.map(n => getComputedStyle(n).backgroundColor) };
})()`);
eq('its two arrows are equal in width', pager.w[0], pager.w[1]);
ok('and fill the header up to the +', pager.left <= 2 && pager.gap <= 10,
  `${pager.left}px in from the left, ${pager.gap}px short of the +`);
eq('the disabled one carries no background', pager.bg[0], 'rgba(0, 0, 0, 0)');
ok('and the one that works does', pager.bg[1] !== 'rgba(0, 0, 0, 0)', pager.bg[1]);

await page('Next');
await sleep(400);
const atDoing = await ev(shown);
eq('paging shows the next column alone', atDoing.count, 1);
eq('and it is doing', atDoing.stage, 'doing');
eq('in the same place as the first', [atDoing.left, atDoing.right], [atTodo.left, atTodo.right]);

// A swipe must do nothing: the columns are paged from the header, so the board never has to
// tell a sideways gesture apart from a drag.
const swipe = await ev(`(() => {
  const b = document.querySelector('.kb');
  const before = b.style.getPropertyValue('--col');
  const t = x => new Touch({ identifier: 1, target: b, clientX: x, clientY: 300 });
  b.dispatchEvent(new TouchEvent('touchstart',
    { bubbles: true, touches: [t(300)], changedTouches: [t(300)] }));
  b.dispatchEvent(new TouchEvent('touchend',
    { bubbles: true, touches: [], changedTouches: [t(80)] }));
  return { before, after: document.querySelector('.kb').style.getPropertyValue('--col') };
})()`);
eq('a swipe moves nothing', swipe.after, swipe.before);

await page('Next');
await sleep(400);
const atDone = await ev(shown);
eq('and the last column too', [atDone.count, atDone.stage], [1, 'done']);
eq('also in the same place', [atDone.left, atDone.right], [atTodo.left, atTodo.right]);
eq('the pager is disabled at done', await ev(`[...document.querySelectorAll('.knav')]
  .filter(b => b.getAttribute('aria-label') === 'Next column')[0].disabled`), true);

await ev(`document.querySelector('.khead .kadd').click()`);
await sleep(450);
eq('a column + opens a new task in that stage', await ev(`(() => {
  if (document.querySelector('#popup').hidden) return 'no popup';
  const l = [...document.querySelectorAll('#f-rows .flags .ib')].map(b => b.getAttribute('aria-label'));
  return l.find(x => /^Stage/.test(x)) || 'no stage';
})()`), 'Stage: todo');
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(250);

ok('a phone card keeps its move arrows',
  await ev(`document.querySelectorAll('.kcard [aria-label$="stage"]').length`) > 0,
  'no arrows on a phone card');

// What a card holds, and what it no longer holds. The button count is what keeps the removed
// controls removed: every one of them was a chip once, and a chip is easy to put back.
const card = await ev(`(() => {
  const c = document.querySelector('.kcard');
  return { chips: c.querySelectorAll('.chip').length,
    controls: c.querySelectorAll('[aria-label^="Edit"], [aria-label^="Delete"], [aria-label^="Skip"]').length,
    buttons: c.querySelectorAll('button').length,
    bangs: document.querySelectorAll('.kcard .kbang').length,
    pressableBang: document.querySelectorAll('.kcard button .kbang, .kcard .kbang button').length,
    text: c.textContent };
})()`);
eq('a card carries no chip', card.chips, 0);
eq('no pen and no trashcan', card.controls, 0);
eq('and on a phone two buttons, the stage arrows', card.buttons, 2);
ok('no estimate and no sprint number on it', !/\bS\d|\b\d+d\b/.test(card.text), card.text);
ok('an important task carries a !', card.bangs > 0, 'no ! on any card');
eq('and the ! is not a button', card.pressableBang, 0);

// The board's click delegation used to match the card from inside one of its own buttons, so a
// move opened the ticket on top of itself. A handler that stops at the button but still lets
// the event bubble must turn this red.
const todoBefore = await ev(`document.querySelectorAll('.kcol[data-stage="todo"] .kcard').length`);
await ev(`document.querySelector('.kcol[data-stage="todo"] .kcard [aria-label="Next stage"]').click()`);
await sleep(1100);
const afterMove = await ev(`({
  popup: !document.querySelector('#popup').hidden,
  todo: document.querySelectorAll('.kcol[data-stage="todo"] .kcard').length })`);
eq('the arrow moves the card out of todo', afterMove.todo, todoBefore - 1);
eq('and does not open the ticket', afterMove.popup, false);

await ev(`document.querySelector('.kcard .ktitle').click()`);
await sleep(500);
eq('clicking the card itself does open it',
  await ev(`!document.querySelector('#popup').hidden`), true);
eq('with no input in it until a row is clicked', await ev(
  `document.querySelectorAll('#popup input, #popup textarea').length`), 0);
await closeForm();

// Stacked, all three stages are on screen, so no header carries an arrow - at either width -
// and the cards keep their own `<` `>` on a phone, there being nothing to drag onto.
const orient = async name => {
  await ev(`document.querySelector('#zoom-btn').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#zoom-body .zrow')]
    .find(b => b.textContent.trim() === '${name}').click()`);
  await sleep(450);
};
await orient('vertical');
const stacked = await ev(`(() => {
  const cols = [...document.querySelectorAll('.kcol')].map(c => c.getBoundingClientRect());
  const board = document.querySelector('.kb').getBoundingClientRect();
  return { cols: cols.length,
    stacked: cols.every((r, i) => i === 0 || r.top >= cols[i - 1].bottom - 1),
    full: cols.every(r => Math.round(board.width - r.width) <= 24),
    pagers: document.querySelectorAll('.khead .knav').length,
    adds: document.querySelectorAll('.khead .kadd').length,
    cardArrows: document.querySelectorAll('.kcard [aria-label$="stage"]').length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()`);
eq('stacked, all three stages are on screen', stacked.cols, 3);
ok('one under the other', stacked.stacked, 'the stages are not stacked');
ok('each as wide as the board', stacked.full, 'a stacked stage is not full width');
eq('with no pager in any header', stacked.pagers, 0);
eq('and each header keeping its +', stacked.adds, 3);
ok('a phone card keeps its own arrows', stacked.cardArrows > 0, 'no card arrows when stacked');
eq('and the board does not extend sideways at 320px', stacked.over, 0);

await orient('horizontal');
eq('switching back restores the one-column strip',
  await ev(`document.querySelector('#view').className.includes('one')`), true);
ok('and its pager', await ev(`document.querySelectorAll('.khead .knav').length`) > 0,
  'the pager did not come back');

// On a desktop the card is dragged between the columns, so neither the card nor the header
// carries arrows: every column is already on screen, in both orientations.
await viewport(900);
await open('K');
eq('a desktop header has no pager', await ev(`document.querySelectorAll('.khead .knav').length`), 0);
eq('and a desktop card has no move arrows',
  await ev(`document.querySelectorAll('.kcard [aria-label$="stage"]').length`), 0);
await orient('vertical');
eq('nor stacked on a desktop', await ev(
  `document.querySelectorAll('.khead .knav, .kcard [aria-label$="stage"]').length`), 0);
const capped = await ev(`(() => {
  const b = document.querySelector('.kb').getBoundingClientRect();
  const pane = document.querySelector('.topbar').getBoundingClientRect();
  return { board: Math.round(b.width), pane: Math.round(pane.width),
           left: Math.round(b.left), right: Math.round(pane.right - b.right) };
})()`);
ok('a stacked board is capped and centred too', capped.board <= 78 * 16 + 2 &&
  Math.abs(capped.left - capped.right) <= 2, JSON.stringify(capped));
await orient('horizontal');

// ---- 7. what a saved task actually writes ------------------------------------------------------

await viewport(900);

const saveTask = async (title, clearEstimate, important) => {
  await open();
  await newEntry();
  await click(0);
  await sleep(250);
  if (clearEstimate) {
    await flag(3);
    await sleep(300);
    // The estimate's trashcan is in its popup's head, its row being an icon with no room beside it.
    await ev(`document.querySelector('#fpop [aria-label^="Clear"]').click()`);
    await sleep(300);
  }
  if (important) { await flag(2); await sleep(250); }
  await openRow('title');
  await typeIn('title', title);
  await ev(`document.querySelector('#entry-form').requestSubmit()`);
  await sleep(1200);
  return ev(`(async () => {
    const all = await new Promise(r => {
      const q = indexedDB.open('mine', 1);
      q.onsuccess = () => {
        const t = q.result.transaction('files', 'readonly').objectStore('files').getAll();
        t.onsuccess = () => r(t.result);
      };
    });
    const f = all.find(f => (f.text || '').includes(${JSON.stringify(title)}));
    return f ? f.text : 'not written';
  })()`);
};

const withEstimate = await saveTask('Check the defaults', false);
ok('a saved task is todo', /\nstage: todo\n/.test(withEstimate), withEstimate.split('---')[1]);
ok('and carries one day', /\nestimate: 1\n/.test(withEstimate), withEstimate.split('---')[1]);
const without = await saveTask('Check a cleared estimate', true);
ok('a cleared estimate writes no key', !/estimate:/.test(without), without.split('---')[1]);

// Importance has the same shape of rule as the estimate: only `true` is ever written, and an
// ordinary task carries no key at all rather than `important: false`.
ok('an ordinary task writes no important key', !/important:/.test(withEstimate),
  withEstimate.split('---')[1]);
const marked = await saveTask('Check an important task', false, true);
ok('an important task writes important: true', /\nimportant: true\n/.test(marked),
  marked.split('---')[1]);
// `important: true` in a file reaches the toggle row lit. Read through the popup rather than
// off a card, so the check does not depend on which sprint today happens to fall in.
await viewport(900);
await open();
const importantIn = async title => {
  await ev(`[...document.querySelectorAll('.eline')]
    .find(l => l.textContent.includes(${JSON.stringify(title)})).click()`);
  await sleep(500);
  const g = (await ev(FLAGS))[2] || '';
  await closeForm();
  return g.includes('@');
};
eq('important: true in a file reads as important',
  await importantIn('Review the open pull requests'), true);
eq('and a task without the key does not', await importantIn('Deploy the release'), false);

// ---- 8. the shared renderer, and discarding an edit ---------------------------------------------

// The renderer builds nodes and never markup, so a body carrying a script tag shows that tag as
// text and adds nothing to the document. That is the check that keeps it so.
await viewport(900);
await open();
await newEntry();
await openRow('body');
const BODY = ['## Agenda', '- rollout dates', '- [x] token scope', '- [ ] dns cutover',
  '**blocker** here and `code`', '[spec](https://example.com/spec)',
  '[bad](javascript:alert(1))', '<script>alert(1)</script>'].join('\n');
eq('the body opens a textarea in its own row', await ev(
  `!!document.querySelector('#f-rows [data-field="body"] textarea')`), true);
await typeIn('body', BODY);
await openRow('title');
await typeIn('title', 'Rendered body');
await ev(`document.querySelector('#entry-form').requestSubmit()`);
await sleep(1400);

// Found by title rather than by position: it is the fixture's newest entry, not its first.
await ev(`[...document.querySelectorAll('.eline')]
  .find(l => l.textContent.includes('Rendered body')).click()`);
await sleep(500);
const md = await ev(`(() => {
  const b = document.querySelector('#f-rows .vbody');
  const boxes = [...b.querySelectorAll('input[type=checkbox]')];
  return { heads: [...b.querySelectorAll('.md-h')].map(h => h.textContent),
    items: b.querySelectorAll('li').length,
    boxes: boxes.map(i => i.checked), pressable: boxes.filter(i => !i.disabled).length,
    strong: [...b.querySelectorAll('strong')].map(n => n.textContent),
    code: [...b.querySelectorAll('code')].map(n => n.textContent),
    links: [...b.querySelectorAll('a')].map(a => a.getAttribute('href')),
    scripts: b.querySelectorAll('script').length,
    text: b.textContent };
})()`);
eq('a body renders its heading', md.heads, ['Agenda']);
ok('and its list items', md.items >= 3, `${md.items} items`);
eq('a checklist renders ticked and unticked', md.boxes, [true, false]);
eq('and neither box is pressable', md.pressable, 0);
eq('bold renders bold', md.strong, ['blocker']);
eq('and inline code renders code', md.code, ['code']);
eq('a safe link becomes one, and a javascript: URL does not', md.links,
  ['https://example.com/spec']);
ok('the unsafe one stays text', md.text.includes('javascript:alert(1)'), md.text);
eq('and no script element is added', md.scripts, 0);
ok('a script tag shows as text', md.text.includes('<script>alert(1)</script>'), md.text);
// Shown in full and rendered when the row is closed, which is the one thing the old preview
// existed for: a clipped line here is the body flattened into a row like the other five.
ok('and the whole body is shown, not a clipped line',
  md.text.includes('dns cutover') && md.text.includes('spec'), md.text);
await closeForm();

// A repeating entry's scope pair rebuilds the draft from the other file, which must rebuild the
// baseline a discard is measured against too: switching scope and leaving changed nothing, so
// nothing may be asked. This is the check for a baseline left behind as undefined, which reads
// as dirty for the rest of the popup's life.
await open();
await ev(`[...document.querySelectorAll('.eline')]
  .find(l => /water the plants/i.test(l.textContent)).click()`);
await sleep(500);
// The popup says it repeats, carries the skip, and carries the scope pair - which the read-only
// preview deliberately did not, so this check comes out the other way round now.
const rep = await ev(`({
  note: /repeating/i.test(document.querySelector('#f-rows').textContent),
  skip: [...document.querySelectorAll('#f-rows button')]
    .filter(b => /skip this one/i.test(b.textContent)).length,
  scope: document.querySelectorAll('#f-rows .seg').length,
  above: document.querySelector('#f-rows .scope')
    .compareDocumentPosition(document.querySelector('#f-rows [data-field="when"]')) & 4
      ? 'after' : 'before' })`);
eq('a repeating entry says so', rep.note, true);
eq('and carries the skip', rep.skip, 1);
eq('and the scope pair', rep.scope, 2);
eq('which sits above the rows it governs', rep.above, 'after');
// Switching scope rebuilds the draft from the other file, so it has to retake the baseline too:
// a baseline left behind puts a disk in an untouched popup and makes every way out ask about
// changes nobody made.
await ev(`[...document.querySelectorAll('#f-rows .seg')]
  .find(b => /whole series/i.test(b.textContent)).click()`);
await sleep(400);
eq('switching scope alone leaves no disk showing', await hasDisk(), false);
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('and asks nothing', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

// Leaving a popup that holds unsaved changes asks first - and only then. The x, the backdrop and
// Escape are one way out and ask one question.
await open();
await newEntry();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(300);
eq('an untouched popup closes with no prompt', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

const dirty = async () => {
  await open();
  await newEntry();
  await typeIn('title', 'Half written');
};
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('a changed one asks before discarding', await ev(
  `!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(300);
eq('keep editing leaves the popup open', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
eq('with the change still in it', await ev(
  `document.querySelector('#f-rows [data-field="title"] input').value`), 'Half written');

// The backdrop and Escape take the same way out, so they ask the same question.
await ev(`document.querySelector('#popup').click()`);
await sleep(350);
eq('the backdrop asks too', await ev(`!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(250);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(350);
eq('and so does Escape', await ev(`!document.querySelector('#ask').hidden`), true);

// Ticking it silences the prompt on this device, and the settings panel's row is what puts it
// back - nothing in Mine may be switched off from a place that cannot switch it back on.
await ev(`document.querySelector('#ask-never').click()`);
await sleep(100);
await ev(`document.querySelector('#ask-discard').click()`);
await sleep(400);
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('don\'t ask again stops the prompt', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

await menu('settings');
eq('and the panel has a row to put it back', await ev(`(() => {
  const r = [...document.querySelectorAll('#settings-body .srow')]
    .find(r => /confirm discard/i.test(r.querySelector('.slab').textContent));
  return r ? r.querySelector('input[type=checkbox]').checked : 'no row';
})()`), false);
await ev(`[...document.querySelectorAll('#settings-body .srow')]
  .find(r => /confirm discard/i.test(r.querySelector('.slab').textContent))
  .querySelector('input[type=checkbox]').click()`);
await sleep(500);
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('and turning it back on restores it', await ev(
  `!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-discard').click()`);
await sleep(300);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
ws.close();
process.exit(failures ? 1 : 0);
