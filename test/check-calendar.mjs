// The calendar in a browser. Run through test/run.sh, which starts the server and Chromium and
// then runs every test/check-<app>.mjs in turn.
//
// What is shared with the other suites - the CDP connection, the reporting, the viewport, the
// screenshot and the store readers - is in test/cdp.mjs.
import {
  ORIGIN, ok, eq, report, sleep, send, ev, viewport, goto, shoot,
  seed, kv, queueSize, seedQueue
} from './cdp.mjs';

// The app opens on the month view. The zoom button picks a period by name - the label no longer
// cycles, it opens the picker - and the board has a slot of its own, which is also the way back
// to the month view.
const NAMES = { D: 'day', W: 'week', M: 'month', Y: 'year' };
const zoomPick = async name => {
  await ev(`document.querySelector('#zoom-btn').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#zoom-body .zrow')]
    .find(b => b.textContent.trim() === '${name}').click()`);
  await sleep(350);
};
const open = async (mode = 'M') => {
  await goto('/calendar/');
  if (mode === 'K') {
    await ev(`document.querySelector('#board').click()`);
    await sleep(500);
    return;
  }
  if (mode !== 'M') await zoomPick(NAMES[mode]);
};

// There is no `+` in the pane: a new entry comes from empty space in a cell. Wide enough that
// the month view opens the popup rather than the day preview.
const newEntry = async () => {
  await ev(`document.querySelector('.day .num').click()`);
  await sleep(350);
};

// Each row as label plus background, and - where an icon carries a value rather than only a
// subject - the colour that icon is drawn in: the stage's own, the category's own. That colour
// replaced a badge on a 16px corner and is read the same way, in square brackets.
const row = sel => `[...document.querySelectorAll('${sel} .ib')].map(b => {
  const cs = getComputedStyle(b), svg = b.querySelector('svg');
  const ink = svg ? getComputedStyle(svg).color : '';
  return (b.getAttribute('aria-label') || '?').split(':')[0] +
    (ink && ink !== cs.color ? '[' + ink + ']' : '') +
    (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : '@' + cs.backgroundColor);
})`;
const ROW = row('#f-icons'), FLAGS = row('#f-rows .quick');
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
// There is one popup: clicking an entry opens it, shown as text, and there is no pen.
const openExisting = async sel => {
  await ev(`document.querySelector('${sel}').click()`);
  await sleep(400);
};
const closeForm = async () => {
  await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
  await sleep(300);
  // A popup left dirty asks before discarding; these checks mean to throw the edit away.
  if (!await ev(`document.querySelector('#ask').hidden`)) {
    await ev(`document.querySelector('#ask-discard').click()`);
    await sleep(300);
  }
};
const click = n => ev(`document.querySelectorAll('#f-icons .ib')[${n}].click()`);
const flag = n => ev(`document.querySelectorAll('#f-rows .quick .ib')[${n}].click()`);
// The chevron at the end of the quick row, and what it shows: the icons' own fields as lines.
const expand = async open => {
  const now = await ev(`document.querySelector('#f-rows .quick .more')
    .getAttribute('aria-expanded') === 'true'`);
  if (now === open) return;
  await ev(`document.querySelector('#f-rows .quick .more').click()`);
  await sleep(300);
};
const save = async () => {
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').click()`);
  await sleep(500);
};
const hasDisk = () => ev(`!!document.querySelector('#f-icons [aria-label="Save"]')`);
// A real key through CDP, not a synthetic KeyboardEvent: implicit form submission is native
// behaviour, so only a real Enter can show that it no longer commits the entry and closes the
// popup. The target is focused first, because the one listener reads the event's target.
const pressEnter = async (sel, shift = false) => {
  await ev(`document.querySelector('${sel}').focus()`);
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyDown', text: '\r' });
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyUp' });
  await sleep(350);
};
// confirm() has no answer in a headless browser, so the trashcan's question is stubbed and read
// back from what the stub recorded. A navigation wipes it, so it is set after each open().
const stubConfirm = answer => ev(
  `(window.__asked = [], window.confirm = q => (window.__asked.push(q), ${answer}), true)`);
const asked = () => ev(`window.__asked`);
// The repeating entry the fixture carries - a weekly task, so skipping one occurrence leaves the
// rest, and its rule file is found by its text rather than by a path the checks must know.
const REPEATING = `[...document.querySelectorAll('.eline')]
  .find(l => /water the plants/i.test(l.textContent))`;
const seriesFile = () => ev(`(async () => {
  const all = await new Promise(r => {
    const q = indexedDB.open('mine', 1);
    q.onsuccess = () => {
      const t = q.result.transaction('files', 'readonly').objectStore('files').getAll();
      t.onsuccess = () => r(t.result);
    };
  });
  const f = all.find(f => (f.text || '').includes('Water the plants'));
  return f ? f.text : 'gone';
})()`);
const label = g => g.split('@')[0].split('[')[0];
const badge = g => (g.match(/\[(.*)\]/) || [, ''])[1];

// A row: the field it is, the text it shows, whether that text is the muted field name rather
// than a value, and whether it carries a trashcan. A set row shows its value and no field name.
const FIELD_ROWS = `[...document.querySelectorAll('#f-rows .frow')]
  .filter(r => !['title', 'when', 'stage'].includes(r.dataset.field)
    && !r.classList.contains('chips'))
  .map(r => ({
    field: r.dataset.field,
    text: r.querySelector('.ftap') ? r.querySelector('.ftap').textContent : '',
    unset: !!r.querySelector('.ftap.unset'),
    aria: r.querySelector('.ftap') ? r.querySelector('.ftap').getAttribute('aria-label') : '',
    trash: r.querySelectorAll('[aria-label^="Clear"]').length,
    open: r.classList.contains('in') || r.classList.contains('open'),
    h: Math.round(r.getBoundingClientRect().height),
    muted: r.querySelector('.ftap') ? getComputedStyle(r.querySelector('.ftap')).color : ''
  }))`;
// Clicking the row's text opens it - an input in the line for the three text fields, a popup
// anchored to the row for the four whose control cannot be a line. The title row of a new entry
// is already open and has no text to click.
const tapRow = async field => {
  await ev(`(() => {
    const t = document.querySelector('#f-rows [data-field="${field}"] .ftap')
      || document.querySelector('#f-rows [data-field="${field}"] .vbody-tap')
      || document.querySelector('#f-rows [data-field="${field}"]');
    t.click();
  })()`);
  await sleep(350);
};
const openRow = tapRow;
// A row has no save of its own: closing it keeps what is in it, because the editor has been
// writing into the draft all along. Its trashcan and its x sit at the right of the line itself.
const rowX = async field => {
  await ev(`document.querySelector('#f-rows [data-field="${field}"] [aria-label="Close this field"]').click()`);
  await sleep(250);
};
const rowButtons = field => ev(`[...document.querySelectorAll(
  '#f-rows [data-field="${field}"] .ib')]
  .map(b => (b.getAttribute('aria-label') || '?').split(':')[0])`);
const popButtons = () => ev(`[...document.querySelectorAll('#fpop .ib')]
  .map(b => (b.getAttribute('aria-label') || '?').split(':')[0])`);
