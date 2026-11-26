// Three columns holding one sprint's tasks. Every task is a card and every card is a task;
// events never appear.
//
// A sprint is a date range, not a stored field, so moving a card to another sprint is exactly a
// change of its start and end - and a repeating task contributes one card per occurrence inside
// the sprint, each moved by an override of its own.
import { STAGES, sprintRange, byImportance, patchOccurrence } from './data.js';
import { S, el, phone, colorOf, iconBtn, dayLabel, STAGE_COLOR } from './ui.js';
import { collect } from './views.js';
import { openNew } from './popup.js';
import { draggable } from './drag.js';

// Stacked, the three stages sit one under the other, each full width, and the board is read by
// scrolling down - which is the right way round for a stage holding fifteen cards beside one
// holding none. Horizontal is the default and is the board as it was.
const vertical = () => S.prefs.boardOrientation === 'vert';

export function renderKanban(host) {
  const range = sprintRange(S.view.sprint, S.model.settings);
  // Started in this sprint, not merely overlapping it: a task's sprint is whichever range its
  // start falls in, so a long one is on exactly one board and the card cannot be dragged from a
  // sprint it does not belong to. The grids show the span; a card carries its date as text.
  const tasks = collect(range.start, range.end)
    .filter(o => o.type === 'task' && o.dayKey >= range.start && o.dayKey <= range.end
      && passes(o));
  const vert = vertical();

  const board = el('div', `kb${vert ? ' vert' : ''}`);
  board.style.setProperty('--col', String(S.view.col));
  for (const stage of STAGES) {
    const cards = tasks.filter(o => o.stage === stage).sort(byImportance);
    const col = el('div', 'kcol');
    col.dataset.stage = stage;
    const head = columnHead(stage, range.start, vert);
    const body = el('div', 'kcards');
    if (!cards.length) body.append(el('p', 'day-empty', 'Nothing here.'));
    for (const o of cards) body.append(card(o));
    col.append(head, body);
    board.append(col);
  }

  // `one` is the strip shifted by whole column widths, which only horizontal on a phone is.
  host.className = `view vK${phone() && !vert ? ' one' : ''}`;
  host.replaceChildren(board);
  wire(board, vert);
}

// A column header carries its state, in that state's colour, and a `+` that creates a task in
// that stage - the pane has no `+`, so this is the board's only way to make one. There is no
// colour dot and no card count: the dot said what the coloured name says, and a count is a
// number nobody acts on. On a phone the header is also how you page between the three columns.
function columnHead(stage, sprintStart, vert) {
  const head = el('div', 'khead');
  const mid = el('div', 'kmid');

  // `‹` `›` flank the name and are drawn apart from the card buttons, which mean something
  // else entirely: they move a card. Disabled at either end rather than wrapping. On a desktop
  // every column is on screen, so there is nothing for them to page - and stacked, all three
  // stages are on screen at any width, so there is nothing either.
  const pages = phone() && !vert;
  if (pages) mid.append(pager(-1));
  const name = el('span', 'kname', stage);
  name.style.color = STAGE_COLOR[stage];
  mid.append(name);
  if (pages) mid.append(pager(1));

  const add = iconBtn('plus', `Add a task to ${stage}`, 'kadd');
  add.addEventListener('click', () =>
    openNew({ dayKey: sprintStart, type: 'task', stage, allDay: true }));
  // On a phone the pager fills the header, so the left track that balances the `+` is dropped.
  head.append(el('span', 'kpad'), mid, add);
  return head;
}

function pager(dir) {
  const b = iconBtn('chev', dir < 0 ? 'Previous column' : 'Next column',
    `knav${dir > 0 ? ' next' : ''}`);
  b.disabled = dir < 0 ? S.view.col === 0 : S.view.col === STAGES.length - 1;
  b.addEventListener('click', () => {
    S.view.col = Math.max(0, Math.min(STAGES.length - 1, S.view.col + dir));
    S.render();
  });
  return b;
}

// The group, the stages and importance are applied by collect(), for every view; the assignee
// is the board's own, a card being the one place a name is read off an entry.
const passes = o => !S.kfilter.assignee || o.participants.includes(S.kfilter.assignee);

