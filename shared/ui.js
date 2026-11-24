// The chrome every app in Mine builds its screens out of: DOM helpers, the icon set, the
// overlay mechanisms, and the settings row. Its stylesheet is the shared base, ../style.css.
//
// An app imports what it needs from here and adds its own on top - the calendar's icons, its
// state object, its views. Nothing in this file knows about any one app.

export const $ = s => document.querySelector(s);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const phone = () => !matchMedia('(min-width: 600px)').matches;

// ---- icons ---------------------------------------------------------------------------------
// Hand-drawn on a 16x16 box. No icon font and no CDN: the CSP allows neither, and an inline
// path cannot fail to load.
//
// What is in here is the vocabulary shared across Mine - the verbs every app needs, and the two
// conventions REQUIREMENTS.md states for all of them: a save is a green disk and a trashcan is a
// red trashcan. A second app drawing its own trashcan path is how that convention would quietly
// stop being one. An app's own subjects - the calendar's recurrence, its stages - are registered
// by that app with addIcons().

const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  trash:  { d: 'M6.2 1.6h3.6l.6 1.2h2.8v1.5H2.8V2.8h2.8l.6-1.2zM3.9 5.6h8.2l-.7 8.8H4.6z' },
  disk:   { d: 'M2.6 2h8.2L14 5.2V14H2.6zm3 0v3.6h4.6V2zM5 9h6v5H5z' },
  pen:    { d: 'M11.6 1.8l2.6 2.6-8 8-3.4.8.8-3.4z' },
  plus:   { d: 'M8 3v10M3 8h10', stroke: 1.8 },
  x:      { d: 'M4 4l8 8M12 4l-8 8', stroke: 1.8 },
  chev:   { d: 'M10 3.5 5.5 8l4.5 4.5', stroke: 1.8 },
  // Three lines of text: a details row, or a markdown body. Every app keeps one.
  lines:  { d: 'M3 4.6h10M3 8h10M3 11.4h6.4', stroke: 1.6 },
  // Three lines of equal length for the hamburger, so `lines` keeps meaning details and no icon
  // means two things.
  menu:   { d: 'M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2', stroke: 1.6 },
  // A clock face for the logs: the panel's subject is when the last attempt ran and how long the
  // queue has been waiting. A stack of lines would read as details, which `lines` already means.
  logs:   { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6zM8 5.1V8.3l2.5 1.6', stroke: 1.5 },
  house:  { d: 'M8 1.9 1.5 7.4h1.8V14h3.3V9.9h2.8V14h3.3V7.4h1.8z' },
  gear:   { d: 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM7.1 1.4h1.8l.3 1.7 1.2.5 1.4-1 1.3 1.3-1 1.4.5 1.2 1.7.3v1.8l-1.7.3-.5 1.2 1 1.4-1.3 1.3-1.4-1-1.2.5-.3 1.7H7.1l-.3-1.7-1.2-.5-1.4 1-1.3-1.3 1-1.4-.5-1.2-1.7-.3V7.1l1.7-.3.5-1.2-1-1.4 1.3-1.3 1.4 1 1.2-.5z', stroke: 1.2 }
};

// An app's own icons, merged in at module load. A name already here is overwritten, which is the
// only way an app could redraw a shared convention - so don't.
export const addIcons = table => Object.assign(ICON, table);

export function icon(name) {
  const spec = ICON[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', spec.d);
  if (spec.stroke) {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', String(spec.stroke));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else {
    p.setAttribute('fill', 'currentColor');
    // A second subpath drawn inside the first is a hole rather than an overlap: the one way an
    // icon can be a filled shape with a figure knocked out of it, which is what a stage reading
    // its colour as a fill needs.
    if (spec.rule) p.setAttribute('fill-rule', spec.rule);
  }
  svg.append(p);
  return svg;
}

// `name` is an icon name, or any other string to use as a glyph. An icon row is icons
// throughout; a `24h` or a `!` is a character, because there is no icon for either.
export function iconBtn(name, label, cls = '') {
  const b = el('button', ['ib', cls].filter(Boolean).join(' '));
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(ICON[name] ? icon(name) : el('span', 'glyph', name));
  return b;
}

// ---- overlays ------------------------------------------------------------------------------
// Three mechanisms. `openPop` hangs a dropdown off the button that opened it. `openCentred` is a
// panel or a preview, centred by the stylesheet and only unhidden. `openRowPop` is the third and
// the odd one: a field's popup inside a modal, which carries **no scrim**, so the tap that
// dismisses it still reaches the row it landed on and moving from one field to the next is one
// tap rather than two. That is the whole reason it is not one of the other two.
//
// `#scrim` is a convention: an app that opens overlays has one, and the base stylesheet styles
// it. The pops an app closes together are the ones it registers.

let POPS = [];

// Every overlay this app closes with closePops(), as selectors. Called once, at boot.
export const registerPops = selectors => { POPS = selectors; };

export const openCentred = pop => { pop.hidden = false; $('#scrim').hidden = false; };

// Under the thing that opened it, flipped above when there is no room below - a row near the
// foot of a long modal is the case that needs it.
function place(pop, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = align === 'right' ? r.right - w : r.left;
  pop.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  const below = r.bottom + 6;
  const above = r.top - 6 - h;
  pop.style.top = `${below + h > innerHeight - 8 && above > 8 ? above : below}px`;
}

// The anchors currently reading as expanded, so closePops can put them back without being told
// which buttons an app has.
const expanded = new Set();

export function openPop(pop, anchor, align = 'left') {
  pop.hidden = false;
  $('#scrim').hidden = false;
  place(pop, anchor, align);
  anchor.setAttribute?.('aria-expanded', 'true');
  expanded.add(anchor);
}

export function openRowPop(pop, anchor) {
  pop.hidden = false;
  place(pop, anchor, 'left');
}

export function closePops() {
  for (const id of [...POPS, '#scrim']) {
    const n = $(id);
    if (n) n.hidden = true;
  }
  for (const a of expanded) a.setAttribute?.('aria-expanded', 'false');
  expanded.clear();
}

// ---- settings rows -------------------------------------------------------------------------
// Two halves: the label on the left, its control on the right, so the controls line up in one
// column however long a label is. A unit shares the right half with its control rather than
// dropping below it, which is the one place a row would otherwise go ragged.

export function row(label, control, suffix) {
  const r = el('div', 'srow');
  r.append(el('span', 'slab', label));
  if (!suffix) r.append(control);
  else {
    const v = el('div', 'sval');
    v.append(control, el('span', 'ssuf', suffix));
    r.append(v);
  }
  return r;
}

export function choose(options, current, onChange) {
  const s = el('select');
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = String(v);
    if (String(v) === String(current)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function toggle(current, onChange) {
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!current;
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}

export function numberField(current, min, onChange) {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.value = String(current);
  i.addEventListener('change', () => {
    const n = Number(i.value);
    if (Number.isInteger(n) && n >= min) onChange(n); else i.value = String(current);
  });
  return i;
}

export function dateField(current, onChange) {
  const i = el('input');
  i.type = 'date';
  i.value = current;
  i.addEventListener('change', () => { if (i.value) onChange(i.value); });
  return i;
}
