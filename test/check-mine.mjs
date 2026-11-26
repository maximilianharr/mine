// The tile screen in a browser. Run through test/run.sh.
//
// It had no suite at all until the sync line moved into shared/sync.js, and that is exactly why
// it needs one: the sequence this screen runs is now the same code the calendar runs, so a
// change made for one app lands on the other, and the screen where nobody was looking is the one
// that would break quietly.
import {
  ok, eq, report, sleep, ev, viewport, goto, shoot, seed, kv, queueSize, seedQueue, wipe
} from './cdp.mjs';

// ---- 1. the setup gate ----------------------------------------------------------------------
// With nothing stored, the screen asks for the repo and the token and shows nothing else.

await viewport(390);
await goto('/');
await wipe();
await goto('/');

const setup = await ev(`(() => ({
  screen: [...document.querySelectorAll('section')].filter(s => !s.hidden).map(s => s.id),
  fields: [...document.querySelectorAll('#setup-form [name]')].map(i => i.name),
  token: document.querySelector('#setup-form [name=token]').type
}))()`);
eq('with nothing stored, the setup screen is the one shown', setup.screen, ['setup']);
eq('it asks for the repo and the token, and nothing else', setup.fields,
  ['owner', 'repo', 'branch', 'token', 'expiresAt']);
eq('and the token is never a readable field', setup.token, 'password');
await shoot('mine-setup');

// ---- 2. the tiles ---------------------------------------------------------------------------
// One tile per app in shared/apps.js, each linking into its folder. This is the check that
// catches an app added to the list without an icon or a folder to open.

await seed('mine');
await goto('/');

const tiles = await ev(`(() => ({
  screen: [...document.querySelectorAll('section')].filter(s => !s.hidden).map(s => s.id),
  tiles: [...document.querySelectorAll('.tile')].map(a => ({
    href: a.getAttribute('href'),
    name: a.querySelector('span').textContent,
    icon: a.querySelector('img').getAttribute('src'),
    drawn: a.querySelector('img').naturalWidth > 0
  })),
  over: document.documentElement.scrollWidth - document.documentElement.clientWidth
}))()`);
eq('once set up, the tiles are the screen', tiles.screen, ['home']);
ok('there is a tile per app', tiles.tiles.length >= 1, `${tiles.tiles.length} tiles`);
eq('each one opens its folder', tiles.tiles.map(t => t.href),
  tiles.tiles.map(t => `./${t.name}/`));
ok('and draws its own icon', tiles.tiles.every(t => t.drawn),
  JSON.stringify(tiles.tiles.map(t => [t.icon, t.drawn])));
eq('the screen fits a 390px phone', tiles.over, 0);
await shoot('mine-tiles');

// ---- 3. the update banner -------------------------------------------------------------------
// A class rule setting `display` beats the UA stylesheet's [hidden], so this banner rendered
// permanently until that rule moved into the shared base. REQUIREMENTS.md asks that reloading
// twice with no deploy in between leaves no banner, and this is the check that holds it to that.

eq('no update is offered when none is waiting',
  await ev(`document.querySelector('#update').hidden`), true);
eq('and the banner is not merely transparent',
  await ev(`getComputedStyle(document.querySelector('#update')).display`), 'none');

// ---- 4. the token expiry warning ------------------------------------------------------------

const expiry = async days => {
  await ev(`(async () => {
    const db = await new Promise(res => { const r = indexedDB.open('mine', 1); r.onsuccess = () => res(r.result); });
    const c = await new Promise(res => {
      const q = db.transaction('kv', 'readonly').objectStore('kv').get('config');
      q.onsuccess = () => res(q.result);
    });
    c.expiresAt = new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10);
    await new Promise(res => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(c, 'config');
      t.oncomplete = res;
    });
  })()`);
  await goto('/');
  return ev(`(() => { const b = document.querySelector('#expiry');
    return { hidden: b.hidden, text: b.textContent }; })()`);
};
eq('a token with months left says nothing', (await expiry(90)).hidden, true);
const soon = await expiry(9);
eq('one expiring inside a fortnight warns', soon.hidden, false);
ok('and says how long is left', /9 day\(s\)/.test(soon.text), soon.text);
const gone = await expiry(-1);
ok('an expired one says so outright', /has expired/.test(gone.text), gone.text);

