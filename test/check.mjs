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

// The app opens on the month view. Clicking the period label walks the zoom year, month, week,
// day and round again; the board has a slot of its own, which is also the way back to the month
// view.
const ZOOM = ['Y', 'M', 'W', 'D'];
const open = async (mode = 'M') => {
  await send('Page.navigate', { url: `${ORIGIN}/calendar/` });
  await sleep(1500);
  if (mode === 'K') {
    await ev(`document.querySelector('#board').click()`);
    await sleep(500);
    return;
  }
  const steps = (ZOOM.indexOf(mode) - ZOOM.indexOf('M') + ZOOM.length) % ZOOM.length;
  for (let i = 0; i < steps; i++) {
    await ev(`document.querySelector('#period').click()`);
    await sleep(250);
  }
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
const ROW = row('#f-icons'), FLAGS = row('#f-flags');
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
const click = n => ev(`document.querySelectorAll('#f-icons .ib')[${n}].click()`);
const flag = n => ev(`document.querySelectorAll('#f-flags .ib')[${n}].click()`);
const label = g => g.split('@')[0].split('[')[0];
const badge = g => (g.match(/\[(.*)\]/) || [, ''])[1];

// A field row: its name, the value it shows once set, whether it carries a button of its own,
// and its background - a set row has to stay plain, because position and value are what say it
// is set.
const ROWS = `[...document.querySelectorAll('#f-rows .frow')].map(r => ({
  label: r.querySelector('.flab').textContent,
  value: r.querySelector('.fval') ? r.querySelector('.fval').textContent : '',
  buttons: r.querySelectorAll('button, .ib').length,
  bg: getComputedStyle(r).backgroundColor
}))`;
const openRow = name => ev(`[...document.querySelectorAll('#f-rows .frow')]
  .find(r => r.querySelector('.flab').textContent === '${name}').click()`);
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

// ---- 2. the entry popup's icon row, toggle row and field rows --------------------------------

await viewport(900);
await open();
const good = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--good').trim()`);
const bad = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--bad').trim()`);
const rgb = async hex => ev(`(() => { const d = document.createElement('div');
  d.style.color = '${hex}'; document.body.append(d);
  const c = getComputedStyle(d).color; d.remove(); return c; })()`);
const GOOD = await rgb(good), BAD = await rgb(bad);

await newEntry();
const asEvent = await ev(ROW);
eq('the icon row holds the type pair and the right-aligned group', asEvent.map(label),
  ['Task', 'Event', 'Save', 'Close and discard']);
eq('the x is its rightmost control', (await rightmost('#f-icons')).slice(-1),
  ['Close and discard']);
eq('no letter anywhere in the icon row', await ev(glyphs), 0);
eq('and no dash is left in it', await ev(`document.querySelectorAll('#f-icons .vdash').length`), 0);
eq('a new entry is an event', (await ev(FLAGS)).map(label), ['All-day']);
eq('and its toggle row says 24h, not a sun', await ev(words('#f-flags')), ['24h']);

// A save is a green disk, not a filled green button: the background is the half of this that
// catches a regression to the old style.
const disk = await ev(`(() => {
  const b = [...document.querySelectorAll('#f-icons .ib')]
    .find(x => /^Save/.test(x.getAttribute('aria-label')));
  const cs = getComputedStyle(b);
  return { color: cs.color, bg: cs.backgroundColor };
})()`);
eq('the save disk is a green glyph', disk.color, GOOD);
eq('and carries no background', disk.bg, 'rgba(0, 0, 0, 0)');

// The toggle row sits below the dates now. Read from the document order, because a row that
// merely looks right can still be the old one.
eq('the toggle row is below the end date', await ev(
  `(document.querySelector('#f-flags').compareDocumentPosition(
      document.querySelector('#f-end-date')) & Node.DOCUMENT_POSITION_PRECEDING) ? 'below' : 'above'`),
  'below');

// Every field has a row, set or not, and the canonical order is the order they read in.
const rows0 = await ev(ROWS);
eq('every field has a row, in canonical order', rows0.map(r => r.label),
  ['Details', 'Category', 'Repeat', 'Alerts', 'Location', 'Participants']);
eq('none of them is set yet', rows0.map(r => r.value).join(''), '');
eq('a row carries no pen and no trashcan', rows0.reduce((n, r) => n + r.buttons, 0), 0);

await openRow('Location');
await sleep(300);
await ev(`document.querySelector('#sub-body input').value = 'Conference room 3B';
          document.querySelector('#sub-ok').click()`);
await sleep(350);
const rows1 = await ev(ROWS);
eq('a set row moves to the top', rows1[0].label, 'Location');
eq('and shows its value', rows1[0].value, 'Conference room 3B');
eq('and stays plain', rows1[0].bg, 'rgba(0, 0, 0, 0)');
eq('the unset rows keep their order', rows1.slice(1).map(r => r.label),
  ['Details', 'Category', 'Repeat', 'Alerts', 'Participants']);

await flag(0);                                   // all-day on
await sleep(220);
const allday = (await ev(FLAGS))[0];
ok('all-day lights when on', allday.includes('@'), allday);
ok('and not in green', !allday.endsWith('@' + GOOD), `${allday} must not be the save's green`);
await flag(0);
await sleep(220);

await click(0);                                  // make it a task
await sleep(250);
const asTask = await ev(FLAGS);
eq('a task row carries the three', asTask.map(label),
  ['All-day', 'Stage', 'Important', 'Estimate']);
eq('and reads 24h and !', await ev(words('#f-flags')), ['24h', '!']);
eq('the field rows do not reshuffle', (await ev(ROWS)).map(r => r.label),
  rows1.map(r => r.label));
eq('a new estimate is one day', badge(asTask[3]), '1d');
ok('a new task starts at todo', !!badge(asTask[1]), 'the stage badge carries its colour');

const stages = [];
for (let i = 0; i < 3; i++) { await flag(1); await sleep(180); stages.push(badge((await ev(FLAGS))[1])); }
ok('stage cycles through three colours', new Set(stages).size === 3, stages.join(' '));
ok('and returns to where it started', stages[2] === badge(asTask[1]), `${stages[2]} vs ${badge(asTask[1])}`);

// Important is a toggle and not a cycle: two taps come back to where they started, there is no
// third state to reach, and it carries no badge, because a yes or no has nothing to put in one.
const bangs = [];
for (let i = 0; i < 2; i++) { await flag(2); await sleep(180); bangs.push((await ev(FLAGS))[2]); }
ok('important lights when on', bangs[0].includes('@'), bangs[0]);
ok('and not in green', !bangs[0].endsWith('@' + GOOD), `${bangs[0]} must not be the save's green`);
ok('two taps return it to plain', !bangs[1].includes('@'), bangs[1]);
eq('and it carries no badge either way', bangs.map(badge), ['', '']);

await flag(3);                                   // the estimate opens a popup
await sleep(300);
const sub = await ev(`({
  open: !document.querySelector('#sub').hidden,
  title: document.querySelector('#sub-title').textContent,
  value: document.querySelector('#sub-body input').value,
  clear: getComputedStyle(document.querySelector('#sub-clear')).color,
  save: getComputedStyle(document.querySelector('#sub-ok')).color,
  saveBg: getComputedStyle(document.querySelector('#sub-ok')).backgroundColor
})`);
ok('E opens the estimate popup', sub.open && sub.title === 'Estimate', JSON.stringify(sub.title));
eq('prefilled with one day', sub.value, '1');
eq('its trashcan is red', sub.clear, BAD);
eq('its disk is green', sub.save, GOOD);
eq('and a glyph, not a filled button', sub.saveBg, 'rgba(0, 0, 0, 0)');
eq('a field popup runs trashcan, save, x', await rightmost('#sub .pop-head'),
  ['Clear this field', 'Use this value', 'Abandon this edit']);

await ev(`document.querySelector('#sub-body input').value = '3';
          document.querySelector('#sub-ok').click()`);
await sleep(300);
eq('the estimate badges its days', badge((await ev(FLAGS))[3]), '3d');
await flag(3);
await sleep(250);
await ev(`document.querySelector('#sub-clear').click()`);
await sleep(300);
eq('a cleared estimate loses its badge', badge((await ev(FLAGS))[3]), '');

await shoot('popup-task');
await click(1);                                  // back to an event
await sleep(250);
eq('an event drops all three', (await ev(FLAGS)).map(label), ['All-day']);

// ---- 3. a trashcan is red wherever it appears --------------------------------------------------

await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
await sleep(250);
await ev(`document.querySelector('.eline').click()`);
await sleep(400);
eq('the delete trashcan is red', await ev(
  `getComputedStyle([...document.querySelectorAll('#f-icons .ib')]
     .find(b => /Delete/.test(b.getAttribute('aria-label')))).color`), BAD);
eq('a field row still carries no button', await ev(
  `document.querySelectorAll('#f-rows .ib').length`), 0);
await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
await sleep(250);

await open('K');
eq('a kanban card has no trashcan to colour', await ev(
  `document.querySelectorAll('.kcard .ib.bad').length`), 0);
await shoot('view-K');

// A group's pen, trashcan and disk live in the popup behind *edit groups* now - the one place
// in the calendar where a group is named or coloured, reached from settings in manage-only form.
await open();
await ev(`document.querySelector('#gear').click()`);
await sleep(500);
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

// ---- 4. the filter and the top pane ------------------------------------------------------------

// Groups are folded into a dropdown. Folding the list away must not have made the filter
// single-select, which is the whole risk in turning a list of checkboxes into one control.
await viewport(900);
await open();
await ev(`document.querySelector('#filter-btn').click()`);
await sleep(350);
const folded = await ev(`({
  drop: !!document.querySelector('#filter-body .gdrop'),
  shown: document.querySelectorAll('#filter-body .glab').length
})`);
ok('the filter holds a groups dropdown', folded.drop, 'no groups dropdown in the filter');
eq('and no checkbox until it is opened', folded.shown, 0);
await ev(`document.querySelector('#filter-body .gdrop').click()`);
await sleep(300);
const unfolded = await ev(`({
  shown: document.querySelectorAll('#filter-body .glab').length,
  swatches: document.querySelectorAll('#filter-body .glab .swatch').length
})`);
ok('opening it reveals a checkbox per group', unfolded.shown >= 3, `${unfolded.shown} checkboxes`);
eq('each showing its colour', unfolded.swatches, unfolded.shown);
await ev(`document.querySelectorAll('#filter-body .glab input')[0].click()`);
await sleep(500);
const ticks = await ev(`[...document.querySelectorAll('#filter-body .glab input')].map(i => i.checked)`);
eq('unticking one leaves the rest on', [ticks[0], ticks.slice(1).every(Boolean)], [false, true]);
await ev(`document.querySelectorAll('#filter-body .glab input')[0].click()`);
await sleep(500);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await open('K');
await ev(`document.querySelector('#filter-btn').click()`);
await sleep(350);
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

// The label walks the zoom and comes round again: nothing is disabled at an end, because one
// target cannot be the way on and be disabled at the same time.
await open();
const walk = [];
for (let i = 0; i < 4; i++) {
  await ev(`document.querySelector('#period').click()`);
  await sleep(300);
  walk.push((await ev(`document.querySelector('#view').className`)).replace('view v', ''));
}
eq('the label walks the zoom and round again', walk, ['W', 'D', 'Y', 'M']);
eq('and it does not open the picker', await ev(`document.querySelector('#picker').hidden`), true);

await ev(`document.querySelector('#caret').click()`);
await sleep(350);
eq('the caret opens the picker', await ev(`!document.querySelector('#picker').hidden`), true);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await open('K');
await ev(`document.querySelector('#period').click()`);
await sleep(350);
eq('on the board the label opens the sprint list', await ev(
  `!document.querySelector('#picker').hidden && !!document.querySelector('.pick-body.sprints')`), true);
eq('and does not zoom', await ev(`document.querySelector('#view').className.includes('vK')`), true);
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
  const on = ['#board', '#filter-btn', '#prev', '#period', '#caret', '#next', '#gear', '#home']
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
eq('the pane reads view, filter, period, settings, home', (await ev(pane)).order,
  ['#board', '#filter-btn', '#prev', '#period', '#caret', '#next', '#gear', '#home']);

await viewport(320);
await open();
const narrow = await ev(pane);
eq('on a phone the arrows are not there', narrow.order,
  ['#board', '#filter-btn', '#period', '#caret', '#gear', '#home']);
ok('and the pane stays on one line', narrow.spread <= 4, `${narrow.spread}px apart vertically`);

// The swipe lives on the label alone: the same gesture on the grid below it changes nothing.
// The label is read before the gesture: touchend steps the period synchronously, so reading it
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
const wasLabel = await swipeOn('#period');
await sleep(400);
ok('a swipe on the label steps the period', (await periodLabel()) !== wasLabel,
  `still ${wasLabel}`);
const held = await swipeOn('.grid');
await sleep(400);
eq('and the same swipe on the grid does not', await periodLabel(), held);

// A clipped label is worse than a smaller one: at twice the size, the five labels still have to
// fit the pane whole at 320 px, or the date - the one thing the pane is for - is unreadable.
for (const mode of ['M', 'W', 'D', 'Y', 'K']) {
  await open(mode);
  const cut = await ev(`(() => { const n = document.querySelector('#period-label');
    return Math.round(n.scrollWidth - n.clientWidth); })()`);
  ok(`the ${mode} label fits the phone pane`, cut <= 1, `clipped by ${cut}px`);
}

// The swipe above left another month on screen: the checks below want the fixture's own.
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
await ev(`document.querySelector('#gear').click()`);
await sleep(500);
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
eq('the panel holds eight rows', panel.rows, 8);
eq('with the short labels', panel.labels,
  ['Groups', 'Start week on', 'Time zone', 'Date format', 'Calendar weeks',
    'Sprint length', 'First sprint', 'Theme']);
ok('the controls line up in one column', panel.spread <= 1, `${panel.spread}px apart`);
eq('no group is listed in the panel itself', panel.groups, 0);
eq('and no paragraph explains what is stored where', panel.notes, 0);
eq('the last element is a row', panel.last, 'srow');
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(320);
await open();
await ev(`document.querySelector('#gear').click()`);
await sleep(500);
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
ok('the entry popup is centred', centred(await box('.card')), JSON.stringify(await box('.card')));
await openRow('Location');
await sleep(350);
ok("a field's popup is centred", centred(await box('#sub')), JSON.stringify(await box('#sub')));
await ev(`document.querySelector('#sub-cancel').click()`);
await sleep(250);
await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
await sleep(250);
await ev(`document.querySelector('#gear').click()`);
await sleep(500);
ok('the settings panel is centred', centred(await box('#settings-sheet')),
  JSON.stringify(await box('#settings-sheet')));
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(900);
await open('Y');
await ev(`document.querySelector('.yday:not(.out)').click()`);
await sleep(400);
eq('a year day still opens the day preview',
  await ev(`!document.querySelector('#day-pop').hidden`), true);
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
  const l = [...document.querySelectorAll('#f-flags .ib')].map(b => b.getAttribute('aria-label'));
  return l.find(x => /^Stage/.test(x)) || 'no stage';
})()`), 'Stage: todo');
await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
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
const afterMove = await ev(`({ popup: !document.querySelector('#popup').hidden,
  todo: document.querySelectorAll('.kcol[data-stage="todo"] .kcard').length })`);
eq('the arrow moves the card out of todo', afterMove.todo, todoBefore - 1);
eq('and does not open the ticket', afterMove.popup, false);

await ev(`document.querySelector('.kcard .ktitle').click()`);
await sleep(500);
eq('clicking the card itself does open it',
  await ev(`!document.querySelector('#popup').hidden`), true);
await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
await sleep(250);

// On a desktop the card is dragged between the columns, so neither the card nor the header
// carries arrows: every column is already on screen.
await viewport(900);
await open('K');
eq('a desktop header has no pager', await ev(`document.querySelectorAll('.khead .knav').length`), 0);
eq('and a desktop card has no move arrows',
  await ev(`document.querySelectorAll('.kcard [aria-label$="stage"]').length`), 0);

// ---- 7. what a saved task actually writes ------------------------------------------------------

await viewport(900);

const save = async (title, clearEstimate, important) => {
  await open();
  await newEntry();
  await click(0);
  await sleep(250);
  if (clearEstimate) {
    await flag(3);
    await sleep(300);
    await ev(`document.querySelector('#sub-clear').click()`);
    await sleep(300);
  }
  if (important) { await flag(2); await sleep(250); }
  await ev(`(() => { const t = document.querySelector('#f-title');
    t.value = ${JSON.stringify(title)};
    t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(150);
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

const withEstimate = await save('Check the defaults', false);
ok('a saved task is todo', /\nstage: todo\n/.test(withEstimate), withEstimate.split('---')[1]);
ok('and carries one day', /\nestimate: 1\n/.test(withEstimate), withEstimate.split('---')[1]);
const without = await save('Check a cleared estimate', true);
ok('a cleared estimate writes no key', !/estimate:/.test(without), without.split('---')[1]);

// Importance has the same shape of rule as the estimate: only `true` is ever written, and an
// ordinary task carries no key at all rather than `important: false`.
ok('an ordinary task writes no important key', !/important:/.test(withEstimate),
  withEstimate.split('---')[1]);
const marked = await save('Check an important task', false, true);
ok('an important task writes important: true', /\nimportant: true\n/.test(marked),
  marked.split('---')[1]);
ok('and never a priority', !/priority:/.test(marked), marked.split('---')[1]);

// The old key is read, not rejected: `priority: 1` is important and `2` to `9` are not. Read
// through the popup rather than off a card, so the check does not depend on which sprint today
// happens to fall in.
await viewport(900);
await open();
const importantIn = async title => {
  await ev(`[...document.querySelectorAll('.eline')]
    .find(l => l.textContent.includes(${JSON.stringify(title)})).click()`);
  await sleep(500);
  const g = (await ev(FLAGS))[2] || '';
  await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
  await sleep(250);
  return g.includes('@');
};
eq('priority: 1 reads as important', await importantIn('Deploy the release'), true);
eq('priority: 3 does not', await importantIn('Fix the bathroom tap'), false);
eq('and important: true does', await importantIn('Review the open pull requests'), true);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
ws.close();
process.exit(failures ? 1 : 0);