function card(o) {
  const c = el('div', 'kcard');
  c.dataset.key = o.key;

  const bar = el('span', 'kbar');
  bar.style.background = colorOf(o.group);

  // A `!` in front of the title when the task is important, and the title. No pen - the card
  // opens on a click already - and no trashcan, which put the one irreversible action a thumb's
  // width from the title you were aiming at. The `!` is a marker, not a button: it is read here
  // and set in the entry popup's toggle row.
  const top = el('div', 'ktop');
  if (o.important) top.append(el('span', 'kbang', '!'));
  top.append(el('span', 'ktitle', o.title));

  // On a desktop the card is dragged between the columns, so a pair of arrows on every card is a
  // second way to do what the drag already does - in the one place it is also easiest to mistake
  // for the header's pager. A phone has the drag too, but a held finger is slower than a tap and
  // the other columns are off screen, so the pair stays there as well.
  if (phone()) {
    const back = iconBtn('chev', 'Previous stage', 'prev');
    const fwd = iconBtn('chev', 'Next stage', 'next');
    back.disabled = o.stage === 'todo';
    fwd.disabled = o.stage === 'done';
    back.addEventListener('click', () => shiftStage(o, -1));
    fwd.addEventListener('click', () => shiftStage(o, 1));
    top.append(back, fwd);
  }

  // That is the whole card: a coloured bar, a title and two lines. The sprint number was the
  // same on every card, because a board shows one sprint. There is no sprint control anywhere -
  // a sprint is derived from the start date, so moving a task to another one is changing its
  // date.
  const main = el('div', 'kmain');
  main.append(top);
  if (o.body.trim()) main.append(el('p', 'kbody', o.body.trim()));
  main.append(el('p', 'kwhen', dayLabel(o.dayKey)));

  c.append(bar, main);
  return c;
}

// ---- moving a card -------------------------------------------------------------------------

const shiftStage = (o, dir) => {
  const next = STAGES[STAGES.indexOf(o.stage) + dir];
  if (next) patch(o, { stage: next }, `-> ${next}`);
};

// A card is deleted from the entry popup, not from the board: clicking the card opens it, its
// trashcan deletes the whole entry and its skip control drops a single occurrence.
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

// ---- dragging ------------------------------------------------------------------------------
// On every device and in both orientations: a stacked stage is as good a drop target as a
// column. A finger holds the card still to pick it up, so scrolling a column is untouched, and
// there is no swipe anywhere, so a sideways gesture never has to be told apart from a drag.
//
// On a phone's horizontal board one column is on screen and the other two are not, so while a
// card is held the three stages appear as a strip over the column header, in their colours,
// and the card is dropped on one of those.

function wire(board, vert) {
  let strip = null;
  draggable(board, {
    item: n => n.closest('button') ? null : n.closest('.kcard'),
    target: (x, y) => document.elementFromPoint(x, y)?.closest('[data-stage]') || null,
    start: () => { if (phone() && !vert) strip = dropStrip(board); },
    end: () => { strip?.remove(); strip = null; },
    drop: (c, t) => {
      const o = S.visible.get(c.dataset.key);
      const stage = t.dataset.stage;
      if (o && o.stage !== stage) patch(o, { stage }, `-> ${stage}`);
    }
  });
}

function dropStrip(board) {
  const head = board.querySelectorAll('.khead')[S.view.col].getBoundingClientRect();
  // Below the pane when the pane is at the top; the header may have scrolled up under it.
  const docked = S.prefs.barPosition === 'bottom';
  const floor = docked ? 4 : document.querySelector('.topbar').getBoundingClientRect().bottom + 4;
  const strip = el('div', 'kdrop');
  strip.style.top = `${Math.max(head.top, floor)}px`;
  strip.style.left = `${head.left}px`;
  strip.style.width = `${head.width}px`;
  for (const stage of STAGES) {
    const z = el('div', 'kzone', stage);
    z.dataset.stage = stage;
    z.style.setProperty('--c', STAGE_COLOR[stage]);
    strip.append(z);
  }
  document.body.append(strip);
  return strip;
}
