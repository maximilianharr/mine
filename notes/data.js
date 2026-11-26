// The notes model and its writes. Pure apart from the two writes at the end, so test/unit.mjs
// runs it in node. The format is in TECHNICAL-REQUIREMENTS.md.
import { allFiles } from '../shared/store.js';
import { write, remove } from '../shared/github.js';
import { parse, serialize } from '../shared/md.js';

const ROOT = 'notes';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// 4 random characters, not a counter: two devices creating notes offline in the same minute
// must never mint the same name.
function rand4() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map(n => ALPHABET[n % ALPHABET.length]).join('');
}

// A UTC instant to the second, the form a calendar `start` takes.
export const nowStamp = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Lower case, a space written as `-`, and a typed `#` dropped.
export const tagOf = t => String(t).trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');

const list = v => v == null || v === '' ? [] : Array.isArray(v) ? v : [v];

// A note as the app reads it. A hand-written file is read leniently: no `title` shows the first
// heading or the file name, no `updated` falls back to `created` and then to the date in the path.
export function noteOf({ path, text }) {
  const { data, body } = parse(text);
  const head = (body.match(/^#{1,6}[ \t]+(.+)$/m) || [])[1];
  const title = data.title != null && data.title !== '' ? String(data.title)
    : head?.trim() || path.split('/').pop().replace(/\.md$/, '');
  return {
    path, data, body, title,
    tags: [...new Set(list(data.tags).map(tagOf).filter(Boolean))],
    updated: String(data.updated ?? data.created ?? (path.match(/\d{4}-\d{2}-\d{2}/) || [''])[0])
  };
}

// Newest first, the path breaking a tie so the order never depends on how the mirror listed them.
export function buildNotes(files) {
  return files
    .filter(f => f.path.startsWith(`${ROOT}/`) && f.path.endsWith('.md') && f.text != null)
    .map(noteOf)
    .sort((a, b) => a.updated !== b.updated ? (a.updated < b.updated ? 1 : -1)
      : a.path < b.path ? 1 : -1);
}

export const loadNotes = async () => buildNotes(await allFiles(`${ROOT}/`));

export const allTags = notes => [...new Set(notes.flatMap(n => n.tags))].sort();

// Nothing ticked shows every note; ticked tags show the notes carrying any of them, and `''`
// stands for the notes carrying none.
export const shows = (note, ticked) => !ticked.size
  || (note.tags.length ? note.tags.some(t => ticked.has(t)) : ticked.has(''));

// notes/2026/11/2026-11-26-1430-k3f9.md, from the creation instant in UTC. It never changes.
export function pathFor(created, id = rand4()) {
  const [day, time] = created.split('T');
  const [y, m] = day.split('-');
  return `${ROOT}/${y}/${m}/${day}-${time.slice(0, 2)}${time.slice(3, 5)}-${id}.md`;
}

// The three fields the app owns are written over what the file held, with a new `updated`; every
// other key stays as it was. Pure: the write path and the unit checks both use it.
export function noteFile(note, { title, tags, body }, now = nowStamp()) {
  const { title: _t, created, updated: _u, tags: _g, ...rest } = note?.data ?? {};
  const made = created == null ? now : String(created);
  return {
    path: note?.path ?? pathFor(made),
    text: serialize({ title, created: made, updated: now, tags, ...rest }, body)
  };
}

// These touch the local mirror and the queue only; the push runs behind them.
export async function saveNote(note, draft) {
  const f = noteFile(note, draft);
  await write(f.path, f.text);
  return f.path;
}

export const deleteNote = path => remove(path);
