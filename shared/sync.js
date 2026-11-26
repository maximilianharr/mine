// The sync line and the logs panel, for every app in Mine.
//
// Both apps had their own copy of the same sequence - drain the queue, then pull, and say on one
// line what happened - and only the calendar had the panel that explains it. The sequence is not
// either app's: the queue and the mirror are shared, so whichever screen is open is the one that
// has to push what the other one left behind.
//
// Two rules are built in here rather than left to each caller to remember:
//
//   * One attempt at a time, across every open tab and installed app. The queue and the mirror
//     live in one IndexedDB for the whole origin, so a chain in this page is not enough: a pull in
//     the calendar holding the tree from before the notes app's push deletes the note just pushed
//     from the mirror. A Web Lock spans the origin; the chain still orders this page's own calls.
//   * A queue is drained first and the pull waits for it, and runs only if the drain got through.
//     Whatever fails a drain - the token, the network - fails a pull too, and pulling over a
//     dirty queue rewrites the mirror underneath the changes still in it.
import { queuedCount, queued } from './store.js';
import { drain, pull, lastSync, discardQueue } from './github.js';
import { el, row } from './ui.js';

// `line` is the element that reports: a paragraph on the tile screen, a button on an app screen.
// `onPulled` is called when a pull changed something, for an app to reload its model and redraw.
// `hint` is appended to a failure, for an app whose line opens a logs panel when pressed.
export function createSync({ line, onPulled = () => {}, hint = '' }) {
  const status = (text, bad) => {
    line.textContent = text;
    line.classList.toggle('bad', !!bad);
  };

  let chain = Promise.resolve();
  const locked = fn => () => navigator.locks.request('mine-sync', fn);
  const serial = fn => (chain = chain.then(locked(fn)).catch(() => {}));

  const showQueue = async () => {
    const n = await queuedCount();
    status(n ? `${n} change(s) pending` : 'in sync');
  };

  // Failures and conflicts are reported on the line rather than in the popup the user has
  // already left - and the reason is also written to the record in github.js, so it is still
  // there after the reload that wipes this line.
  async function attempt(message) {
    try {
      const r = await drain(message);
      if (r.conflicts?.length) {
        status(`${r.conflicts.length} change(s) kept beside the remote version as `
          + `.conflict files — review them`, true);
        return false;
      }
      await showQueue();
      return true;
    } catch (err) {
      status(`not pushed: ${err.message}${hint}`, true);
      return false;
    }
  }

  // Every write reaches the local mirror first, so the view is already right and the push can
  // run behind it.
  const push = message => serial(async () => { status('pushing…'); await attempt(message); });

  // On open and on focus. A queue is retried unconditionally: a queue nothing ever retries is a
  // queue that never empties, which is how a browser ends up reporting a count it can neither
  // explain nor clear.
  const refresh = () => serial(async () => {
    if (await queuedCount()) {
      status('pushing…');
      if (!await attempt()) return;          // it already said why, and where to look
    }
    status('checking…');
    try {
      const r = await pull();                // whole repo: the mirror and the ETag are shared
      if (!r.unchanged) await onPulled(r);
      status(r.empty ? 'repo is empty'
        : r.unchanged ? 'in sync'
        : `in sync — ${r.changed} file(s) updated`);
    } catch (err) {
      status(`${err.message}${hint}`, true);
    }
  });

  return { status, push, refresh };
}

// ---- the logs ------------------------------------------------------------------------------
// What the last sync attempt did, what is still waiting, and the two ways out: push it again, or
// give up on it. The sync line used to say `14 change(s) pending` and nothing else: the reason
// was written to that same line by whichever push failed and overwritten by the next focus, so a
// browser could sit on a queue it could neither explain nor clear. The record behind this panel
// is written in github.js, which is where every drain and every pull goes through.
//
// `body` is the element to fill; the app owns the panel around it and how it opens.

export async function renderLogs(body, sync) {
  const items = await queued();
  const last = await lastSync();
  const again = () => renderLogs(body, sync);

  const kids = [row(items.length ? `${items.length} change(s) pending` : 'in sync',
    actions(items.length, sync, again))];

  kids.push(el('h3', 'lhead', 'last attempt'));
  if (!last) kids.push(el('p', 'lnote', 'Nothing recorded on this device yet.'));
  else {
    kids.push(el('p', `lline${last.outcome === 'ok' ? '' : ' bad'}`, headline(last)));
    if (last.detail) kids.push(el('p', 'lnote', last.detail));
    kids.push(el('p', 'lnote', seen(last)));
  }

  if (items.length) {
    kids.push(el('h3', 'lhead', 'waiting'));
    for (const it of items) {
      const r = el('div', 'lrow');
      r.append(el('span', `lop ${it.op}`, it.op), el('span', 'lpath', it.path),
        el('span', 'lage', age(it.at)));
      kids.push(r);
    }
  }

  body.replaceChildren(...kids);
}

function actions(n, sync, again) {
  const v = el('div', 'sval end');

  const now = el('button', 'link', 'push now');
  now.type = 'button';
  now.disabled = !n;
  now.addEventListener('click', async () => { await sync.refresh(); again(); });

  // The one button in Mine that can lose work, so it confirms the way the other one does -
  // `forget this device` on the tile screen - rather than through an app's own discard prompt,
  // whose `don't ask again` would switch this guard off along with the one it belongs to.
  const drop = el('button', 'link bad', 'discard all');
  drop.type = 'button';
  drop.disabled = !n;
  drop.addEventListener('click', async () => {
    if (!confirm(`Discard ${n} queued change(s)? They are not in GitHub and will be lost. `
      + `The repo itself is untouched.`)) return;
    await discardQueue();
    await again();
    await sync.refresh();                // restores the discarded paths from the remote
    again();
  });

  v.append(now, drop);
  return v;
}

const what = l => (l.op === 'drain' ? 'push' : 'pull');

function headline(l) {
  if (l.outcome === 'ok') return `${what(l)} succeeded`;
  if (l.outcome === 'conflict') return `${what(l)} finished with conflicts`;
  if (l.outcome === 'discarded') return 'queue discarded';
  return `${what(l)} failed${l.status ? ` — HTTP ${l.status}` : ''}`;
}

const stamp = t => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

// Counted rather than listed: the same failure repeats on every window focus, so what tells you
// anything is how long it has been failing, not twenty copies of it.
const seen = l => (l.count > 1
  ? `${l.count}× in a row, first ${stamp(l.at)}, last ${stamp(l.lastAt)}`
  : stamp(l.lastAt)) + (l.app ? ` · from ${l.app}` : '');

// Changes queued before this version carry no time, and are not going to grow one.
function age(at) {
  if (!at) return '—';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h`
    : `${Math.floor(m / 1440)}d`;
}