// ---- 5. the sync line -----------------------------------------------------------------------
// The queue is shared with every app, so it drains from whichever screen is open. This screen
// used to run a shorter sequence of its own; it runs the same one as the calendar now, which is
// what makes a queue left behind by one app something the other will push.

await seed('mine');
await seedQueue(3, 'diary/2026/11/2026-11-24-');
await goto('/', 3500);

const line = await ev(`(() => { const s = document.querySelector('#status');
  return { text: s.textContent, bad: s.classList.contains('bad') }; })()`);
ok('opening with a queue retries it rather than reporting a count',
  /not pushed/.test(line.text), `the line reads "${line.text}"`);
ok('and reads as an error', line.bad);
eq('a failed push leaves the queue intact', await queueSize(), 3);

// The record behind the logs panel, written in shared/github.js on every drain and every pull.
const rec = await kv('sync.last');
eq('the attempt is recorded', [rec.op, rec.outcome], ['drain', 'failed']);
eq('and named for the screen that made it', rec.app, 'mine');
ok('with the reason kept, so it outlives this line', !!rec.detail, JSON.stringify(rec.detail));

// The same record from inside an app names that app. appName() reads the folder off the path and
// checks it against APPS, so this is also the check that it is not a literal for one app.
await goto('/calendar/', 3500);
eq('an attempt from an app is named for that app', (await kv('sync.last')).app, 'calendar');

// ---- 6. settings ----------------------------------------------------------------------------
// The two rows that belong to Mine rather than to any one app, and the one button that can
// forget the device.

await goto('/');
await ev(`document.querySelector('#to-settings').click()`);
await sleep(400);
const settings = await ev(`(() => ({
  screen: [...document.querySelectorAll('section')].filter(s => !s.hidden).map(s => s.id),
  info: [...document.querySelectorAll('#settings-info dt')].map(d => d.textContent),
  token: document.querySelector('#settings-info').textContent,
  prefs: [...document.querySelectorAll('#mine-prefs .prefrow')].map(r => ({
    label: r.querySelector('span').textContent,
    options: [...r.querySelectorAll('option')].map(o => o.value)
  })),
  over: document.documentElement.scrollWidth - document.documentElement.clientWidth
}))()`);
eq('the settings screen opens', settings.screen, ['settings']);
eq('it names the repo, the branch and the token', settings.info, ['Repo', 'Branch', 'Token']);
ok('and never shows the token itself',
  !settings.token.includes('not-a-real-token'), settings.token);
eq('the two Mine-wide settings are theme and date format',
  settings.prefs.map(p => p.label), ['Theme', 'Date format']);
eq('with the same options every app offers', settings.prefs.map(p => p.options),
  [['system', 'light', 'dark', 'coffee', 'neutral'], ['auto', 'dd.mm.yyyy', 'mm/dd/yy']]);
eq('the screen fits a 390px phone', settings.over, 0);
await shoot('mine-settings');

// A theme chosen here applies to every app, because it is written to a key they all read.
await ev(`(() => {
  const s = [...document.querySelectorAll('#mine-prefs select')][0];
  s.value = 'dark';
  s.dispatchEvent(new Event('change'));
})()`);
await sleep(300);
eq('a theme chosen here is written where every app reads it', await kv('mine.theme'), 'dark');
eq('and applies at once', await ev(`document.documentElement.dataset.theme`), 'dark');
await goto('/calendar/');
eq('including in an app opened afterwards',
  await ev(`document.documentElement.dataset.theme`), 'dark');

// A palette chosen rather than followed pins the phone's bar to its page as well.
await ev(`(async () => {
  const { applyTheme } = await import('/shared/prefs.js');
  applyTheme('neutral');
})()`);
eq('a pinned palette pins the bar to its page colour',
  await ev(`[...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content)`),
  ['#faf7f2', '#faf7f2']);
await ev(`(async () => (await import('/shared/prefs.js')).applyTheme('system'))()`);
eq('and system hands the bar back to the device',
  await ev(`[...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content)`),
  ['#EBE6D2', '#12161f']);

report('mine');
