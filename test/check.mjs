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

const open = async (mode = 'M') => {
  await send('Page.navigate', { url: `${ORIGIN}/calendar/` });
  await sleep(1500);
  if (mode !== 'M') {
    await ev(`document.querySelector('[data-mode="${mode}"]').click()`);
    await sleep(500);
  }
};

const shoot = async name => {
  if (!SHOT) return;
  const s = await send('Page.captureScreenshot', { format: 'png' });
  (await import('fs')).writeFileSync(`${SHOT}/${name}.png`, Buffer.from(s.data, 'base64'));
};

// The icon row as glyph plus background, which is the whole of what the row promises.
const ROW = `[...document.querySelectorAll('#f-icons .ib')].map(b => {
  const g = b.querySelector('.glyph'), cs = getComputedStyle(b);
  return (g ? g.textContent : (b.getAttribute('aria-label') || '?')) +
    (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : '@' + cs.backgroundColor);
})`;
const click = n => ev(`document.querySelectorAll('#f-icons .ib')[${n}].click()`);

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

await viewport(390);
await open();
const good = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--good').trim()`);
const bad = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--bad').trim()`);
const rgb = async hex => ev(`(() => { const d = document.createElement('div');
  d.style.color = '${hex}'; document.body.append(d);
  const c = getComputedStyle(d).color; d.remove(); return c; })()`);
const GOOD = await rgb(good), BAD = await rgb(bad);

await ev(`document.querySelector('#add').click()`);
await sleep(350);
const asEvent = await ev(ROW);
ok('a new entry is an event', !asEvent.some(g => /^S@|^P$|^1d$/.test(g)),
  'stage, priority and estimate must not be on an event');
ok('save is green', asEvent.at(-1).endsWith('@' + GOOD), asEvent.at(-1));

await click(0);                                  // T: make it a task
await sleep(250);
const asTask = await ev(ROW);
eq('task row carries S, P and E', asTask.slice(2, 5).map(g => g.split('@')[0]), ['S', 'P', '1d']);
ok('a new task starts at todo', asTask[2].includes('@'), 'the S button carries its stage colour');

const stages = [];
for (let i = 0; i < 3; i++) { await click(2); await sleep(180); stages.push((await ev(ROW))[2]); }
ok('S cycles through three stages', new Set(stages).size === 3, stages.join(' '));
ok('S returns to where it started', stages[2] === asTask[2], `${stages[2]} vs ${asTask[2]}`);

const prios = [];
for (let i = 0; i < 4; i++) { await click(3); await sleep(180); prios.push((await ev(ROW))[3]); }
eq('P cycles 1, 2, 3, none', prios.map(g => g.split('@')[0]), ['1', '2', '3', 'P']);
ok('each priority has its own colour', new Set(prios.slice(0, 3)).size === 3, prios.join(' '));

await click(4);                                  // E: the one that opens a popup
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
eq('the estimate shows its days', (await ev(ROW))[4].split('@')[0], '3d');
await click(4);
await sleep(250);
await ev(`document.querySelector('#sub-clear').click()`);
await sleep(300);
eq('a cleared estimate shows its letter', (await ev(ROW))[4].split('@')[0], 'E');

await shoot('popup-task');
await click(1);                                  // back to an event
await sleep(250);
eq('an event drops all three', (await ev(ROW)).slice(2, 5).map(g => g.split('@')[0]),
  ['Repeat', 'Category', 'Location']);

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

// ---- 4. what a saved task actually writes ------------------------------------------------------

const save = async (title, clearEstimate) => {
  await open();
  await ev(`document.querySelector('#add').click()`);
  await sleep(350);
  await click(0);
  await sleep(250);
  if (clearEstimate) {
    await click(4);
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
