// Three columns holding one sprint's tasks. Every task is a card and every card is a task;
// events never appear.
//
// A sprint is a date range, not a stored field, so moving a card to another sprint is exactly a
// change of its start and end - and a repeating task contributes one card per occurrence inside
// the sprint, each moved by an override of its own.
import {
  STAGES, sprintRange, sprintOf, diffDays, addDays, isAllDay, byPriority, patchOccurrence,
  deleteEntry, skipOccurrence, wallParts, toInstant
} from './data.js';
import { S, el, phone, colorOf, iconBtn, dayLabel, STAGE_COLOR } from './ui.js';
import { collect } from './views.js';
import { openEntry } from './popup.js';

export function renderKanban(host) {
  const range = sprintRange(S.view.sprint, S.model.settings);
  const tasks = collect(range.start, range.end).filter(o => o.type === 'task' && passes(o));

  const board = el('div', 'kb');
  board.style.setProperty('--col', String(S.view.col));
  for (const stage of STAGES) {
    const cards = tasks.filter(o => o.stage === stage).sort(byPriority);
    const col = el('div', 'kcol');
    col.dataset.stage = stage;
    const head = el('div', 'khead');
    const dot = el('span', 'kdot');
    dot.style.background = STAGE_COLOR[stage];
    head.append(dot, el('span', 'kname', stage), el('span', 'kcount', String(cards.length)));
    const body = el('div', 'kcards');
    if (!cards.length) body.append(el('p', 'day-empty', 'Nothing here.'));
    for (const o of cards) body.append(card(o));
    col.append(head, body);
    board.append(col);
  }

  host.className = `view vK${phone() ? ' one' : ''}`;
  host.replaceChildren(board);
  wire(board);
}

// The group filter is applied by collect(); these two are the board's own.
function passes(o) {
  const f = S.kfilter;
  if (f.priority.size && !f.priority.has(o.priority ?? 0)) return false;
  if (f.assignee && !o.participants.includes(f.assignee)) return false;
  return true;
}

function card(o) {
  const c = el('div', 'kcard');
  c.dataset.key = o.key;
  if (!phone()) c.draggable = true;       // on a phone the gesture is a swipe between columns

  const bar = el('span', 'kbar');
  bar.style.background = colorOf(o.group);

  const top = el('div', 'ktop');
  const del = iconBtn('trash', o.seriesId ? 'Skip this occurrence' : 'Delete', 'bad');
  del.addEventListener('click', () => removeCard(o));
  const pen = iconBtn('pen', 'Edit');
  pen.addEventListener('click', () => openEntry(o));
  const back = iconBtn('chev', 'Previous stage', 'prev');
  const fwd = iconBtn('chev', 'Next stage', 'next');
  back.disabled = o.stage === 'todo';
  fwd.disabled = o.stage === 'done';
  back.addEventListener('click', () => shiftStage(o, -1));
  fwd.addEventListener('click', () => shiftStage(o, 1));
  top.append(del, pen, el('span', 'ktitle', o.title), back, fwd);

  const main = el('div', 'kmain');
  main.append(top);
  if (o.body.trim()) main.append(el('p', 'kbody', o.body.trim()));
  main.append(el('p', 'kwhen', dayLabel(o.dayKey)));

  const chips = el('div', 'kchips');
  chips.append(
    chip(`p${o.priority ?? 0}`, o.priority ? `P${o.priority}` : 'P–', 'Priority',
      () => patch(o, { priority: (o.priority ?? 0) % 3 + 1 }, 'priority')),
    chip('', o.estimate ? `${o.estimate}d` : 'est', 'Estimate in days', () => editEstimate(o)),
    chip('', `S${sprintOf(o.dayKey, S.model.settings) ?? '–'}`, 'Sprint', () => moveSprint(o)));

  c.append(bar, main, chips);
  return c;
}

function chip(cls, text, label, onClick) {
  const b = el('button', `chip ${cls}`.trim(), text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

// ---- moving a card -------------------------------------------------------------------------

const shiftStage = (o, dir) => {
  const next = STAGES[STAGES.indexOf(o.stage) + dir];
  if (next) patch(o, { stage: next }, `-> ${next}`);
};

function editEstimate(o) {
  const v = prompt(`Estimate for "${o.title}", in days`, o.estimate ?? '');
  if (v === null) return;
  const n = Number(v);
  patch(o, { estimate: v.trim() && n > 0 ? n : null }, 'estimate');
}

// Changing the sprint moves the task's start and end into that sprint's range, keeping its
// offset within the sprint and its wall-clock time.
function moveSprint(o) {
  const settings = S.model.settings;
  const cur = sprintOf(o.dayKey, settings);
  const v = prompt(`Move "${o.title}" to which sprint?`, String(cur ?? S.view.sprint));
  const n = Number(v);
  if (!v || !Number.isInteger(n) || n < 1) return;
  const span = settings.interval * 7;
  const offset = cur === null ? 0
    : Math.max(0, Math.min(span - 1, diffDays(sprintRange(cur, settings).start, o.dayKey)));
  patch(o, moveTo(o, addDays(sprintRange(n, settings).start, offset)), `to sprint ${n}`);
}

// Shifting an instant by whole days through its wall clock, not by 86400000 ms: a week that
// crosses a DST change would otherwise arrive an hour early.
const shiftTimed = (iso, days) => {
  const [d, t] = wallParts(iso);
  return toInstant(addDays(d, days), t);
};

function moveTo(o, dayKey) {
  const days = diffDays(o.dayKey, dayKey);
  const out = { start: o.allDay ? addDays(o.start.slice(0, 10), days) : shiftTimed(o.start, days) };
  if (o.end) out.end = isAllDay(o.end) ? addDays(o.end, days) : shiftTimed(o.end, days);
  return out;
}

// A card of a repeating task is one occurrence: deleting it skips that occurrence rather than
// taking the rule with it.
function removeCard(o) {
  const what = o.seriesId
    ? `Skip "${o.title}" on ${dayLabel(o.dayKey)}? The repeating task itself stays.`
    : `Delete "${o.title}"?`;
  if (!confirm(what)) return;
  act(o.seriesId ? `skip ${o.title}` : `delete ${o.title}`,
    () => o.seriesId ? skipOccurrence(o) : deleteEntry(o.path));
}

const patch = (o, p, what) => act(`${o.title} ${what}`, () => patchOccurrence(o, p));

async function act(what, fn) {
  try {
    await fn();
  } catch (err) {
    return S.status(err.message, true);
  }
  S.model = await S.reload();
  S.render();
  S.push(`calendar: ${what}`);
}

// ---- gestures ------------------------------------------------------------------------------

function wire(board) {
  board.addEventListener('dragstart', e => {
    const c = e.target.closest('[data-key]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.key);
    e.dataTransfer.effectAllowed = 'move';
  });
  board.addEventListener('dragover', e => { if (e.target.closest('.kcol')) e.preventDefault(); });
  board.addEventListener('drop', e => {
    const col = e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    const o = S.visible.get(e.dataTransfer.getData('text/plain'));
    if (o && o.stage !== col.dataset.stage) patch(o, { stage: col.dataset.stage }, `-> ${col.dataset.stage}`);
  });

  // One column fills a phone screen and a sideways swipe moves between them. Cards are not
  // draggable there, so the swipe never has to be told apart from a drag.
  let x0 = null;
  board.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  board.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 50) return;
    S.view.col = Math.max(0, Math.min(2, S.view.col + (dx < 0 ? 1 : -1)));
    S.render();
  });
}