// The input is in the row for a text field and in the popup for the rest, so the typing helper
// takes whichever is there.
const typeIn = async (field, value) => {
  await ev(`(() => {
    const n = document.querySelector('#f-rows [data-field="${field}"] input, '
        + '#f-rows [data-field="${field}"] textarea')
      || document.querySelector('#fpop input, #fpop textarea');
    n.value = ${JSON.stringify(value)};
    n.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
};
// The when row reads in halves: the start, a dash or nothing, and the end. Read as text, in
// document order, because which half carries which reading is half of what the row promises.
const whenRow = () => ev(`[...document.querySelectorAll(
  '#f-rows [data-field="when"] .ftap, #f-rows [data-field="when"] .wdash')]
  .map(n => n.textContent)`);
const whenHalf = async which => {
  await ev(`[...document.querySelectorAll('#f-rows [data-field="when"] .ftap')]
    ${which === 'end' ? '.pop()' : '[0]'}.click()`);
  await sleep(350);
};
// Which step the popup is on, and what it is holding: a month of days, the 24 hours, the four
// quarters of one of them, or the box a typed digit swaps the picker for.
const step = () => ev(`(() => {
  const p = document.querySelector('#fpop');
  return { title: document.querySelector('#fpop-title').textContent,
    shut: p.hidden,
    back: !!document.querySelector('#fpop .ib.back, .pop .ib.back'),
    kind: p.querySelector('.hgrid') ? 'hours' : p.querySelector('.mgrid') ? 'quarters'
      : p.querySelector('.pick-body') ? 'days' : p.querySelector('input') ? 'typed' : 'none',
    value: p.querySelector('input') ? p.querySelector('input').value : '',
    hint: p.querySelector('input') ? p.querySelector('input').placeholder : '',
    sel: [...p.querySelectorAll('.pk.sel')].map(n => n.textContent),
    hl: [...p.querySelectorAll('.pk.hl')].map(n => n.textContent) };
})()`);
const pickIn = async (sel, text) => {
  await ev(`[...document.querySelectorAll('#fpop ${sel} .pk')]
    .find(b => b.textContent === ${JSON.stringify(text)}
      && !b.classList.contains('out')).click()`);
  await sleep(350);
};
const stepBack = async () => {
  await ev(`document.querySelector('.pop-head .ib.back').click()`);
  await sleep(300);
};
// A real digit, like the real Enter below it: the picker gives way to a box on a keystroke the
// document hears, which a synthetic KeyboardEvent on no particular element would not prove.
const pressDigit = async d => {
  const k = { key: d, code: `Digit${d}`, windowsVirtualKeyCode: d.charCodeAt(0),
    nativeVirtualKeyCode: d.charCodeAt(0) };
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyDown', text: d });
  await send('Input.dispatchKeyEvent', { ...k, type: 'keyUp' });
  await sleep(300);
};
const typeAndEnter = async value => {
  await ev(`(() => { const n = document.querySelector('#fpop input');
    n.value = ${JSON.stringify(value)}; n.focus(); })()`);
  await pressEnter('#fpop input');
};
// The hamburger names its two errands before any opens: one tap to show them, one to pick.
const menu = async which => {
  if (which === 'filter') {           // the filter has a button of its own in the pane
    await ev(`document.querySelector('#filter-btn').click()`);
    await sleep(400);
    return;
  }
  await ev(`document.querySelector('#menu-btn').click()`);
  await sleep(350);
  if (!which) return;
  await ev(`[...document.querySelectorAll('#menu-body .mrow')]
    .find(b => b.textContent === '${which}').click()`);
  await sleep(400);
};
const box = sel => ev(`(() => {
  const r = document.querySelector('${sel}').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom),
           h: document.documentElement.clientHeight };
})()`);
const centred = b => b.top > 0 && b.bottom < b.h - 8;

// Dragging, through the DevTools input domain rather than synthetic events: a real touch is
// what has to hold still to pick something up, and what the page must stop from scrolling. The
// destination is a function, read once the thing is lifted - the board's drop strip only exists
// while a card is held.
// `node` is a JS expression for the element; q() makes one from a selector.
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const centre = node => ev(`(() => { const r = (${node}).getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const touchDrag = async (from, to, hold = 550) => {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const [x0, y0] = await centre(from);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await sleep(hold);
  const lifted = await ev(`!!document.querySelector('.drag-ghost')`);
  const [x1, y1] = typeof to === 'function' ? await to() : await centre(to);
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6 }] });
    await sleep(40);
  }
  const during = await ev(`({ over: document.querySelector('.drop-on')?.dataset.stage
    || document.querySelector('.drop-on')?.dataset.day || '' })`);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1200);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  return { lifted, ...during };
};
const mouseDrag = async (from, to) => {
  const [x0, y0] = await centre(from);
  const [x1, y1] = await centre(to);
  const m = (type, x, y) => send('Input.dispatchMouseEvent',
    { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await m('mousePressed', x0, y0);
  for (let i = 1; i <= 6; i++) { await m('mouseMoved', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await sleep(30); }
  await m('mouseReleased', x1, y1);
  await sleep(1200);
};

// ---- 1. every view fits a phone, in both schemes ----------------------------------------------

await viewport(360);
await open();
eq('fixture seeded', typeof await seed('calendar',
  { 'calendar.weekStart': 1, 'calendar.showWeeks': true,
    'calendar.popupExpanded': true }) === 'number', true);

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

// ---- 2. one popup, its rows, its toggle row and its one disk ----------------------------------

await viewport(900);
await open();
const good = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--good').trim()`);
const bad = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--bad').trim()`);
const rgb = async hex => ev(`(() => { const d = document.createElement('div');
  d.style.color = '${hex}'; document.body.append(d);
  const c = getComputedStyle(d).color; d.remove(); return c; })()`);
const GOOD = await rgb(good), BAD = await rgb(bad);
const MUTED = await rgb(await ev(
  `getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()`));
const FG = await rgb(await ev(
  `getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()`));

await newEntry();
const asEvent = await ev(ROW);
eq('a new entry\'s top row is the type pair, the disk and the x', asEvent.map(label),
  ['Task', 'Event', 'Save', 'Close']);
eq('the x is its rightmost control', (await rightmost('#f-icons')).slice(-1), ['Close']);
eq('no letter anywhere in the top row', await ev(glyphs), 0);
eq('and no pen anywhere in the popup',
  await ev(`document.querySelectorAll('#popup [aria-label^="Edit"]').length`), 0);
eq('a new entry is an event, and its row is the flags then the fields',
  (await ev(FLAGS)).map(label),
  ['All-day', 'Important', 'Category', 'Repeat', 'Alerts', 'Hide the field names']);
eq('and its row says 24h, not a sun', await ev(words('#f-rows .quick')), ['24h', '!']);
// An entry must have a title, and that is the only way a new entry differs from an edit.
eq('the disk is disabled until the title has text',
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').disabled`), true);
eq('and its title row is already an input in its own line', await ev(
  `(() => { const r = document.querySelector('#f-rows [data-field="title"]');
    return [!!r.querySelector('input'), r.classList.contains('open')]; })()`), [true, false]);
await typeIn('title', 'A new one');
eq('and enabled once it has',
  await ev(`document.querySelector('#f-icons [aria-label="Save"]').disabled`), false);

const disk = await ev(`(() => {
  const b = document.querySelector('#f-icons [aria-label="Save"]'), cs = getComputedStyle(b);
  return { color: cs.color, bg: cs.backgroundColor };
})()`);
eq('the save disk is a green glyph', disk.color, GOOD);
eq('and carries no background', disk.bg, 'rgba(0, 0, 0, 0)');

// The toggle row sits below the when row, not above it: read from document order, since a row
// that merely looks right can still be the old one.
eq('the quick row is below the when row', await ev(
  `document.querySelector('#f-rows [data-field="when"]')
     .compareDocumentPosition(document.querySelector('#f-rows .quick')) & 4 ? 'after' : 'before'`),
  'after');

const rows0 = await ev(FIELD_ROWS);
eq('five field rows, in canonical order, and no details row among them',
  rows0.map(r => r.field),
  ['group', 'recurrence', 'alerts', 'location', 'participants']);
eq('each one unset shows its field name', rows0.filter(r => !r.unset).map(r => r.field), []);
eq('and shows it muted, not plain',
  [...new Set(rows0.map(r => r.muted))], [MUTED]);
eq('no row carries a trashcan while it is unset', rows0.reduce((n, r) => n + r.trash, 0), 0);
eq('the body is a block of its own, not a row',
  await ev(`!!document.querySelector('#f-rows .vbody[data-field="body"]')`), true);

// A set row shows its value - `Conference room 3B`, not `Location Conference room 3B` - and the
// field's name survives only in the button's label, for a screen reader. Clicking another row
// takes what is in the one that was open; there is no save in a row to press.
const closedH = (await ev(FIELD_ROWS)).find(r => r.field === 'location').h;
await openRow('location');
// The one measurement this whole shape exists for: an open row is exactly as tall as it was
// shut, so nothing below it moves and the field is still where it was tapped.
const openH = (await ev(FIELD_ROWS)).find(r => r.field === 'location').h;
eq('an open text row is the same height as a closed one', openH, closedH);
await typeIn('location', 'Conference room 3B');
await openRow('participants');
await rowX('participants');
const rows1 = await ev(FIELD_ROWS);
const loc = rows1.find(r => r.field === 'location');
eq('a set row stays where it was', rows1.map(r => r.field).indexOf('location'),
  rows0.map(r => r.field).indexOf('location'));
eq('and shows the value alone', loc.text, 'Conference room 3B');
eq('with the name only in its label', loc.aria, 'Location: Conference room 3B');
eq('drawn plain rather than muted', loc.muted, FG);
eq('and it now carries a trashcan', loc.trash, 1);
eq('the unset rows keep their order', rows1.filter(r => r.unset).map(r => r.field),
  ['group', 'recurrence', 'alerts', 'participants']);

// A row being edited carries a trashcan and an x and no save: there is one save in this popup,
// and the two sit at the right of the line itself, where the closed row's trashcan already was.
await openRow('location');
eq('an open row carries a trashcan and an x, and no save', await rowButtons('location'),
  ['Clear location', 'Close this field']);
ok('all three on one line with the input', await ev(
  `(() => { const r = document.querySelector('#f-rows [data-field="location"]');
    const tops = [...r.querySelectorAll('input, .ib')]
      .map(n => Math.round(n.getBoundingClientRect().top));
    return Math.max(...tops) - Math.min(...tops) <= 4; })()`),
  'the buttons are not on the input\'s line');
ok('and the x is the rightmost of them', await ev(
  `(() => { const bs = [...document.querySelectorAll('#f-rows [data-field="location"] .ib')];
    const x = bs.find(b => b.getAttribute('aria-label') === 'Close this field');
    return bs.every(b => b === x || b.getBoundingClientRect().left < x.getBoundingClientRect().left);
  })()`), 'the x is not rightmost in the row');
eq('and the editor is inside the row',
  await ev(`!!document.querySelector('#f-rows [data-field="location"] input')`), true);
eq('with no field popup and no heading above it', await ev(
  `[document.querySelector('#fpop').hidden,
    document.querySelectorAll('#f-rows [data-field="location"] .ftitle').length]`), [true, 0]);
eq('with no sub-popup opened', await ev(`document.querySelector('#sub').hidden`), true);

// The row's x closes it and keeps what was typed: the editor has been writing into the draft all
// along, so there is nothing left to accept and nothing to lose by leaving.
await typeIn('location', 'Somewhere else');
await rowX('location');
const kept = (await ev(FIELD_ROWS)).find(r => r.field === 'location');
eq('the row\'s x closes the row', kept.open, false);
eq('and keeps what was typed', kept.text, 'Somewhere else');
eq('still without writing it', await queueSize(), 0);
await openRow('location');
await typeIn('location', 'Conference room 3B');
await rowX('location');

// Clicking a row's trashcan clears the field without opening it.
await ev(`document.querySelector('#f-rows [data-field="location"] [aria-label^="Clear"]').click()`);
await sleep(250);
const cleared = (await ev(FIELD_ROWS)).find(r => r.field === 'location');
eq('a row trashcan clears the field', [cleared.unset, cleared.text], [true, 'Location']);
eq('and does not open the row', cleared.open, false);

// ---- 2b. the four fields whose control cannot be a line ---------------------------------------
// The category, the repetition and the when open a popup anchored to their row, and the row is
// left exactly as it was: same height, same text, same trashcan. That is the whole of it - a row
// that grew a heading and a control sent the eye hunting for the field it had just tapped.

for (const [fieldName, expect] of [['group', 'Category'], ['recurrence', 'Repeat']]) {
  const before = await ev(`(() => {
    const r = document.querySelector('#f-rows [data-field="${fieldName}"]');
    return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
             rows: document.querySelectorAll('#f-rows .frow').length }; })()`);
  await tapRow(fieldName);
  const after = await ev(`(() => {
    const r = document.querySelector('#f-rows [data-field="${fieldName}"]');
    const p = document.querySelector('#fpop');
    return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
             rows: document.querySelectorAll('#f-rows .frow').length,
             open: !p.hidden, title: document.querySelector('#fpop-title').textContent,
             under: p.getBoundingClientRect().top > r.getBoundingClientRect().bottom,
             inRow: r.querySelectorAll('input, select').length,
             scrim: document.querySelector('#scrim').hidden }; })()`);
  ok(`${fieldName} opens a popup under its row`, after.open && after.under, JSON.stringify(after));
  eq(`named ${expect}`, after.title, expect);
  eq(`and the ${fieldName} row does not change`, [after.h, after.text, after.rows],
    [before.h, before.text, before.rows]);
  eq('with no control left in the row itself', after.inRow, 0);
  // No scrim, so the tap that dismisses it still reaches the row it landed on.
  eq('and no scrim behind it', after.scrim, true);
}

// One tap from one field to the next: the dismissing tap is the opening tap, which is the whole
// reason this popup has no scrim of its own.
await tapRow('group');
eq('tapping another row moves straight to it', await ev(
  `document.querySelector('#fpop-title').textContent`), 'Category');
// And tapping the row it is already on closes it rather than reopening it.
await tapRow('group');
eq('tapping the open row closes it', await ev(`document.querySelector('#fpop').hidden`), true);

// Picking a category takes it and closes the popup: there is nothing more to say about a choice
// from a list, and the entry popup behind it stays open.
await tapRow('group');
await ev(`document.querySelector('#fpop .gpick').click()`);
await sleep(350);
const tookIt = await ev(`[document.querySelector('#fpop').hidden,
  document.querySelector('#popup').hidden,
  document.querySelector('#f-rows [data-field="group"] .ftap.unset') ? 'unset' : 'set']`);
eq('picking a category closes the popup and keeps the entry', tookIt, [true, false, 'set']);
// The ball is drawn in the colour of the category it holds - the one thing a field's icon can
// say that its name cannot - and in the row's own ink when it holds none.
const ball = await ev(`(() => {
  const r = document.querySelector('#f-rows [data-field="group"]');
  return [getComputedStyle(r.querySelector('svg')).color,
          getComputedStyle(r).color]; })()`);
ok('and the ball carries that category\'s colour', ball[0] !== ball[1], ball.join(' vs '));
await ev(`document.querySelector('#f-rows [data-field="group"] [aria-label^="Clear"]').click()`);
await sleep(300);

// The alerts are a list of six now, not a line of minutes typed by hand: picking one is the
// whole edit and it closes the list, exactly as the category's does.
await tapRow('alerts');
const alerts = await ev(`(() => {
  const p = document.querySelector('#fpop');
  return { title: document.querySelector('#fpop-title').textContent,
    rows: [...p.querySelectorAll('.gpick')].map(b => b.textContent),
    on: [...p.querySelectorAll('.gpick.on')].map(b => b.textContent),
    inputs: p.querySelectorAll('input, select').length }; })()`);
eq('the alerts open a list of none and the five', [alerts.title, alerts.rows],
  ['Alerts', ['none', 'at start', '5 min before', '15 min before', '1 hour before',
    '1 day before']]);
eq('with none marked while the field is empty', alerts.on, ['none']);
eq('and nothing to type in it', alerts.inputs, 0);
await ev(`[...document.querySelectorAll('#fpop .gpick')]
  .find(b => b.textContent === '15 min before').click()`);
await sleep(350);
eq('picking one writes it and closes the list', await ev(
  `[document.querySelector('#fpop').hidden,
    document.querySelector('#f-rows [data-field="alerts"] .ftap').textContent]`),
  [true, '15 min before']);
eq('and nothing reaches the repo', await queueSize(), 0);
await ev(`document.querySelector('#f-rows [data-field="alerts"] [aria-label^="Clear"]').click()`);
await sleep(250);

// The repetition is two steps in the same flow the when walks: the rules themselves, then when
// they stop. No select anywhere in it - a dropdown inside a popup is a tap to see the options
// and an OS wheel across the phone.
await tapRow('recurrence');
const rules = await ev(`(() => {
  const p = document.querySelector('#fpop');
  return { title: document.querySelector('#fpop-title').textContent,
    rows: [...p.querySelectorAll('.gpick')].map(b => b.textContent),
    selects: p.querySelectorAll('select').length }; })()`);
eq('the repetition opens its seven choices, and no select',
  [rules.title, rules.rows.length, rules.rows[0], rules.selects],
  ['Repeat', 7, 'does not repeat', 0]);
await ev(`[...document.querySelectorAll('#fpop .gpick')]
  .find(b => b.textContent === 'weekly').click()`);
await sleep(350);
eq('picking a rule asks when it ends, never among them', await ev(
  `[document.querySelector('#fpop-title').textContent,
    [...document.querySelectorAll('#fpop .gpick')].map(b => b.textContent)]`),
  ['Repeat until', ['never', 'on a date', 'after n times']]);
await ev(`[...document.querySelectorAll('#fpop .gpick')]
  .find(b => b.textContent === 'on a date').click()`);
await sleep(350);
eq('on a date opens the month picker', await ev(
  `[document.querySelector('#fpop-title').textContent,
    !!document.querySelector('#fpop .pick-body')]`), ['Ends on', true]);
await pickIn('.pick-body', '28');
eq('and the picked day ends the flow, the row reading the whole rule', await ev(
  `[document.querySelector('#fpop').hidden,
    /^weekly, until /.test(document.querySelector('#f-rows [data-field="recurrence"] .ftap')
      .textContent)]`), [true, true]);
// `does not repeat` has no ending to ask about, so it is the one choice that ends the flow.
await tapRow('recurrence');
await ev(`[...document.querySelectorAll('#fpop .gpick')]
  .find(b => b.textContent === 'does not repeat').click()`);
await sleep(350);
eq('does not repeat ends the flow there', await ev(
  `[document.querySelector('#fpop').hidden,
    !!document.querySelector('#f-rows [data-field="recurrence"] .ftap.unset')]`), [true, true]);

// ---- the when, and the flow that sets it ----------------------------------------------------
// The row reads `WD, DD.MM.YY HH:MM`, in halves, and each half is the way into the flow at the
// value it reads. The flow walks one picker to a step: four boxes at the top of a popup opened
// to find out what day something is on were four boxes standing in for four steps.

const whenBefore = await ev(`(() => {
  const r = document.querySelector('#f-rows [data-field="when"]');
  return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent }; })()`);
const DAY = /^[^\s,]{2,4}, \d\d[./]\d\d[./]\d\d$/;      // THU, 19.11.26 - in any date format
const onOneDay = await whenRow();
ok('one day reads as a dating, a dash and the end time alone',
  onOneDay.length === 3 && DAY.test(onOneDay[0].replace(/ \d\d:\d\d$/, ''))
    && /^\d\d:\d\d$/.test(onOneDay[0].slice(-5)) && onOneDay[1] === '\u2013'
    && /^\d\d:\d\d$/.test(onOneDay[2]), JSON.stringify(onOneDay));

await whenHalf('start');
const s1 = await step();
const whenOpen = await ev(`(() => {
  const r = document.querySelector('#f-rows [data-field="when"]');
  const p = document.querySelector('#fpop');
  return { h: Math.round(r.getBoundingClientRect().height), text: r.textContent,
           under: p.getBoundingClientRect().top > r.getBoundingClientRect().bottom,
           scrim: document.querySelector('#scrim').hidden }; })()`);
eq('the when row does not change when its popup opens',
  [whenOpen.h, whenOpen.text], [whenBefore.h, whenBefore.text]);
ok('the flow opens under the row, with no scrim', whenOpen.under && whenOpen.scrim,
  JSON.stringify(whenOpen));
eq('the start half enters at the start date', [s1.title, s1.kind, s1.back],
  ['Start date', 'days', false]);
eq('with the day the field holds marked', s1.sel.length, 1);

// A picked day is the whole of that step - there is nothing to confirm about a tap on a date -
// and the hours follow, 24 of them, because a native time control takes its 12- or 24-hour
// shape from the device's locale and nothing in markup can tell it otherwise.
await pickIn('.pick-body', '20');
const s2 = await step();
eq('picking a day advances to the hours', [s2.title, s2.kind, s2.back],
  ['Start time', 'hours', true]);
eq('and marks the hour the field holds', s2.sel, ['09']);
await pickIn('.hgrid', '14');
const s3 = await step();
eq('picking an hour offers its four quarters, as whole times',
  [s3.title, s3.kind, await ev(`[...document.querySelectorAll('#fpop .mgrid .pk')]
    .map(b => b.textContent)`)],
  ['Start time', 'quarters', ['14:00', '14:15', '14:30', '14:45']]);
// Back unwinds the walk and never a value: the quarters go back to the hours, and a step goes
// back to the one before it.
await stepBack();
eq('back from the quarters is the hours', (await step()).kind, 'hours');
await stepBack();
eq('and back again is the step before', (await step()).title, 'Start date');
await pickIn('.pick-body', '20');
await pickIn('.hgrid', '14');
await pickIn('.mgrid', '14:30');
const s4 = await step();
eq('a picked time advances to the end date', [s4.title, s4.kind], ['End date', 'days']);
eq('with the start date highlighted in the grid, which the end may not fall before', s4.hl, ['20']);

await pickIn('.pick-body', '22');
eq('and the end date advances to the end time', (await step()).title, 'End time');
await pickIn('.hgrid', '16');
await pickIn('.mgrid', '16:00');
eq('the last step closes the popup', (await step()).shut, true);
const span = await whenRow();
ok('and the row reads the span as two datings, start then end',
  span.length === 2 && /20[./]/.test(span[0]) && /14:30$/.test(span[0])
    && /22[./]/.test(span[1]) && /16:00$/.test(span[1]), JSON.stringify(span));
eq('with nothing written to the repo', await queueSize(), 0);

// The end half is the end date, always - on a span and on a single day alike, where it reads a
// time alone. It is the only way the end side can turn a day into a span.
await whenHalf('end');
eq('the end half enters at the end date', (await step()).title, 'End date');
// An end before its start is moved to the start, silently: the row the flow was opened from
// reads the clamped value the moment it closes, which is the whole of the report it needs.
await pickIn('.pick-body', '2');
await pickIn('.hgrid', '16');
await pickIn('.mgrid', '16:00');
const clamped = await whenRow();
ok('an end before the start is clamped to the start',
  clamped.length === 3 && /20[./]/.test(clamped[0]), JSON.stringify(clamped));

// The keyboard walks the same steps: a digit at a picker is the first character of the value,
// so the picker gives way to a box holding it, and Enter takes what is in the box and moves on.
// A date reached by keyboard hands the keyboard to the time after it.
await whenHalf('start');
await pressDigit('2');
const typed = await step();
// The box is ordered by the format row, so what it must read is derived from the device the
// checks run on rather than named: a hard-coded `DD.MM.YYYY` would pass on a German phone and
// hide a box that asks for a day where the app shows the month first.
const firstField = await ev(`(() => {
  const p = new Date('2026-11-19T12:00:00')
    .toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .split(/\\D+/).filter(Boolean);
  return p[0] === '2026' ? 'YYYY' : p[0] === '19' ? 'DD' : 'MM'; })()`);
eq('a digit swaps the picker for a box, in the chosen format',
  [typed.kind, typed.value, typed.hint.split(/[^A-Z]/)[0]], ['typed', '2', firstField]);
await typeAndEnter('0312');
const afterDate = await step();
eq('Enter takes the date - the year from the month it was showing - and opens the time as a box',
  [afterDate.title, afterDate.kind, afterDate.hint], ['Start time', 'typed', '09:00']);
await typeAndEnter('845');
eq('Enter on the time moves to the end date, a picker again', await ev(
  `[document.querySelector('#fpop-title').textContent,
    !!document.querySelector('#fpop .pick-body')]`), ['End date', true]);
await ev(`document.querySelector('#fpop-close').click()`);
await sleep(300);
eq('the popup x closes it and leaves the entry open', await ev(
  `[document.querySelector('#fpop').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
const written = await whenRow();
ok('and what the flow wrote before it was left stands', /03[./]12[./]26 08:45/.test(written[0]),
  JSON.stringify(written));

// Refused outright, as a typed time already is: the box goes back to what the draft holds
// rather than keeping a date the calendar does not have.
await whenHalf('start');
await pressDigit('9');
await typeAndEnter('31.02.2026');
const refused = await step();
// What the draft holds, in the box's own order: the row's reading with its year written out.
const back = (await whenRow())[0].match(/\d\d\D\d\d\D\d\d/)[0].replace(/(\d\d)$/, '20$1');
eq('31 February is refused and the box goes back to the draft',
  [refused.kind, refused.value], ['typed', back]);
await ev(`document.querySelector('#fpop-close').click()`);
await sleep(300);

// Escape unwinds one layer at a time rather than throwing the edit away from inside a field.
await tapRow('recurrence');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
eq('Escape closes the field popup first', await ev(
  `[document.querySelector('#fpop').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
// An inline row is not a layer, so it does **not** swallow an Escape: leaving it loses nothing,
// and a new entry opens with its title row already an input, so swallowing the first press would
// cost two to leave the commonest popup in the app. Escape there asks the discard question.
await tapRow('location');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(350);
eq('an inline row does not swallow Escape', await ev(
  `[!!document.querySelector('#f-rows [data-field="location"] input'),
    !document.querySelector('#ask').hidden]`), [true, true]);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(250);
await rowX('location');

const allday = (await ev(FLAGS))[0];
await flag(0);
await sleep(250);
const alldayOn = (await ev(FLAGS))[0];
ok('all-day lights when on', alldayOn.includes('@'), alldayOn);
ok('and not in green', !alldayOn.endsWith('@' + GOOD), `${alldayOn} must not be the disk's green`);

// An all-day entry has no times to walk: the 24h icon beside the row is how all-day is turned
// off, and two disabled steps in the middle of a flow are two taps that do nothing.
await whenHalf('start');
eq('all-day opens at the start date', (await step()).title, 'Start date');
await pickIn('.pick-body', '12');
eq('and goes straight to the end date, skipping the time', (await step()).title, 'End date');
await pickIn('.pick-body', '14');
eq('which is its last step', (await step()).shut, true);
eq('the row then reads two days and no time at all',
  (await whenRow()).some(t => /\d\d:\d\d/.test(t)), false);

await flag(0);
await sleep(200);
eq('and goes plain again', allday.includes('@'), false);

await click(0);                                   // task
await sleep(300);
const asTask = await ev(FLAGS);
eq('a task row gains the stage, and only the stage', asTask.map(label),
  ['All-day', 'Stage', 'Important', 'Category', 'Repeat', 'Alerts', 'Hide the field names']);
eq('and reads 24h and !', await ev(words('#f-rows .quick')), ['24h', '!']);
eq('the field rows do not reshuffle', (await ev(FIELD_ROWS)).map(r => r.field),
  ['group', 'recurrence', 'alerts', 'location', 'participants']);
const fillOf = g => g.split('@')[1] || '';
ok('a new task starts at todo', !!fillOf(asTask[1]), 'the stage icon sits on its colour');
// Nothing on the row opens an editor: there is no estimate to type any more, so a tap on any of
// the three is the whole edit and the popup grows no field popup of its own.
eq('and the three flags on it open nothing', await ev(
  `[...document.querySelectorAll('#f-rows .quick .ib')].slice(0, 3)
    .some(b => b.dataset.field)`), false);

const stages = [];
for (let i = 0; i < 3; i++) { await flag(1); await sleep(220); stages.push(fillOf((await ev(FLAGS))[1])); }
ok('stage cycles through three colours', new Set(stages).size === 3, stages.join(' '));
ok('and returns to where it started', stages[2] === fillOf(asTask[1]), `${stages[2]} vs ${fillOf(asTask[1])}`);

const bangs = [];
for (let i = 0; i < 2; i++) { await flag(2); await sleep(220); bangs.push((await ev(FLAGS))[2]); }
ok('important lights when on', bangs[0].includes('@'), bangs[0]);
ok('and not in green', !bangs[0].endsWith('@' + GOOD), `${bangs[0]} must not be the disk's green`);
ok('two taps return it to plain', !bangs[1].includes('@'), bangs[1]);
eq('and its icon carries no colour of its own either way', bangs.map(badge), ['', '']);

await click(1);                                   // back to an event
await sleep(300);
// The stage is a task's and goes with it; important is not, and stays - the thing a filter
// narrows a calendar view down to is what matters, and half of what matters is a meeting.
eq('an event drops the stage and keeps important',
  (await ev(FLAGS)).map(label).slice(0, 2), ['All-day', 'Important']);

// ---- 2c. the quick row, and the chevron that names it ----------------------------------------
// Six icons and no names, with the three fields among them opening exactly what their lines
// open. The checks above run with the names showing, because they are about the rows; these run
// both ways, because the point of the row is that the two are the same controls.

await closeForm();
await open();
await newEntry();
await click(0);                                   // a task, so the row is at its fullest
await sleep(250);
await expand(false);

const quick = await ev(`(() => {
  const bar = document.querySelector('#f-rows .quick');
  return {
    icons: [...bar.querySelectorAll('.ib')].map(b => b.getAttribute('aria-label').split(':')[0]),
    fields: [...bar.querySelectorAll('[data-field]')].map(b => b.dataset.field),
    names: [...document.querySelectorAll('#f-rows .frow')].map(r => r.dataset.field || 'chips'),
    glyphs: [...bar.querySelectorAll('.glyph')].map(g => g.textContent),
    oneLine: new Set([...bar.querySelectorAll('.ib')]
      .map(b => Math.round(b.getBoundingClientRect().top))).size
  };
})()`);
eq('the row is the two flags, the stage and the three fields, then the chevron', quick.icons,
  ['All-day', 'Stage', 'Important', 'Category', 'Repeat', 'Alerts', 'Show the field names']);
eq('the three fields are the ones an icon can stand in for', quick.fields,
  ['group', 'recurrence', 'alerts']);
eq('and the rows left are the three it cannot, the body among them', quick.names,
  ['title', 'when', 'location', 'participants']);
eq('all on one line', quick.oneLine, 1);

// Lit when the field holds something, plain when it does not: with the name gone, that is what
// is left to say so, and the value itself is in the label.
const lit = () => ev(`(() => {
  const b = document.querySelector('#f-rows .quick [data-field="alerts"]');
  return [getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)',
          b.getAttribute('aria-label')]; })()`);
eq('an unset field icon is plain, and named', await lit(), [false, 'Alerts']);

// A tap on an icon is the tap on its row: the same popup, anchored under the icon that was
// tapped. The category is the one to read it off, its popup being a list with a value in it.
await ev(`document.querySelector('#f-rows .quick [data-field="group"]').click()`);
await sleep(350);
const fromIcon = await ev(`(() => {
  const p = document.querySelector('#fpop');
  const b = document.querySelector('#f-rows .quick [data-field="group"]');
  return { open: !p.hidden, title: document.querySelector('#fpop-title').textContent,
           under: p.getBoundingClientRect().top > b.getBoundingClientRect().bottom,
           groups: p.querySelectorAll('.gpick').length }; })()`);
ok('tapping an icon opens its field, under that icon', fromIcon.open && fromIcon.under,
  JSON.stringify(fromIcon));
eq('and it is the same popup the row opens', [fromIcon.title, fromIcon.groups > 0],
  ['Category', true]);
await ev(`document.querySelector('#fpop .gpick').click()`);
await sleep(300);
// A lit icon lights in **its own field's colour**, and the category's own colour is the one it
// holds. `--on` is what the popup hands the stylesheet, so the check is that the background it
// ends up with is that colour and not the plain accent, and that the ball on top is knocked out
// in something else - otherwise it would be the colour drawn on itself.
const picked = await ev(`(() => {
  const b = document.querySelector('#f-rows .quick [data-field="group"]');
  const cs = getComputedStyle(b);
  return { own: b.style.getPropertyValue('--on').trim(), bg: cs.backgroundColor,
           ball: getComputedStyle(b.querySelector('svg')).color,
           label: b.getAttribute('aria-label') }; })()`);
ok('a picked category lights its icon in that category\'s own colour',
  /^#[0-9a-f]{3,8}$/i.test(picked.own) && picked.bg === await rgb(picked.own),
  `--on ${picked.own}, background ${picked.bg}`);
ok('and the ball on it is knocked out, not drawn in the same colour',
  picked.ball !== picked.bg, `${picked.ball} on ${picked.bg}`);
ok('with the value in the label', /^Category: ./.test(picked.label), picked.label);

// The chevron: the same values as lines, in the order the icons are in, with the two toggles
// sharing the first of them. The icons stay - a field having two ways in is already true of a
// grid line and a kanban card.
await expand(true);
const named = await ev(`(() => ({
  rows: [...document.querySelectorAll('#f-rows .frow')].map(r =>
    r.classList.contains('chips') ? 'chips' : r.dataset.field),
  chips: [...document.querySelectorAll('#f-rows .chips .fchip')]
    .map(c => c.getAttribute('aria-label')),
  stage: document.querySelector('#f-rows [data-field="stage"] .ftap').textContent,
  quick: !!document.querySelector('#f-rows .quick')
}))()`);
eq('the chevron shows a line per icon, in the row\'s own order', named.rows,
  ['title', 'when', 'chips', 'stage', 'group', 'recurrence', 'alerts', 'location',
    'participants']);
eq('with all-day and important sharing the first', named.chips, ['All-day', 'Important']);
eq('the stage line reads its stage as a word', named.stage, 'Todo');
eq('and the icons are still there', named.quick, true);

await ev(`document.querySelector('#f-rows [data-field="stage"] .ftap').click()`);
await sleep(300);
eq('tapping the stage line cycles it, as the icon does',
  await ev(`document.querySelector('#f-rows [data-field="stage"] .ftap').textContent`), 'Doing');

// Remembered per device, like the board's orientation: someone who wants the names wants them
// every time. Read from the store and then from a reopened popup.
eq('the chevron is stored', await kv('calendar.popupExpanded'), true);
await closeForm();
await open();
await newEntry();
eq('and a popup opened afterwards keeps the names', await ev(
  `document.querySelector('#f-rows .quick .more').getAttribute('aria-expanded')`), 'true');
await expand(false);
eq('and shutting it is stored too', await kv('calendar.popupExpanded'), false);
await expand(true);
await closeForm();

// ---- 3. a trashcan is red wherever it appears --------------------------------------------------

await closeForm();

// Every icon comes from the one table in ui.js: the shell's buttons are empty in the markup and
// are filled by icon() at boot. An empty one is what a missed id or a renamed table entry leaves
// behind, and it would otherwise still pass the position and colour checks below.
const bare = await ev(`[...document.querySelectorAll(
  '#search-btn, #filter-btn, #menu-btn, #board, #home, #day-add, #day-close, #sub-close, #settings-close')]
  .filter(b => !b.querySelector('svg')).map(b => b.id)`);
eq('every shell button got its icon from the table', bare, []);
// The zoom draws no icon in a calendar view: it reads the period it is in.
eq('the zoom reads the period it is in', await ev(
  `[document.querySelector('#zoom-btn').textContent, !!document.querySelector('#zoom-btn svg')]`),
  ['M', false]);

// One popup: clicking an entry opens it, shown as text, with no input in it until a row is
// clicked, and its top row runs trashcan, x - no pen and no disk, nothing having changed yet.
await openExisting('.eline');
eq('an existing entry opens with no input in it', await ev(
  `document.querySelectorAll('#popup input, #popup select, #popup textarea').length`), 0);
const vrow = await rightmost('#f-icons');
eq('its top row is the trashcan and the x', vrow, ['Delete', 'Close']);
eq('no disk until something changes', await hasDisk(), false);
eq('the delete trashcan is red', await ev(
  `getComputedStyle([...document.querySelectorAll('#f-icons .ib')]
     .find(b => /^Delete/.test(b.getAttribute('aria-label')))).color`), BAD);
eq('the type is shown and not pressable', await ev(
  `document.querySelectorAll('#f-icons span.ib').length`), 1);

// The disk appears when the draft differs from the file and goes away again when it is put
// back: it reads the same comparison the discard prompt makes, not a flag set on first touch.
const was = await ev(`document.querySelector('#f-rows [data-field="title"] .ftap').textContent`);
await openRow('title');
await typeIn('title', `${was} edited`);
eq('the disk appears on a change', await hasDisk(), true);
eq('and the top row then runs trashcan, disk, x', await rightmost('#f-icons'),
  ['Delete', 'Save', 'Close']);
await typeIn('title', was);
eq('and goes away again when it is put back', await hasDisk(), false);
eq('nothing was written while it showed', await queueSize(), 0);
await closeForm();

await open('K');
eq('a kanban card has no trashcan to colour', await ev(
  `document.querySelectorAll('.kcard .ib.bad').length`), 0);
await shoot('view-K');

// A group's pen, trashcan and disk live in the popup behind *edit groups* - the one place in the
// calendar where a group is named or coloured, and the one survivor of the sub-popup, because it
// edits no field of an entry.
await open();
await menu('settings');
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

// The same list reached from an entry only picks, in the category row, and a tap on a group
// closes the row - there is nothing more to say about a choice from a list. Naming, recolouring
// and deleting a group are settings, and clearing the field is the row's own trashcan, so there
// is no `no category` row either.
await open();
await newEntry();
await tapRow('group');
const pick = await ev(`({
  inPop: !!document.querySelector('#fpop .glist'),
  inRow: !!document.querySelector('#f-rows [data-field="group"] .glist'),
  sub: document.querySelector('#sub').hidden,
  rows: document.querySelectorAll('#fpop .gpick').length,
  pens: [...document.querySelectorAll('#fpop .ib')]
    .filter(b => /^Edit /.test(b.getAttribute('aria-label') || '')).length,
  trashes: [...document.querySelectorAll('#fpop .glist .ib')]
    .filter(b => /^Delete /.test(b.getAttribute('aria-label') || '')).length,
  add: [...document.querySelectorAll('#fpop .link')]
    .filter(b => /add/i.test(b.textContent)).length,
  none: [...document.querySelectorAll('#fpop .gpick')]
    .filter(b => /no category/i.test(b.textContent)).length
})`);
ok('the category popup lists the groups', pick.inPop && pick.rows > 0, JSON.stringify(pick));
eq('and the row itself holds no list', pick.inRow, false);
eq('and opens no sub-popup', pick.sub, true);
eq('with no pen', pick.pens, 0);
eq('and no trashcan', pick.trashes, 0);
eq('and no + add', pick.add, 0);
eq('and no no-category row', pick.none, 0);
eq('the popup carries no save, because the tap is the choice', await popButtons(),
  ['Close this field']);

// A tap on a group closes the popup in one tap, and writes nothing: the disk is what writes.
await ev(`document.querySelector('#fpop .gpick').click()`);
await sleep(300);
const chose = await ev(FIELD_ROWS);
eq('picking a group closes the popup', await ev(`document.querySelector('#fpop').hidden`), true);
eq('and sets it', chose.find(r => r.field === 'group').unset, false);
eq('and writes nothing on its own', await queueSize(), 0);
await closeForm();

// ---- 4. the filter and the top pane ------------------------------------------------------------

// The filter has a button of its own in the pane; the hamburger names its two errands and opens
// neither: one tap shows `settings` and `logs`, a second opens the one that was meant.
await viewport(900);
await open();
eq('there is no gear in the pane', await ev(`document.querySelectorAll('#gear').length`), 0);
await menu();
eq('the hamburger opens a menu naming its two errands', await ev(
  `(() => { const p = document.querySelector('#menu-pop');
    return !p.hidden && [...p.querySelectorAll('.mrow')].map(b => b.textContent); })()`),
  ['settings', 'logs']);
eq('and opens none of them yet', await ev(
  `[document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').hidden,
    document.querySelector('#logs-panel').hidden]`), [true, true, true]);
eq('the menu hangs off the hamburger, within its right edge', await ev(
  `(() => { const b = document.querySelector('#menu-btn').getBoundingClientRect();
    const p = document.querySelector('#menu-pop').getBoundingClientRect();
    return [p.top > b.bottom, Math.round(p.right) <= Math.round(b.right) + 1]; })()`),
  [true, true]);

await ev(`document.querySelector('#scrim').click()`);
await sleep(200);
await menu('filter');
eq('the filter button opens the filter alone', await ev(
  `[document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').hidden,
    document.querySelector('#menu-pop').hidden]`), [false, true, true]);
// Hanging off its button rather than centred: the view it narrows has to stay in sight while
// it is narrowed, which a centred card over the middle of the screen cannot do.
ok('and hangs off its button rather than being centred', await ev(
  `(() => { const b = document.querySelector('#filter-btn').getBoundingClientRect();
    const p = document.querySelector('#filter-pop').getBoundingClientRect();
    return p.top > b.bottom && p.top < b.bottom + 20; })()`), 'the filter is not under the button');
// The two lists are behind a row each, so the dropdown stays short however many groups there are.
eq('the filter itself holds two rows and important only, no list', await ev(
  `[[...document.querySelectorAll('#filter-body .mrow')].map(b => b.textContent),
    document.querySelectorAll('#filter-body .glab.grp, #filter-body .glab.stg').length]`),
  [['Category', 'Stage'], 0]);
const listIcon = key => ev(`document.querySelector('#filter-body [data-list="${key}"]').click()`);
await listIcon('group');
await sleep(250);
const groups = await ev(`({
  shown: document.querySelectorAll('#filter-sub .glab.grp').length,
  swatches: document.querySelectorAll('#filter-sub .glab.grp .swatch').length
})`);
ok('the category icon opens a checkbox per group', groups.shown >= 3, `${groups.shown} checkboxes`);
eq('each showing its colour', groups.swatches, groups.shown);
await ev(`document.querySelectorAll('#filter-sub .glab.grp input')[0].click()`);
await sleep(500);
const ticks = await ev(
  `[...document.querySelectorAll('#filter-sub .glab.grp input')].map(i => i.checked)`);
eq('unticking one leaves the rest on', [ticks[0], ticks.slice(1).every(Boolean)], [false, true]);
eq('and lights its icon', await ev(
  `[...document.querySelectorAll('#filter-body .mrow')].map(b => b.classList.contains('on'))`),
  [true, false]);
await ev(`document.querySelectorAll('#filter-sub .glab.grp input')[0].click()`);
await sleep(500);
await ev(`document.querySelector('#filter-sub-close').click()`);
eq('the list\'s x leaves the filter open', await ev(
  `[document.querySelector('#filter-sub').hidden, document.querySelector('#filter-pop').hidden]`),
  [true, false]);
await listIcon('stage');
await listIcon('stage');
eq('and a second tap on a row shuts its list', await ev(
  `document.querySelector('#filter-sub').hidden`), true);
await listIcon('stage');
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);
eq('a tap outside shuts both', await ev(
  `[document.querySelector('#filter-sub').hidden, document.querySelector('#filter-pop').hidden]`),
  [true, true]);
// The settings panel holds the nine rows and nothing else: no filter section above them, so the
// last of them is above the fold at 320px with nothing to push it down.
await viewport(320);
await menu('settings');
eq('settings opens the panel alone, with no filter section in it', await ev(
  `[document.querySelector('#settings-panel').hidden,
    document.querySelector('#filter-pop').hidden,
    document.querySelector('#settings-panel').querySelectorAll('#filter-body').length]`),
  [false, true, 0]);
const fold = await ev(`(() => {
  const rows = document.querySelectorAll('#settings-body .srow');
  const last = rows[rows.length - 1].getBoundingClientRect();
  const panel = document.querySelector('#settings-panel').getBoundingClientRect();
  return Math.round(last.bottom - panel.bottom);
})()`);
ok('the ninth settings row stays above the fold at 320px', fold <= 2, `${fold}px past it`);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await viewport(900);
await open('K');
await menu('filter');
const boardFilter = await ev(`({
  important: [...document.querySelectorAll('#filter-body .glab.imp')].map(c => c.textContent),
  selects: document.querySelectorAll('#filter-body select').length
})`);
eq('the board filter has one important switch, not four chips', boardFilter.important,
  ['!important only']);
ok('and still an assignee', boardFilter.selects >= 1, 'no assignee select on the board filter');
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

await viewport(900);
await open();
await menu('filter');
// The assignee is the board's own; importance is not any more, so only the select goes.
eq('and the assignee is not in a calendar view', await ev(
  `document.querySelectorAll('#filter-body select').length`), 0);
eq('while important only is', await ev(
  `document.querySelectorAll('#filter-body .glab.imp').length`), 1);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

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

// The label opens the picker, and that is all it does, in every view - the caret it needed when
// the label zoomed is gone, and a cycle left behind on it would show up as the view changing
// under the open picker.
eq('there is no caret in the pane', await ev(`document.querySelectorAll('#caret').length`), 0);
for (const mode of ['M', 'W', 'D', 'Y']) {
  await open(mode);
  await ev(`document.querySelector('#period').click()`);
  await sleep(350);
  const r = await ev(`({ open: !document.querySelector('#picker').hidden,
    view: document.querySelector('#view').className.replace('view v', '') })`);
  eq(`the ${mode} label opens the picker and does not zoom`, r, { open: true, view: mode });
  await ev(`document.querySelector('#scrim').click()`);
  await sleep(200);
}

// The month of days in that dropdown is the grid a field's date picker draws too, so the one
// check that it is wired at all belongs here: today is marked, and picking a day moves the
// period to it and closes the dropdown.
await open('M');
await ev(`document.querySelector('#period').click()`);
await sleep(350);
const grid = await ev(`(() => {
  const body = document.querySelector('#pick-body');
  return { letters: body.querySelectorAll('.wh').length, days: body.querySelectorAll('.pk').length,
           today: body.querySelectorAll('.pk.now').length }; })()`);
eq('the dropdown draws a week of letters and a month of days',
  [grid.letters, grid.days >= 28, grid.today], [7, true, 1]);
const wasLabel = await periodLabel();
await ev(`[...document.querySelectorAll('#pick-body .pk')]
  .filter(b => !b.classList.contains('out') && !b.classList.contains('now'))[0].click()`);
await sleep(400);
eq('picking a day moves the period and closes the dropdown',
  [(await periodLabel()) !== null, await ev(`document.querySelector('#picker').hidden`)],
  [true, true]);
ok('and the day it picked is the one the view is anchored on', await ev(
  `document.querySelector('.day.today, .grid') !== null`), 'the month view is gone');

await open('K');
await ev(`document.querySelector('#period').click()`);
await sleep(350);
eq('on the board the label opens the sprint list', await ev(
  `!document.querySelector('#picker').hidden && !!document.querySelector('.pick-body.sprints')`), true);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

// The zoom: anchored under its own button, offering what the view it was opened in can do and
// nothing else, with the current one marked.
await open();
await ev(`document.querySelector('#zoom-btn').click()`);
await sleep(300);
const zoom = await ev(`(() => {
  const p = document.querySelector('#zoom-pop'), b = document.querySelector('#zoom-btn');
  return { open: !p.hidden,
    below: Math.round(p.getBoundingClientRect().top - b.getBoundingClientRect().bottom),
    rows: [...p.querySelectorAll('.zrow')].map(r => r.textContent.trim()),
    on: [...p.querySelectorAll('.zrow.on')].map(r => r.textContent.trim()) };
})()`);
eq('the zoom lists the four periods in a calendar view', zoom.rows,
  ['day', 'week', 'month', 'year']);
eq('with the current one marked', zoom.on, ['month']);
ok('anchored under its own button', zoom.open && zoom.below >= 0 && zoom.below < 40,
  `${zoom.below}px below it`);
await ev(`document.querySelector('#scrim').click()`);
await sleep(200);
for (const [name, want] of [['day', 'D'], ['week', 'W'], ['year', 'Y'], ['month', 'M']]) {
  await zoomPick(name);
  eq(`picking ${name} lands in it`,
    (await ev(`document.querySelector('#view').className`)).replace('view v', ''), want);
}

await open('K');
await ev(`document.querySelector('#zoom-btn').click()`);
await sleep(300);
const zoomK = await ev(`({
  rows: [...document.querySelectorAll('#zoom-pop .zrow')].map(r => r.textContent.trim()),
  on: [...document.querySelectorAll('#zoom-pop .zrow.on')].map(r => r.textContent.trim())
})`);
eq('on the board it lists the two orientations and no period', zoomK.rows,
  ['vertical', 'horizontal']);
eq('with horizontal the default', zoomK.on, ['horizontal']);
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
  const on = ['#board', '#zoom-btn', '#search-btn', '#prev', '#period', '#next', '#filter-btn', '#menu-btn',
    '#home']
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
eq('the pane reads view, zoom, search, period, filter, menu, home', (await ev(pane)).order,
  ['#board', '#zoom-btn', '#search-btn', '#prev', '#period', '#next', '#filter-btn', '#menu-btn',
    '#home']);

// About half an arrow glyph either side of the label: the point is a visible separation, not a
// number, so it is measured against the arrow's own font size.
const gaps = await ev(`(() => {
  const b = sel => document.querySelector(sel).getBoundingClientRect();
  const em = parseFloat(getComputedStyle(document.querySelector('#prev')).fontSize);
  return { left: Math.round(b('#period').left - b('#prev').right),
           right: Math.round(b('#next').left - b('#period').right), em: Math.round(em) };
})()`);
ok('the label stands about half an arrow clear of each arrow',
  gaps.left >= gaps.em * 0.3 && gaps.left <= gaps.em * 0.8 &&
  Math.abs(gaps.left - gaps.right) <= 2, JSON.stringify(gaps));

await viewport(320);
await open();
// Two rows on a phone: the four that go somewhere share the first, the period takes the second.
// Rows are clustered by vertical centre rather than compared exactly, so a one-pixel difference
// between two controls of unequal height cannot read as a third row.
const narrow = await ev(`(() => {
  const on = ['#board', '#zoom-btn', '#search-btn', '#prev', '#period', '#next', '#filter-btn', '#menu-btn',
    '#home']
    .map(id => [id, document.querySelector(id)])
    .filter(([, n]) => n && n.getClientRects().length)
    .map(([id, n]) => { const r = n.getBoundingClientRect();
      return { id, left: r.left, w: r.width, mid: r.top + r.height / 2,
               fs: Math.round(parseFloat(getComputedStyle(n).fontSize)),
               svg: n.querySelector('svg')
                 ? Math.round(n.querySelector('svg').getBoundingClientRect().width) : 0 }; })
    .sort((a, b) => a.mid - b.mid);
  const rows = [];
  for (const o of on) if (!rows.length || o.mid - rows[rows.length - 1] > 6) rows.push(o.mid);
  const of = i => on.filter(o => Math.abs(o.mid - rows[i]) <= 6).sort((a, b) => a.left - b.left);
  const w = sel => Math.round((of(1).find(o => o.id === sel) || { w: 0 }).w);
  const fs = sel => (on.find(o => o.id === sel) || { fs: 0 }).fs;
  return { rows: rows.length,
    first: of(0).map(o => o.id), second: of(1).map(o => o.id),
    firstW: of(0).map(o => Math.round(o.w)),
    label: w('#period'), prev: w('#prev'), next: w('#next'),
    arrowFs: fs('#prev'), iconPx: (on.find(o => o.id === '#board') || { svg: 0 }).svg };
})()`);
eq('on a phone the pane is two rows', narrow.rows, 2);
eq('the first holds the six that go somewhere', narrow.first,
  ['#board', '#zoom-btn', '#search-btn', '#filter-btn', '#menu-btn', '#home']);
ok('sharing the row equally', Math.max(...narrow.firstW) - Math.min(...narrow.firstW) <= 2,
  narrow.firstW.join('px, ') + 'px');
eq('and the second the period, its arrows back', narrow.second,
  ['#prev', '#period', '#next']);
eq('whose two arrows are equal in size', narrow.prev, narrow.next);
ok('and whose label is larger than either', narrow.label > narrow.prev,
  `label ${narrow.label}px, arrow ${narrow.prev}px`);
// The arrows are drawn at the size of the icons on the row above, and in particular not at the
// 2rem they used to be, which made the row that steps the period the loudest thing in the pane.
ok('the second row\'s arrows match the first row\'s icons',
  Math.abs(narrow.arrowFs - narrow.iconPx) <= 2 && narrow.arrowFs < 30,
  `arrow ${narrow.arrowFs}px, icon ${narrow.iconPx}px`);

// There is no swipe left anywhere: the label was swiped only because a phone's pane had no
// `‹` `›` to press, and a gesture doing what a visible button does is a second mechanism for
// one action. The label is read before the gesture, because a step is synchronous - reading it
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
for (const sel of ['#period', '.grid']) {
  const was = await swipeOn(sel);
  await sleep(400);
  eq(`a swipe on ${sel} changes nothing`, await periodLabel(), was);
}

// And the arrows that replaced it do step the period.
const beforeStep = await periodLabel();
await ev(`document.querySelector('#next').click()`);
await sleep(400);
ok('the phone pane\'s › steps the period', (await periodLabel()) !== beforeStep,
  `still ${beforeStep}`);

// A clipped label is worse than a smaller one: on its own row at twice the size, the label still
// has to fit whole at 320 px, or the date - the one thing the pane is for - is unreadable.
for (const mode of ['M', 'W', 'D', 'Y', 'K']) {
  await open(mode);
  const cut = await ev(`(() => { const n = document.querySelector('#period-label');
    return Math.round(n.scrollWidth - n.clientWidth); })()`);
  ok(`the ${mode} label fits the phone pane`, cut <= 1, `clipped by ${cut}px`);
}

// The step above left another month on screen: the checks below want the fixture's own.
await viewport(900);
await open();

// ---- 4b. the filter narrows every view, and says so on its button ------------------------------
// The groups were always applied everywhere; the stages and importance were the board's alone
// and were forgotten on a reload. All three are one switch each now, applied in one place, and
// a filter that is on is visible from the pane without opening anything.

await viewport(900);
await open('M');
await menu('filter');
await ev(`document.querySelector('#filter-body [data-list="stage"]').click()`);
eq('the stage icon opens the three stages', await ev(
  `[...document.querySelectorAll('#filter-sub .glab')].map(l => l.textContent.trim())`),
  ['Todo', 'Doing', 'Done']);

const countOn = () => ev(`(() => { const b = document.querySelector('#filter-btn .fcount');
  return b ? b.textContent : ''; })()`);
eq('and nothing is on it while nothing is filtered', await countOn(), '');

const tick = async text => {
  await ev(`[...document.querySelectorAll('#filter-pop .glab, #filter-sub .glab')]
    .find(l => l.textContent.trim().endsWith(${JSON.stringify(text)}))
    .querySelector('input').click()`);
  await sleep(450);
};
const titles = () => ev(`[...document.querySelectorAll('.eline .what')].map(t => t.textContent)`);

const all = await titles();
await tick('Done');
const noDone = await titles();
ok('a stage switched off hides those tasks from the month',
  noDone.length < all.length && !noDone.includes('Weekly shop'), JSON.stringify(noDone));
ok('and leaves every event where it was',
  noDone.includes('Sprint planning') && noDone.includes('Dentist'), JSON.stringify(noDone));
eq('its button says one filter is on', await countOn(), '1');

await tick('important only');
const onlyImportant = await titles();
ok('important only keeps what is marked, events included',
  onlyImportant.includes('Review the open pull requests')
    && onlyImportant.includes('Submit the expenses'), JSON.stringify(onlyImportant));
ok('and drops everything that is not',
  !onlyImportant.includes('Dentist') && !onlyImportant.includes('Standup'),
  JSON.stringify(onlyImportant));
eq('and the count is one per kind of narrowing, not one per thing', await countOn(), '2');

// Remembered per device: a filter that empties a month is one you want to find still on.
await open('M');
eq('the filter survives a reload', await countOn(), '2');
eq('and the month is still narrowed', (await titles()).includes('Dentist'), false);

await menu('filter');
await ev(`document.querySelector('#filter-body [data-list="stage"]').click()`);
await tick('important only');
await tick('Done');
eq('switching them back off clears the count', await countOn(), '');
eq('and puts everything back', (await titles()).length, all.length);
await ev(`document.querySelector('#scrim').click()`);
await sleep(250);

// ---- 4c. search ---------------------------------------------------------------------------------
// The magnifier opens Mine's search over the calendar folder. It lists as you type, a result
// opens its entry over the search, and closing the entry comes back to the query as it was.

await viewport(900);
await open();
const searchFor = async q => {
  await ev(`(() => { const i = document.querySelector('#search-pop .sq');
    i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(150);
  return ev(`[...document.querySelectorAll('#search-pop .hit .hit-title')].map(t => t.textContent)`);
};
await ev(`document.querySelector('#search-btn').click()`);
await sleep(400);
eq('the magnifier opens the search with the cursor in it', await ev(
  `[!document.querySelector('#search-pop').hidden,
    document.activeElement === document.querySelector('#search-pop .sq')]`), [true, true]);
eq('and an empty query lists nothing', await searchFor(''), []);
const plants = await searchFor('wat pla');
eq('a repeating entry is found once, by the start of its words', plants.filter(t => /water the plants/i.test(t)).length, 1);
eq('a word no entry holds finds nothing', await searchFor('zzqx'), []);
eq('and says so', await ev(`document.querySelector('#search-pop .hit-more').textContent`), 'Nothing found.');
eq('the settings and groups files are never results', await ev(`(async () => {
  const i = document.querySelector('#search-pop .sq');
  i.value = 'kanban'; i.dispatchEvent(new Event('input', { bubbles: true }));
  return [...document.querySelectorAll('#search-pop .hit')].map(h => h.dataset.path)
    .filter(p => /groups|settings/.test(p));
})()`), []);
await searchFor('water plants');
ok('the matched words are marked', await ev(
  `[...document.querySelectorAll('#search-pop .hit mark')].some(m => /^water$/i.test(m.textContent))`),
  'no mark on "water"');
await ev(`[...document.querySelectorAll('#search-pop .hit')]
  .find(h => /water the plants/i.test(h.textContent)).click()`);
await sleep(400);
eq('a result opens its entry', await ev(`!document.querySelector('#popup').hidden`), true);
ok('the one it names', /water the plants/i.test(await ev(`document.querySelector('#f-rows').textContent`)),
  'the popup is not the plants');
await closeForm();
eq('closing it comes back to the search as it was', await ev(
  `[!document.querySelector('#search-pop').hidden, document.querySelector('#search-pop .sq').value]`),
  [true, 'water plants']);
await ev(`document.querySelector('#search-pop [aria-label="Close"]').click()`);
await sleep(200);
eq('its x closes it', await ev(`document.querySelector('#search-pop').hidden`), true);
ok('it hangs from the top of the screen', await ev(`(() => {
  document.querySelector('#search-btn').click();
  return new Promise(r => setTimeout(() => {
    const t = document.querySelector('#search-pop').getBoundingClientRect().top;
    document.querySelector('#scrim').click();
    r(t < 40);
  }, 300));
})()`), 'the search is not at the top');

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
await menu('settings');
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
eq('the panel holds nine rows', panel.rows, 9);
eq('with the short labels', panel.labels,
  ['Groups', 'Start week on', 'Time zone', 'Date format', 'Calendar weeks',
    'Confirm discard', 'Sprint length', 'First sprint', 'Theme']);
ok('the controls line up in one column', panel.spread <= 1, `${panel.spread}px apart`);
eq('no group is listed in the panel itself', panel.groups, 0);
eq('and no paragraph explains what is stored where', panel.notes, 0);
eq('the last element is a row', panel.last, 'srow');
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(320);
await open();
await menu('settings');
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
ok('the entry popup is centred', centred(await box('#popup .card')),
  JSON.stringify(await box('#popup .card')));
// With its tallest row open - the body's textarea - the card still has to sit clear of both
// edges, because an editor inside a row is what the popup grows by now.
await openRow('body');
ok('and stays centred with its tallest row open', centred(await box('#popup .card')),
  JSON.stringify(await box('#popup .card')));
await closeForm();
await menu('settings');
ok('the settings panel is centred', centred(await box('#settings-panel')),
  JSON.stringify(await box('#settings-panel')));
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);

await viewport(900);
await open('Y');
await ev(`document.querySelector('.yday:not(.out)').click()`);
await sleep(400);
eq('a year day still opens the day preview',
  await ev(`!document.querySelector('#day-pop').hidden`), true);
// Centred on a desktop as well as on a phone: it is not anchored to the cell that opened it.
ok('and is centred there too, not beside the cell', centred(await box('#day-pop')),
  JSON.stringify(await box('#day-pop')));
await shoot('day-preview');
await ev(`document.querySelector('#day-close').click()`);
await sleep(250);
await ev(`document.querySelectorAll('.ycap')[4].click()`);
await sleep(500);
eq('a month name zooms into that month', await periodLabel(), `${await month(4)}/${YY}`);
eq('and lands in the month view', await ev(`!!document.querySelector('.grid')`), true);

// ---- 5b. a span is on every day it covers ------------------------------------------------------
// The fixture carries two: an all-day conference across three days, and a night shift across
// midnight. Both are top-row entries in every view - a bar continued across the cells, flat on
// the side it goes on, with its title repeated so the middle of a trip says what it is.

await viewport(900);
await open('M');
const spanCells = await ev(`(() => {
  const cells = [...document.querySelectorAll('.day')].filter(c =>
    [...c.querySelectorAll('.eline .what')].some(w => w.textContent === 'Berlin conference'));
  return cells.map(c => {
    const line = [...c.querySelectorAll('.eline')]
      .find(l => l.querySelector('.what').textContent === 'Berlin conference');
    return { day: c.dataset.day,
      from: line.classList.contains('from-before'), on: line.classList.contains('goes-on'),
      first: c.querySelector('.rows').firstElementChild === line,
      when: line.querySelector('.when') ? line.querySelector('.when').textContent : '' };
  });
})()`);
eq('the month shows a three-day span on all three days', spanCells.length, 3);
eq('rounded where it starts and ends, flat where it goes on',
  spanCells.map(c => `${c.from ? '<' : '|'}${c.on ? '>' : '|'}`), ['|>', '<>', '<|']);
eq('and it is the first line in each of those cells', spanCells.map(c => c.first),
  [true, true, true]);
eq('an all-day span carries no time on any day', spanCells.map(c => c.when), ['', '', '']);
ok('the title is on every day, not only the first',
  await ev(`[...document.querySelectorAll('.eline .what')]
    .filter(w => w.textContent === 'Berlin conference').length`) === 3, 'the title is drawn once');

// A timed span leaves the hour grid for the top strip: an entry running past midnight has no
// place in a column of 24 hours, and the strip is where a span is read in every other view.
await open('W');
const night = () => ev(`(() => {
  const cells = [...document.querySelectorAll('.adcell')].filter(c =>
    [...c.querySelectorAll('.what')].some(w => w.textContent === 'Night shift'));
  return { strip: cells.map(c => { const l = [...c.querySelectorAll('.eline')]
      .find(x => x.querySelector('.what').textContent === 'Night shift');
      return l.querySelector('.when') ? l.querySelector('.when').textContent : ''; }),
    grid: [...document.querySelectorAll('.tev .what')]
      .filter(w => w.textContent === 'Night shift').length };
})()`);
// Collected across the weeks of the month rather than read off one: a span across midnight is
// a span across a week boundary whenever it starts on the last day of a week, and then each of
// the two weeks holds one of its days - which is right, and not something to assert around.
await ev(`for (let i = 0; i < 5; i++) document.querySelector('#prev').click()`);
await sleep(500);
const seen = { strip: [], grid: 0 };
for (let i = 0; i < 11; i++) {
  const r = await night();
  seen.strip.push(...r.strip);
  seen.grid += r.grid;
  await ev(`document.querySelector('#next').click()`);
  await sleep(300);
}
eq('a timed span is in the top strip on both its days', seen.strip.length, 2);
eq('and in the hour grid on neither', seen.grid, 0);
eq('reading its start on the first day and its end, arrowed, on the last',
  seen.strip.map(t => t.replace(/\d\d:\d\d/, 'HH:MM')), ['HH:MM', '\u2192HH:MM']);
// The strip is no longer the all-day row alone, so its corner no longer says it is.
eq('the strip\'s corner is bare', await ev(`document.querySelector('.tg-allday .tcorner')
  .textContent`), '');

// The day preview lists what a day holds, which includes what began before it. On a phone,
// where tapping a month cell opens the preview rather than a new entry.
await viewport(360);
await open('M');
const mid = spanCells[1].day;
await ev(`document.querySelector('.day[data-day="${mid}"] .num').click()`);
await sleep(400);
eq('a day in the middle of a span lists it, and says it continues', await ev(
  `(() => { const r = [...document.querySelectorAll('.dentry')]
    .find(d => d.querySelector('.dn').textContent === 'Berlin conference');
    return r ? r.querySelector('.dt').textContent.split(' · ')[0] : 'missing'; })()`),
  'all-day');
await ev(`document.querySelector('#day-close').click()`);
await sleep(250);
await viewport(900);

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
// Read off the property rather than against a hex: the three stage colours are declared for
// both schemes now, so a hex here would pin the check to one of them.
eq('the stage name carries its colour', await ev(
  `getComputedStyle(document.querySelector('.kcol[data-stage="doing"] .kname')).color`),
  await rgb(await ev(
    `getComputedStyle(document.documentElement).getPropertyValue('--doing').trim()`)));

const atTodo = await ev(shown);
eq('exactly one column is visible', atTodo.count, 1);
eq('and it is todo', atTodo.stage, 'todo');
eq('the pager is disabled at todo', await ev(`document.querySelector('.knav').disabled`), true);

// The pager fills the header: it is the only way to see another stage on a phone, and a small
// square in the middle of an otherwise empty row asked a thumb to aim at its narrowest part.
const pager = await ev(`(() => {
  const head = document.querySelector('.kcol[data-stage="todo"] .khead');
  const navs = [...head.querySelectorAll('.knav')];
  const boxes = navs.map(n => n.getBoundingClientRect());
  const hr = head.getBoundingClientRect();
  const add = head.querySelector('.kadd').getBoundingClientRect();
  return { w: boxes.map(b => Math.round(b.width)),
    left: Math.round(Math.min(...boxes.map(b => b.left)) - hr.left),
    gap: Math.round(add.left - Math.max(...boxes.map(b => b.right))),
    bg: navs.map(n => getComputedStyle(n).backgroundColor) };
})()`);
eq('its two arrows are equal in width', pager.w[0], pager.w[1]);
ok('and fill the header up to the +', pager.left <= 2 && pager.gap <= 10,
  `${pager.left}px in from the left, ${pager.gap}px short of the +`);
eq('the disabled one carries no background', pager.bg[0], 'rgba(0, 0, 0, 0)');
ok('and the one that works does', pager.bg[1] !== 'rgba(0, 0, 0, 0)', pager.bg[1]);

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
  const l = [...document.querySelectorAll('#f-rows .quick .ib')].map(b => b.getAttribute('aria-label'));
  return l.find(x => /^Stage/.test(x)) || 'no stage';
})()`), 'Stage: todo');
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
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
ok('no sprint number and no day count on it', !/\bS\d|\b\d+d\b/.test(card.text), card.text);
ok('an important task carries a !', card.bangs > 0, 'no ! on any card');
eq('and the ! is not a button', card.pressableBang, 0);

// The board's click delegation used to match the card from inside one of its own buttons, so a
// move opened the ticket on top of itself. A handler that stops at the button but still lets
// the event bubble must turn this red.
const todoBefore = await ev(`document.querySelectorAll('.kcol[data-stage="todo"] .kcard').length`);
await ev(`document.querySelector('.kcol[data-stage="todo"] .kcard [aria-label="Next stage"]').click()`);
await sleep(1100);
const afterMove = await ev(`({
  popup: !document.querySelector('#popup').hidden,
  todo: document.querySelectorAll('.kcol[data-stage="todo"] .kcard').length })`);
eq('the arrow moves the card out of todo', afterMove.todo, todoBefore - 1);
eq('and does not open the ticket', afterMove.popup, false);

await ev(`document.querySelector('.kcard .ktitle').click()`);
await sleep(500);
eq('clicking the card itself does open it',
  await ev(`!document.querySelector('#popup').hidden`), true);
eq('with no input in it until a row is clicked', await ev(
  `document.querySelectorAll('#popup input, #popup textarea').length`), 0);
await closeForm();

// Stacked, all three stages are on screen, so no header carries an arrow - at either width -
// and the cards keep their own `<` `>` on a phone, there being nothing to drag onto.
const orient = async name => {
  await ev(`document.querySelector('#zoom-btn').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#zoom-body .zrow')]
    .find(b => b.textContent.trim() === '${name}').click()`);
  await sleep(450);
};
await orient('vertical');
const stacked = await ev(`(() => {
  const cols = [...document.querySelectorAll('.kcol')].map(c => c.getBoundingClientRect());
  const board = document.querySelector('.kb').getBoundingClientRect();
  return { cols: cols.length,
    stacked: cols.every((r, i) => i === 0 || r.top >= cols[i - 1].bottom - 1),
    full: cols.every(r => Math.round(board.width - r.width) <= 24),
    pagers: document.querySelectorAll('.khead .knav').length,
    adds: document.querySelectorAll('.khead .kadd').length,
    cardArrows: document.querySelectorAll('.kcard [aria-label$="stage"]').length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()`);
eq('stacked, all three stages are on screen', stacked.cols, 3);
ok('one under the other', stacked.stacked, 'the stages are not stacked');
ok('each as wide as the board', stacked.full, 'a stacked stage is not full width');
eq('with no pager in any header', stacked.pagers, 0);
eq('and each header keeping its +', stacked.adds, 3);
ok('a phone card keeps its own arrows', stacked.cardArrows > 0, 'no card arrows when stacked');
eq('and the board does not extend sideways at 320px', stacked.over, 0);

await orient('horizontal');
eq('switching back restores the one-column strip',
  await ev(`document.querySelector('#view').className.includes('one')`), true);
ok('and its pager', await ev(`document.querySelectorAll('.khead .knav').length`) > 0,
  'the pager did not come back');

// On a desktop the card is dragged between the columns, so neither the card nor the header
// carries arrows: every column is already on screen, in both orientations.
await viewport(900);
await open('K');
eq('a desktop header has no pager', await ev(`document.querySelectorAll('.khead .knav').length`), 0);
eq('and a desktop card has no move arrows',
  await ev(`document.querySelectorAll('.kcard [aria-label$="stage"]').length`), 0);
await orient('vertical');
eq('nor stacked on a desktop', await ev(
  `document.querySelectorAll('.khead .knav, .kcard [aria-label$="stage"]').length`), 0);
const capped = await ev(`(() => {
  const b = document.querySelector('.kb').getBoundingClientRect();
  const pane = document.querySelector('.topbar').getBoundingClientRect();
  return { board: Math.round(b.width), pane: Math.round(pane.width),
           left: Math.round(b.left), right: Math.round(pane.right - b.right) };
})()`);
ok('a stacked board is capped and centred too', capped.board <= 78 * 16 + 2 &&
  Math.abs(capped.left - capped.right) <= 2, JSON.stringify(capped));
await orient('horizontal');

// ---- 6b. dragging a card ----------------------------------------------------------------------
// On every device. A finger holds a card still to lift it; on a phone's one-column board the
// three stages then appear over the header and the card is dropped on one. A finger that moves
// before the hold is a scroll and lifts nothing.

const inStage = st => ev(`document.querySelectorAll('.kcol[data-stage="${st}"] .kcard').length`);
await viewport(360);
await open('K');
let todo0 = await inStage('todo'), doing0 = await inStage('doing');
const firstTodo = `.kcol[data-stage="todo"] .kcard .ktitle`;
const held = await touchDrag(q(firstTodo),
  () => centre(`[...document.querySelectorAll('.kdrop .kzone')].find(z => z.dataset.stage === 'doing')`));
ok('a held card lifts', held.lifted, 'no ghost after holding');
eq('and the strip marks the stage under the finger', held.over, 'doing');
eq('releasing there moves it out of todo', await inStage('todo'), todo0 - 1);
eq('and into doing', await inStage('doing'), doing0 + 1);
eq('the strip is gone afterwards', await ev(`document.querySelectorAll('.kdrop, .drag-ghost').length`), 0);
eq('and the drop opened nothing', await ev(`document.querySelector('#popup').hidden`), true);

todo0 = await inStage('todo');
const twitch = await touchDrag(q(firstTodo),
  async () => { const [x, y] = await centre(q(firstTodo)); return [x, y + 200]; }, 60);
eq('a finger that moves at once lifts nothing', twitch.lifted, false);
eq('and moves nothing', await inStage('todo'), todo0);

await viewport(900);
await open('K');
todo0 = await inStage('todo');
const done0 = await inStage('done');
await mouseDrag(q(firstTodo), q(`.kcol[data-stage="done"] .khead`));
eq('a mouse drags a card across the desktop board', [await inStage('todo'), await inStage('done')],
  [todo0 - 1, done0 + 1]);
eq('with no strip on a desktop', await ev(`document.querySelectorAll('.kdrop').length`), 0);
eq('and no popup', await ev(`document.querySelector('#popup').hidden`), true);
const [cx, cy] = await centre(q(firstTodo));
for (const type of ['mousePressed', 'mouseReleased'])
  await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 });
await sleep(450);
eq('a click that does not move still opens the card', await ev(`!document.querySelector('#popup').hidden`), true);
await closeForm();

// ---- 6c. dragging an entry to another day -------------------------------------------------------
// In the month and the week. The day it is dropped on is its new start; the time stays; a span's
// end moves with it; a repeating entry moves one occurrence, as an override.

const files = () => ev(`(async () => {
  const all = await new Promise(r => {
    const q = indexedDB.open('mine', 1);
    q.onsuccess = () => {
      const t = q.result.transaction('files', 'readonly').objectStore('files').getAll();
      t.onsuccess = () => r(t.result);
    };
  });
  return all.filter(f => f.path.startsWith('calendar/')).map(f => f.text || '');
})()`);
// A value as written, quotes off: the fixture quotes its titles and a save writes them bare.
const fm = (text, key) => ((text.match(new RegExp(`^${key}: (.*)$`, 'm')) || [])[1] || '')
  .replace(/^"(.*)"$/, '$1');
const entryText = async title => (await files())
  .find(t => fm(t, 'title') === title && !/^series:/m.test(t)) || '';
const lineOn = (title, day) => `[...document.querySelectorAll('.day[data-day$="-${day}"]:not(.out) .eline')]
  .find(l => l.querySelector('.what').textContent === ${JSON.stringify(title)})`;
const cellOn = day => q(`.day[data-day$="-${day}"]:not(.out)`);
const dd = n => String(n).padStart(2, '0');
const hourOf = iso => ev(`new Date(${JSON.stringify(iso)}).getHours() + ':' + new Date(${JSON.stringify(iso)}).getMinutes()`);

await viewport(900);
await open('M');
await mouseDrag(lineOn('Family lunch', '07'), cellOn('14'));
eq('an all-day entry dropped on another day starts there', fm(await entryText('Family lunch'), 'start').slice(8), '14');
eq('and the popup stays shut', await ev(`document.querySelector('#popup').hidden`), true);

const tap0 = fm(await entryText('Fix the bathroom tap'), 'start');
await mouseDrag(lineOn('Fix the bathroom tap', '06'), cellOn('13'));
const tap1 = fm(await entryText('Fix the bathroom tap'), 'start');
eq('a timed entry moves its day', [tap0.slice(8, 10), tap1.slice(8, 10)], ['06', '13']);
eq('and keeps its time', await hourOf(tap1), await hourOf(tap0));
ok('its end moves with it', fm(await entryText('Fix the bathroom tap'), 'end').slice(8, 10) === '13',
  fm(await entryText('Fix the bathroom tap'), 'end'));

// Picked up by its middle day, dropped on the 16th: the 16th is the new start, whichever day of it
// was held.
await mouseDrag(lineOn('Berlin conference', '10'), cellOn('16'));
const berlin = await entryText('Berlin conference');
eq('a span starts on the day it is dropped on, whichever day was held',
  [fm(berlin, 'start').slice(8), fm(berlin, 'end').slice(8)], ['16', '18']);

const series0 = await seriesFile();
await mouseDrag(lineOn('Water the plants', '10'), cellOn('11'));
const ov = (await files()).find(t => /^series:/m.test(t) && fm(t, 'start').slice(8, 10) === '11');
ok('a repeating entry moves one occurrence, as an override', !!ov, 'no override starting on the 11th');
eq('and the rule file is untouched', await seriesFile(), series0);
ok('the moved occurrence is drawn on its new day',
  await ev(`!!${lineOn('Water the plants', '11')}`), 'not on the 11th');

await viewport(360);
await open('M');
const dent = await touchDrag(lineOn('Dentist', '02'), cellOn('04'));
ok('on a phone a held line lifts', dent.lifted, 'no ghost');
eq('and drops on the day under the finger', fm(await entryText('Dentist'), 'start').slice(8), '04');
eq('opening nothing', [await ev(`document.querySelector('#popup').hidden`),
  await ev(`document.querySelector('#day-pop').hidden`)], [true, true]);

// The week: dropped anywhere in another day's column, a timed block keeps its time.
await viewport(900);
await open('W');
for (let i = 0; i < 4 && !await ev(`!!document.querySelector('.tcol .tev')`); i++) {
  await ev(`document.querySelector('#prev').click()`);
  await sleep(300);
}
const block = await ev(`(() => { const b = document.querySelector('.tcol .tev');
  b.scrollIntoView({ block: 'center' });
  const cols = [...document.querySelectorAll('.tcol')]; const i = cols.indexOf(b.parentElement);
  return { key: b.dataset.key, title: b.querySelector('.what').textContent,
    to: cols[i < 6 ? i + 1 : i - 1].dataset.day }; })()`);
const wk0 = fm(await entryText(block.title), 'start');
// Aimed at the next column, a little below the block's own height - another hour in that day.
await mouseDrag(`document.querySelector('.tev[data-key=${JSON.stringify(block.key)}]')`,
  `(() => { const c = document.querySelector('.tcol[data-day="${block.to}"]').getBoundingClientRect();
    const b = document.querySelector('.tev[data-key=${JSON.stringify(block.key)}]').getBoundingClientRect();
    return { getBoundingClientRect: () => ({ left: c.left, width: c.width, top: b.bottom + 20, height: 0 }) }; })()`);
const wk1 = fm(await entryText(block.title), 'start');
eq('in the week a block moves to the column it is dropped in', (await ev(`(() => {
  const d = new Date(${JSON.stringify(wk1)});
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
})()`)), block.to);
eq('keeping its time wherever in the column it lands', await hourOf(wk1), await hourOf(wk0));

// ---- 7. what a saved task actually writes ------------------------------------------------------

await viewport(900);

const saveTask = async (title, important) => {
  await open();
  await newEntry();
  await click(0);
  await sleep(250);
  if (important) { await flag(2); await sleep(250); }
  await openRow('title');
  await typeIn('title', title);
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

const plain = await saveTask('Check the defaults');
ok('a saved task is todo', /\nstage: todo\n/.test(plain), plain.split('---')[1]);
// The field is gone, so nothing may write the key - not even the default it used to carry.
ok('and carries no estimate key', !/estimate:/.test(plain), plain.split('---')[1]);

// Importance: only `true` is ever written, and an ordinary task carries no key at all rather
// than `important: false`.
ok('an ordinary task writes no important key', !/important:/.test(plain),
  plain.split('---')[1]);
const marked = await saveTask('Check an important task', true);
ok('an important task writes important: true', /\nimportant: true\n/.test(marked),
  marked.split('---')[1]);

// An event carries the same key, written by the same control: the `!` is on every entry now,
// and `important` is no longer one of the keys `type` decides.
const markedEvent = await (async () => {
  await open();
  await newEntry();
  await flag(1);                                 // on an event the `!` follows all-day
  await sleep(250);
  await openRow('title');
  await typeIn('title', 'Check an important event');
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
    const f = all.find(f => (f.text || '').includes('Check an important event'));
    return f ? f.text : 'not written';
  })()`);
})();
ok('an important event writes the same key', /\nimportant: true\n/.test(markedEvent),
  markedEvent.split('---')[1]);
ok('and no stage with it', !/stage:/.test(markedEvent), markedEvent.split('---')[1]);
// `important: true` in a file reaches the toggle row lit. Read through the popup rather than
// off a card, so the check does not depend on which sprint today happens to fall in.
await viewport(900);
await open();
const importantIn = async title => {
  await ev(`[...document.querySelectorAll('.eline')]
    .find(l => l.textContent.includes(${JSON.stringify(title)})).click()`);
  await sleep(500);
  const g = (await ev(FLAGS))[2] || '';
  await closeForm();
  return g.includes('@');
};
eq('important: true in a file reads as important',
  await importantIn('Review the open pull requests'), true);
eq('and a task without the key does not', await importantIn('Deploy the release'), false);

// ---- 8. the shared renderer, and discarding an edit ---------------------------------------------

// The renderer builds nodes and never markup, so a body carrying a script tag shows that tag as
// text and adds nothing to the document. That is the check that keeps it so.
await viewport(900);
await open();
await newEntry();
await openRow('body');
const BODY = ['## Agenda', '- rollout dates', '- [x] token scope', '- [ ] dns cutover',
  '**blocker** here and `code`', '[spec](https://example.com/spec)',
  '[bad](javascript:alert(1))', '<script>alert(1)</script>'].join('\n');
eq('the body opens a textarea in its own row', await ev(
  `!!document.querySelector('#f-rows [data-field="body"] textarea')`), true);
await typeIn('body', BODY);
await openRow('title');
await typeIn('title', 'Rendered body');
await ev(`document.querySelector('#entry-form').requestSubmit()`);
await sleep(1400);

// Found by title rather than by position: it is the fixture's newest entry, not its first.
await ev(`[...document.querySelectorAll('.eline')]
  .find(l => l.textContent.includes('Rendered body')).click()`);
await sleep(500);
const md = await ev(`(() => {
  const b = document.querySelector('#f-rows .vbody');
  const boxes = [...b.querySelectorAll('input[type=checkbox]')];
  return { heads: [...b.querySelectorAll('.md-h')].map(h => h.textContent),
    items: b.querySelectorAll('li').length,
    boxes: boxes.map(i => i.checked), pressable: boxes.filter(i => !i.disabled).length,
    strong: [...b.querySelectorAll('strong')].map(n => n.textContent),
    code: [...b.querySelectorAll('code')].map(n => n.textContent),
    links: [...b.querySelectorAll('a')].map(a => a.getAttribute('href')),
    scripts: b.querySelectorAll('script').length,
    text: b.textContent };
})()`);
eq('a body renders its heading', md.heads, ['Agenda']);
ok('and its list items', md.items >= 3, `${md.items} items`);
eq('a checklist renders ticked and unticked', md.boxes, [true, false]);
eq('and neither box is pressable', md.pressable, 0);
eq('bold renders bold', md.strong, ['blocker']);
eq('and inline code renders code', md.code, ['code']);
eq('a safe link becomes one, and a javascript: URL does not', md.links,
  ['https://example.com/spec']);
ok('the unsafe one stays text', md.text.includes('javascript:alert(1)'), md.text);
eq('and no script element is added', md.scripts, 0);
ok('a script tag shows as text', md.text.includes('<script>alert(1)</script>'), md.text);
// Shown in full and rendered when the row is closed, which is the one thing the old preview
// existed for: a clipped line here is the body flattened into a row like the other five.
ok('and the whole body is shown, not a clipped line',
  md.text.includes('dns cutover') && md.text.includes('spec'), md.text);
await closeForm();

// ---- 8b. Enter closes the row, and the lean body row -----------------------------------------
// Enter in a row's editor used to submit the form, which saved the entry and closed the popup:
// the key that ends a word committed the lot and left the calendar. It closes the row instead,
// and the draft keeps what was typed, the editor having written into it all along. A real press
// through CDP, because implicit submission is native and a synthetic event cannot trigger it.
await open();
await newEntry();
const q0 = await queueSize();
await typeIn('title', 'Enter closes the row');
await pressEnter('#f-rows [data-field="title"] input');
const afterEnter = await ev(`({
  popup: !document.querySelector('#popup').hidden,
  editors: document.querySelectorAll('#f-rows input, #f-rows textarea').length,
  title: document.querySelector('#f-rows [data-field="title"] .ftap').textContent })`);
eq('Enter leaves the popup open', afterEnter.popup, true);
eq('and closes the row it was pressed in', afterEnter.editors, 0);
eq('and the draft keeps what was typed', afterEnter.title, 'Enter closes the row');
eq('and nothing was written', await queueSize(), q0);

// The body row, open: no label and no hint of its own, the row's own DETAILS header being the
// one name it needs - and the textarea carries that name unseen, for a screen reader.
await openRow('body');
const bodyOpen = await ev(`({
  labels: document.querySelectorAll('#f-rows [data-field="body"] label, '
    + '#f-rows [data-field="body"] small').length,
  text: document.querySelector('#f-rows [data-field="body"]').textContent,
  aria: document.querySelector('#f-rows [data-field="body"] textarea')
    .getAttribute('aria-label') })`);
eq('the open body row carries no label or hint of its own', bodyOpen.labels, 0);
ok('and no raw-markdown line', !/raw markdown/i.test(bodyOpen.text), bodyOpen.text);
ok('nor a second name for the field', !/notes/i.test(bodyOpen.text), bodyOpen.text);
eq('the textarea is named for a screen reader', bodyOpen.aria, 'Details');

// Shift+Enter is handed back to the browser, so it does in the textarea what it always did.
await ev(`(() => {
  const t = document.querySelector('#f-rows [data-field="body"] textarea');
  t.value = 'first';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.focus();
  t.setSelectionRange(5, 5);
})()`);
await pressEnter('#f-rows [data-field="body"] textarea', true);
const shifted = await ev(`(() => {
  const t = document.querySelector('#f-rows [data-field="body"] textarea');
  return { open: !!t, value: t ? t.value : null };
})()`);
eq('Shift+Enter leaves the body row open', shifted.open, true);
eq('and puts a new line in the textarea', shifted.value, 'first\n');

// Plain Enter in the textarea closes the row like any other, and what was typed is in the draft.
await pressEnter('#f-rows [data-field="body"] textarea', false);
const bodyClosed = await ev(`({
  editor: !!document.querySelector('#f-rows [data-field="body"] textarea'),
  popup: !document.querySelector('#popup').hidden,
  shown: document.querySelector('#f-rows .vbody').textContent })`);
eq('Enter closes the body row too', bodyClosed.editor, false);
eq('with the popup still open', bodyClosed.popup, true);
ok('and the draft keeps the text', /first/.test(bodyClosed.shown), bodyClosed.shown);

// The boundary the one listener draws: `#fpop` is outside `#f-rows`, so Enter in a field's own
// popup is not the row's Enter. The when stays open, and nothing is submitted. Its typed box is
// the input a field popup holds - `1` alone is not a date, so the box keeps the step rather
// than advancing, which is what leaves the popup open to be read.
await tapRow('when');
await pressDigit('1');
await pressEnter('#fpop input');
eq('Enter in a field popup leaves it open', await ev(
  `!document.querySelector('#fpop').hidden`), true);
eq('and the entry popup too', await ev(`!document.querySelector('#popup').hidden`), true);
await closeForm();

// A repeating entry's scope pair rebuilds the draft from the other file, which must rebuild the
// baseline a discard is measured against too: switching scope and leaving changed nothing, so
// nothing may be asked. This is the check for a baseline left behind as undefined, which reads
// as dirty for the rest of the popup's life.
await open();
await ev(`${REPEATING}.click()`);
await sleep(500);
// The pair rides in the top row beside the type marker, reading `this` and `all` - short because
// that row also holds the trashcan, the disk and the x, and type-neutral because the entry behind
// it is a task as often as an event. Nothing about repeating is left among the rows.
const rep = await ev(`(() => {
  const mid = n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
  const segs = [...document.querySelectorAll('#f-icons .seg')];
  return {
    pair: segs.map(b => b.textContent),
    aria: segs.map(b => b.getAttribute('aria-label')),
    afterType: document.querySelector('#f-icons .ib')
      .compareDocumentPosition(document.querySelector('#f-icons .btngroup')) & 4
        ? 'after' : 'before',
    oneLine: Math.abs(mid(segs[0])
      - mid(document.querySelector('#f-icons [aria-label="Close"]'))) <= 1,
    rows: document.querySelector('#f-rows').textContent,
    inRows: document.querySelectorAll('#f-rows .seg, #f-rows .scope').length };
})()`);
eq('a repeating entry carries the scope pair in its top row', rep.pair, ['this', 'all']);
eq('named in full for a screen reader', rep.aria, ['This occurrence', 'All occurrences']);
eq('right of the type marker', rep.afterType, 'after');
eq('and on one line with the x, not wrapped below it', rep.oneLine, true);
eq('nothing of it is left among the rows', rep.inRows, 0);
ok('no row says the entry repeats', !/repeating/i.test(rep.rows), rep.rows);
ok('and no skip link is left', !/skip this one/i.test(rep.rows), rep.rows);
// The narrowest screen is where the top row has to hold: `.iconbar` wraps, so a pair that
// stretched would put the trashcan and the x on a line of their own. The entry popup is not one
// of the dropdowns a resize closes, so this is the same popup, measured narrower.
await viewport(360);
await sleep(300);
eq('and still on one line at phone width', await ev(`(() => {
  const mid = n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
  return Math.abs(mid(document.querySelector('#f-icons .seg'))
    - mid(document.querySelector('#f-icons [aria-label="Close"]'))) <= 1;
})()`), true);
await viewport(900);
await sleep(300);
// Switching scope rebuilds the draft from the other file, so it has to retake the baseline too:
// a baseline left behind puts a disk in an untouched popup and makes every way out ask about
// changes nobody made.
await ev(`document.querySelector('#f-icons [aria-label="All occurrences"]').click()`);
await sleep(400);
eq('switching scope alone leaves no disk showing', await hasDisk(), false);
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('and asks nothing', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

// ---- 8c. the trashcan on a repeating entry reads the pair beside it --------------------------
// `skip this one` is gone and the trashcan is the skip, which of the two it does being the pair
// in the row with it. Both ask first: the skip is reached from a red trashcan now, not a link,
// and it takes an override file with it. These run last of the repeating checks, because the
// second of them deletes the fixture's only rule file.
await open();
await stubConfirm(true);
await ev(`${REPEATING}.click()`);
await sleep(500);
eq('the pair opens on this occurrence', await ev(
  `document.querySelector('#f-icons [aria-label="This occurrence"]')
    .getAttribute('aria-pressed')`), 'true');
eq('so the trashcan offers to skip the one', await ev(
  `!!document.querySelector('#f-icons [aria-label="Skip this occurrence"]')`), true);
await ev(`document.querySelector('#f-icons [aria-label="Skip this occurrence"]').click()`);
await sleep(1000);
const skipAsked = (await asked())[0] || '';
ok('and asks before it writes', /^Skip "Water the plants" on \d{4}-\d{2}-\d{2}\?$/.test(skipAsked),
  skipAsked);
const skipped = await seriesFile();
ok('the rule file is still there', skipped !== 'gone', skipped);
ok('and gained an exdate for the occurrence',
  /\nexdate:\n\s+- \d{4}-\d{2}-\d{2}\n/.test(skipped), skipped.split('---')[1]);
eq('and the popup closed, nothing being left to look at', await ev(
  `document.querySelector('#popup').hidden`), true);

// `all` is what the trashcan always did on a repeating entry: the rule file goes, and the
// question still warns that override files do not.
await open();
await stubConfirm(true);
await ev(`${REPEATING}.click()`);
await sleep(500);
await ev(`document.querySelector('#f-icons [aria-label="All occurrences"]').click()`);
await sleep(400);
eq('picking all turns the trashcan into a delete', await ev(
  `!!document.querySelector('#f-icons [aria-label="Delete every occurrence"]')`), true);
await ev(`document.querySelector('#f-icons [aria-label="Delete every occurrence"]').click()`);
await sleep(1000);
const delAsked = (await asked())[0] || '';
ok('which asks about the whole entry', /whole repeating entry/.test(delAsked), delAsked);
ok('and still warns about the override files', /override files stay behind/.test(delAsked),
  delAsked);
eq('and the rule file is gone', await seriesFile(), 'gone');

// Leaving a popup that holds unsaved changes asks first - and only then. The x, the backdrop and
// Escape are one way out and ask one question.
await open();
await newEntry();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(300);
eq('an untouched popup closes with no prompt', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

const dirty = async () => {
  await open();
  await newEntry();
  await typeIn('title', 'Half written');
};
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('a changed one asks before discarding', await ev(
  `!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(300);
eq('keep editing leaves the popup open', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, false]);
eq('with the change still in it', await ev(
  `document.querySelector('#f-rows [data-field="title"] input').value`), 'Half written');

// The backdrop and Escape take the same way out, so they ask the same question.
await ev(`document.querySelector('#popup').click()`);
await sleep(350);
eq('the backdrop asks too', await ev(`!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-keep').click()`);
await sleep(250);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(350);
eq('and so does Escape', await ev(`!document.querySelector('#ask').hidden`), true);

// Ticking it silences the prompt on this device, and the settings panel's row is what puts it
// back - nothing in Mine may be switched off from a place that cannot switch it back on.
await ev(`document.querySelector('#ask-never').click()`);
await sleep(100);
await ev(`document.querySelector('#ask-discard').click()`);
await sleep(400);
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('don\'t ask again stops the prompt', await ev(
  `[document.querySelector('#ask').hidden, document.querySelector('#popup').hidden]`),
  [true, true]);

await menu('settings');
eq('and the panel has a row to put it back', await ev(`(() => {
  const r = [...document.querySelectorAll('#settings-body .srow')]
    .find(r => /confirm discard/i.test(r.querySelector('.slab').textContent));
  return r ? r.querySelector('input[type=checkbox]').checked : 'no row';
})()`), false);
await ev(`[...document.querySelectorAll('#settings-body .srow')]
  .find(r => /confirm discard/i.test(r.querySelector('.slab').textContent))
  .querySelector('input[type=checkbox]').click()`);
await sleep(500);
await ev(`document.querySelector('#settings-close').click()`);
await sleep(250);
await dirty();
await ev(`document.querySelector('#f-icons [aria-label="Close"]').click()`);
await sleep(350);
eq('and turning it back on restores it', await ev(
  `!document.querySelector('#ask').hidden`), true);
await ev(`document.querySelector('#ask-discard').click()`);
await sleep(300);

// ---- 7. the logs ---------------------------------------------------------------------------
// A queue that cannot drain was the one state the app could not explain: the count was the whole
// of what it said, and the reason was written to that same line and overwritten by the next
// focus. The fake token means every drain in here fails, which is the state to check.

await viewport(320);
await seedQueue(14, 'calendar/2026/04/2026-04-18-0900-');
await open();                                  // the queue is retried by the boot itself

const line = await ev(`(() => { const s = document.querySelector('#sync');
  return [s.tagName, s.textContent, s.classList.contains('bad')]; })()`);
eq('the sync line is a button', line[0], 'BUTTON');
ok('opening with a queue retries it rather than just reporting a count',
  /not pushed/.test(line[1]), `the line reads "${line[1]}"`);
ok('and says where to look', /tap for details/.test(line[1]), line[1]);
ok('and reads as an error', line[2]);

await ev(`document.querySelector('#sync').click()`);
await sleep(400);
const logs = await ev(`(() => {
  const p = document.querySelector('#logs-panel');
  if (p.hidden) return 'hidden';
  const l = p.querySelector('.lline');
  const r = p.querySelector('.lrow');
  return {
    state: p.querySelector('.srow .slab').textContent,
    actions: [...p.querySelectorAll('.srow .link')].map(b => b.textContent),
    head: l ? l.textContent : 'no line',
    bad: !!p.querySelector('.lline.bad'),
    rows: p.querySelectorAll('.lrow').length,
    cells: r ? [...r.children].map(c => c.className.split(' ')[0]) : [],
    age: p.querySelector('.lage') ? p.querySelector('.lage').textContent : ''
  };
})()`);
ok('the sync line opens the logs', logs !== 'hidden', 'the panel stayed hidden');
eq('which name what is pending', logs.state, '14 change(s) pending');
eq('and offer the two ways out', logs.actions, ['push now', 'discard all']);
ok('the last attempt says what it failed with', /failed/.test(logs.head), logs.head);
ok('and reads as an error', logs.bad);
eq('one line per queued change', logs.rows, 14);
eq('each one its kind, its path and its age', logs.cells, ['lop', 'lpath', 'lage']);
ok('with a real age on it', /^(just now|\d+[mhd])$/.test(logs.age), `the age reads "${logs.age}"`);
const overLogs = await ev(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
ok('the panel fits a 320px phone with a backlog in it', overLogs === 0, `overflows by ${overLogs}px`);
await shoot('logs');

// One row, not a history: the same failure repeated is counted, because it is retried on every
// window focus and twenty copies of one 403 would bury the attempt that explains it.
const before = await kv('sync.last');
await ev(`[...document.querySelectorAll('#logs-panel .link')]
  .find(b => b.textContent === 'push now').click()`);
await sleep(2500);
const after = await kv('sync.last');
eq('push now retries, and a repeat is counted rather than appended',
  [after.op, after.outcome, after.count > before.count], ['drain', 'failed', true]);

// The one control in Mine that can lose work. It also has to repair the mirror: the queued text
// sits in `files` under the blob SHA it was based on, which a later pull would compare as equal
// and skip forever, so the paths are forgotten and the ETag dropped.
await ev(`window.confirm = () => true; true`);
await ev(`[...document.querySelectorAll('#logs-panel .link')]
  .find(b => b.textContent === 'discard all').click()`);
await sleep(2500);
eq('discard all empties the queue', await queueSize(), 0);
eq('and drops the ETag, so the next pull restores those paths', await kv('commitEtag'), null);
eq('and the panel says so, with nothing left waiting', await ev(
  `[document.querySelector('#logs-panel .srow .slab').textContent,
    document.querySelectorAll('#logs-panel .lrow').length]`), ['in sync', 0]);

report('calendar');
