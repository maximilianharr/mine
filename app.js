import { APPS } from './shared/apps.js';
import { getConfig, setConfig, persist, queuedCount } from './shared/store.js';
import { THEMES, DATE_FORMATS, loadPrefs, setPref, applyTheme } from './shared/prefs.js';
import { testConnection, pull, write, drain } from './shared/github.js';
import { serialize } from './shared/md.js';

const $ = s => document.querySelector(s);
const show = id => document.querySelectorAll('section').forEach(s => s.hidden = s.id !== id);
const status = (text, bad) => {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
};

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
  await refresh();
}

async function refresh() {
  const pending = await queuedCount();
  if (pending) return status(`${pending} change(s) pending`);
  status('checking…');
  try {
    const r = await pull();
    status(r.empty ? 'repo is empty'
      : r.unchanged ? 'in sync'
      : `in sync — ${r.changed} file(s) updated`);
  } catch (err) {
    status(err.message, true);
  }
}

addEventListener('focus', () => { if (!$('#home').hidden) refresh(); });

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
  $('#steps').replaceChildren();
  await minePrefs();
  show('settings');
});

$('#to-home').addEventListener('click', home);

// Theme and date format belong to Mine rather than to any one app, so the same two rows appear
// here and in every app's settings.
async function minePrefs() {
  const prefs = await loadPrefs();
  $('#mine-prefs').replaceChildren(
    prefRow('Theme', THEMES, prefs.theme, 'theme'),
    prefRow('Date format', DATE_FORMATS, prefs.dateFormat, 'dateFormat'),
    row('p', 'note', 'Both apply to all of Mine. They follow the device until you choose otherwise.')
  );
}

const row = (tag, cls, text) => {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
};

function prefRow(label, options, current, key) {
  const wrap = row('div', 'prefrow', '');
  const select = document.createElement('select');
  for (const v of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    o.selected = v === current;
    select.append(o);
  }
  select.addEventListener('change', async () => {
    await setPref(key, select.value);
    if (key === 'theme') applyTheme(select.value);
  });
  wrap.append(row('span', '', label), select);
  return wrap;
}

$('#forget').addEventListener('click', () => {
  if (!confirm('Remove the repo settings and token from this device? Your data in GitHub is untouched.')) return;
  indexedDB.deleteDatabase('mine');
  location.reload();
});

// Proves the architecture against the real repo: GraphQL read, atomic write, pull back.
$('#verify').addEventListener('click', async () => {
  const list = $('#steps');
  list.replaceChildren();
  const add = text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
    return li;
  };
  const run = async (text, fn) => {
    const li = add(`${text} …`);
    try {
      li.textContent = `${text} — ${await fn()}`;
      li.className = 'done';
    } catch (err) {
      li.textContent = `${text} — failed: ${err.message}`;
      li.className = 'bad';
      throw err;
    }
  };

  try {
    await run('Read repo', async () => {
      const i = await testConnection(await getConfig());
      return `${i.name}, ${i.private ? 'private' : 'PUBLIC'}`;
    });
    await run('Write README.md, one commit', async () => {
      await write('README.md', serialize(
        { title: 'Mine data', verified: new Date().toISOString() },
        'Markdown written by Mine. Safe to edit by hand.'));
      return `commit ${(await drain('Verify round-trip from Mine')).commit.slice(0, 7)}`;
    });
    await run('Pull it back', async () => `${(await pull()).changed} file(s) reconciled`);
    add('Round-trip complete').className = 'done';
  } catch {
    /* the failing step already says why */
  }
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
    $('#reload').addEventListener('click', () => {
      reg.waiting?.postMessage('skip-waiting');
      navigator.serviceWorker.addEventListener('controllerchange',
        () => location.reload(), { once: true });
    });
  }).catch(() => { /* an app that cannot cache still works online */ });
}

// ---- boot ----

registerSW();
applyTheme((await loadPrefs()).theme);
if (await getConfig()) await home(); else show('setup');
