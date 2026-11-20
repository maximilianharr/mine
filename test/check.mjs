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

// The app opens on the month view. The zoom pair walks year, month, week, day; the board has
// a slot of its own, which is also the way back to the month view.
const ZOOM = ['Y', 'M', 'W', 'D'];
const open = async (mode = 'M') => {
  await send('Page.navigate', { url: `${ORIGIN}/calendar/` });
  await sleep(1500);
  if (mode === 'K') {
    await ev(`document.querySelector('#board').click()`);
    await sleep(500);
    return;
  }
  const steps = ZOOM.indexOf(mode) - ZOOM.indexOf('M');
  for (let i = 0; i < Math.abs(steps); i++) {
    await ev(`document.querySelector('${steps > 0 ? '#zoom-in' : '#zoom-out'}').click()`);
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

// Each row as label plus background, and - on the all-day row - the badge that carries the
// value, which is the whole of what the two rows promise.
const row = sel => `[...document.querySelectorAll('${sel} .ib')].map(b => {
  const cs = getComputedStyle(b), d = b.querySelector('.badge');
  return (b.getAttribute('aria-label') || '?').split(':')[0] +
    (d ? '[' + (d.textContent || getComputedStyle(d).backgroundColor) + ']' : '') +
    (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : '@' + cs.backgroundColor);
})`;
const ROW = row('#f-icons'), FLAGS = row('#f-flags');
const glyphs = `document.querySelectorAll('#f-icons .glyph, #f-flags .glyph').length`;
const click = n => ev(`document.querySelectorAll('#f-icons .ib')[${n}].click()`);
const flag = n => ev(`document.querySelectorAll('#f-flags .ib')[${n}].click()`);
const label = g => g.split('@')[0].split('[')[0];
const badge = g => (g.match(/\[(.*)\]/) || [, ''])[1];

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

// ---- 2. the entry popup's icon row ------------------------------------------------------------

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
eq('the field icons are in order', asEvent.slice(2, 8).map(label),
  ['Details', 'Category', 'Repeat', 'Alerts', 'Location', 'Participants']);
eq('no letter anywhere in either row', await ev(glyphs), 0);
eq('a new entry is an event', (await ev(FLAGS)).map(label), ['All-day']);
ok('save is green', asEvent.at(-1).endsWith('@' + GOOD), asEvent.at(-1));

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
  ['All-day', 'Stage', 'Priority', 'Estimate']);
eq('the field icons do not reshuffle', (await ev(ROW)).slice(2, 8).map(label),
  asEvent.slice(2, 8).map(label));
eq('a new estimate is one day', badge(asTask[3]), '1d');
ok('a new task starts at todo', !!badge(asTask[1]), 'the stage badge carries its colour');

const stages = [];
for (let i = 0; i < 3; i++) { await flag(1); await sleep(180); stages.push(badge((await ev(FLAGS))[1])); }
ok('stage cycles through three colours', new Set(stages).size === 3, stages.join(' '));
ok('and returns to where it started', stages[2] === badge(asTask[1]), `${stages[2]} vs ${badge(asTask[1])}`);

const prios = [];
for (let i = 0; i < 4; i++) { await flag(2); await sleep(180); prios.push((await ev(FLAGS))[2]); }
eq('priority cycles 1, 2, 3, none', prios.map(badge), ['1', '2', '3', '']);
ok('each priority has its own colour', new Set(prios.slice(0, 3).map(g => g.split('@')[0])).size === 3,
  prios.join(' '));

await flag(3);                                   // the estimate opens a popup
await sleep(300);
const sub = await ev(`({
  open: !document.querySelector('#sub').hidden,
  title: document.querySelector('#sub-title').textContent,
  value: document.querySelector('#sub-body input').value,
  clear: getComputedStyle(document.querySelector('#sub-clear')).color,
  save: getComputedStyle(document.querySelector('#sub-ok')).backgroundColor
})`);
ok('E opens the estimate popup', sub.open && sub.title === 'Estimate', JSON.stringify(sub.title));
eq('prefilled with one day', sub.value, '1');
eq('its trashcan is red', sub.clear, BAD);
eq('its disk is green', sub.save, GOOD);

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
eq('a detail row clears in red', await ev(
  `getComputedStyle(document.querySelector('#f-rows .ib:last-child')).color`), BAD);
await ev(`document.querySelector('#popup [aria-label="Close and discard"]').click()`);
await sleep(250);

await open('K');
eq('a kanban card deletes in red', await ev(
  `getComputedStyle(document.querySelector('.kcard .ib')).color`), BAD);
await shoot('view-K');

await open();
await ev(`document.querySelector('#gear').click()`);
await sleep(500);
eq('settings deletes a group in red', await ev(
  `getComputedStyle([...document.querySelectorAll('#settings-body .ib')]
     .find(b => /^Delete/.test(b.getAttribute('aria-label')))).color`), BAD);
await ev(`document.querySelector('#settings-body .grow .ib').click()`);
await sleep(400);
eq('settings saves a group in green', await ev(
  `getComputedStyle([...document.querySelectorAll('#settings-body .ib')]
     .find(b => /^Save/.test(b.getAttribute('aria-label')))).backgroundColor`), GOOD);

// ---- 4. the top pane ---------------------------------------------------------------------------

await viewport(900);
await open();
eq('the pane dropped Today, + and D W M Y K',
  await ev(`document.querySelectorAll('#today, #add, [data-mode]').length`), 0);
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

await open('Y');
eq('zoom out stops at the year', await ev(`document.querySelector('#zoom-out').disabled`), true);
await open('D');
eq('zoom in stops at the day', await ev(`document.querySelector('#zoom-in').disabled`), true);

await open();
await ev(`document.querySelector('#board').click()`);
await sleep(500);
eq('the board icon reaches the kanban', await ev(`!!document.querySelector('.kb')`), true);
eq('and the zoom pair is not shown there', await ev(`document.querySelector('#zoom-in').hidden`), true);
await ev(`document.querySelector('#board').click()`);
await sleep(500);
eq('and the calendar icon returns to the month', await ev(`!!document.querySelector('.grid')`), true);

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

// ---- 7. what a saved task actually writes ------------------------------------------------------

await viewport(900);

const save = async (title, clearEstimate) => {
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

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
ws.close();
process.exit(failures ? 1 : 0);
