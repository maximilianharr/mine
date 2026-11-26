import { APPS } from './shared/apps.js';
import { getConfig, setConfig, persist } from './shared/store.js';
import { THEMES, DATE_FORMATS, loadPrefs, setPref, applyTheme } from './shared/prefs.js';
import { testConnection } from './shared/github.js';
import { createSync } from './shared/sync.js';
import { el, row, choose } from './shared/ui.js';

const $ = s => document.querySelector(s);
const show = id => document.querySelectorAll('section').forEach(s => s.hidden = s.id !== id);

// The same sequence every screen in Mine runs, and for the same reason: the queue is shared, so
// whichever screen is open is the one that has to push what the other one left behind. This
// screen has no model to reload and no logs panel to send you to, so it takes neither.
const sync = createSync({ line: $('#status') });

// ---- setup ----

$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const msg = $('#setup-msg');
  const cfg = Object.fromEntries(new FormData(e.target));
  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Checking…';
  try {
    const info = await testConnection(cfg);
    await setConfig(cfg);
    await persist();
    msg.textContent = info.private ? '' : 'Note: that repo is public.';
    await home();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg bad';
  } finally {
    btn.disabled = false;
  }
});

// ---- home ----

async function home() {
  const cfg = await getConfig();

  $('#tiles').replaceChildren(...APPS.map(a => {
    const link = document.createElement('a');
    link.className = 'tile';
    link.href = `./${a.slug}/`;
    const img = document.createElement('img');
    img.src = `./${a.slug}/icon.svg`;
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = a.label;
    link.append(img, name);
    return link;
  }));

  const days = cfg.expiresAt ? Math.ceil((new Date(cfg.expiresAt) - Date.now()) / 86400000) : null;
  const expiry = $('#expiry');
  expiry.hidden = days === null || days > 14;
  if (!expiry.hidden) {
    expiry.textContent = days <= 0
      ? 'Your token has expired. Replace it in settings.'
      : `Your token expires in ${days} day(s). Replace it in settings.`;
  }

  show('home');
  await sync.refresh();
}

addEventListener('focus', () => { if (!$('#home').hidden) sync.refresh(); });

// ---- settings ----

$('#to-settings').addEventListener('click', async () => {
  const cfg = await getConfig();
  $('#settings-info').replaceChildren(...Object.entries({
    Repo: `${cfg.owner}/${cfg.repo}`,
    Branch: cfg.branch,
    Token: `on this device only${cfg.expiresAt ? `, expires ${cfg.expiresAt}` : ''}`
  }).flatMap(([k, v]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    return [dt, dd];
  }));
  await minePrefs();
  show('settings');
});

$('#to-home').addEventListener('click', home);

// Theme and date format belong to Mine rather than to any one app, so the same two rows appear
// here and in every app's settings.
async function minePrefs() {
  const prefs = await loadPrefs();
  const set = key => async v => {
    await setPref(key, v);
    if (key === 'theme') applyTheme(v);
  };
  $('#mine-prefs').replaceChildren(
    row('Theme', choose(THEMES.map(t => [t, t]), prefs.theme, set('theme'))),
    row('Date format', choose(DATE_FORMATS.map(f => [f, f]), prefs.dateFormat, set('dateFormat'))),
    el('p', 'note', 'Both apply to all of Mine. They follow the device until you choose otherwise.')
  );
}

$('#forget').addEventListener('click', () => {
  if (!confirm('Remove the repo settings and token from this device? Your data in GitHub is untouched.')) return;
  indexedDB.deleteDatabase('mine');
  location.reload();
});

// ---- service worker ----

// Ask a worker for its VERSION. An older worker that predates the version message answers
// nothing, and the timeout reports that as null.
function versionOf(worker) {
  return new Promise(resolve => {
    if (!worker) return resolve(null);
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data); };
    try { worker.postMessage('version', [ch.port2]); }
    catch { clearTimeout(timer); resolve(null); }
  });
}

// Skip-waiting, then reload once the new worker has taken over.
function takeOver(worker) {
  navigator.serviceWorker.addEventListener('controllerchange',
    () => location.reload(), { once: true });
  worker.postMessage('skip-waiting');
}

// The way to the newest version that does not depend on the banner being there. A plain reload
// would leave a waiting worker waiting, so look for one first and hand over to it.
$('#reload-app').addEventListener('click', async () => {
  const reg = await navigator.serviceWorker?.getRegistration();
  // Offline there is nothing to fetch, and the reload still happens.
  await reg?.update().catch(() => {});
  const w = reg?.installing;
  if (w) await new Promise(done => w.addEventListener('statechange', done, { once: true }));
  if (reg?.waiting) takeOver(reg.waiting);
  else location.reload();
});

function registerSW() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.register('./sw.js', { type: 'module', scope: './' }).then(reg => {
    // "A worker is waiting" is not the test: a byte-identical worker can wait, and the banner
    // would then show on an app with no update at all and never go away. Offer it only when the
    // version waiting to take over genuinely differs from the one running.
    const offer = async () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      const [waiting, active] = await Promise.all([versionOf(reg.waiting), versionOf(reg.active)]);
      if (waiting !== active) $('#update').hidden = false;
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
    });
    $('#reload').addEventListener('click', () => { if (reg.waiting) takeOver(reg.waiting); });
  }).catch(() => { /* an app that cannot cache still works online */ });
}

// ---- boot ----

registerSW();
applyTheme((await loadPrefs()).theme);
if (await getConfig()) await home(); else show('setup');
