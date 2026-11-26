// One press-and-drag for the calendar: a card between stages, an entry between days, and the top
// pane between the top and the bottom of the screen all go through here.
//
// Pointer events rather than HTML5 drag and drop, which never fires for a finger. A finger picks
// up by **holding still** for HOLD ms - moving before then is a scroll and is left to the browser,
// so a grid or a column scrolls exactly as it did. A mouse picks up by moving a few pixels, as a
// desktop drag always has; `hold: 'always'` makes a mouse hold too, for the pane, whose every
// pixel is a button and where a sloppy click must stay a click.
//
// While something is held, a copy of it follows the pointer, the target under it is marked
// `drop-on`, the page does not scroll under the finger, and holding near the top or bottom edge of
// whatever scrolls scrolls it. Releasing drops; a cancelled gesture drops nothing. The click a
// release would otherwise send is swallowed, so dropping a card does not also open it.
const HOLD = 400, SLOP = 8, MOUSE_SLOP = 5, EDGE = 48;

let st = null;

// A finger that is holding something must not also scroll the page. Registered once and not
// passive, because a passive listener cannot cancel; it does nothing unless a drag is live.
addEventListener('touchmove', e => { if (st?.live) e.preventDefault(); }, { passive: false });
addEventListener('contextmenu', e => { if (st) e.preventDefault(); });

// item(node)        the element a press on `node` picks up, or null
// target(x, y)      the drop target under the point, or null
// drop(el, target)  what releasing on a target does
// start(el), end()  optional: set up and take down anything shown while dragging
export function draggable(host, { item, target, drop, start, end, hold = 'touch', axis, scroll = true }) {
  host.addEventListener('pointerdown', e => {
    if (st || e.button !== 0) return;
    const el = item(e.target);
    if (!el) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse) e.preventDefault();          // no text selection under a mouse drag
    st = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      live: false, over: null, opts: { target, drop, start, end, axis, scroll } };
    if (!mouse || hold === 'always') st.timer = setTimeout(lift, HOLD);
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', cancel, true);
  });
}

function move(e) {
  if (e.pointerId !== st.id) return;
  st.x = e.clientX; st.y = e.clientY;
  if (!st.live) {
    const d = Math.hypot(st.x - st.x0, st.y - st.y0);
    if (st.timer) { if (d > SLOP) finish(false); return; }   // moved before the hold: a scroll
    if (d < MOUSE_SLOP) return;
    lift();
  }
  e.preventDefault();
  follow();
}

function lift() {
  st.timer = null;
  st.live = true;
  const r = st.el.getBoundingClientRect();
  st.off = [st.x0 - r.left, st.y0 - r.top];
  const g = st.el.cloneNode(true);
  g.classList.add('drag-ghost');
  g.removeAttribute('id');
  Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px` });
  document.body.append(g);
  st.ghost = g;
  st.el.classList.add('dragging');
  st.scroller = st.opts.scroll ? scrollerOf(st.el) : null;
  st.opts.start?.(st.el);
  navigator.vibrate?.(10);
  follow();
  if (st.scroller) st.raf = requestAnimationFrame(edgeScroll);
}

function follow() {
  const { ghost, off, opts } = st;
  if (opts.axis !== 'y') ghost.style.left = `${st.x - off[0]}px`;
  ghost.style.top = `${st.y - off[1]}px`;
  const t = opts.target(st.x, st.y);
  if (t !== st.over) {
    st.over?.classList.remove('drop-on');
    t?.classList.add('drop-on');
    st.over = t;
  }
}

function scrollerOf(n) {
  for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

function edgeScroll() {
  if (!st?.live) return;
  const s = st.scroller;
  const [top, bottom] = s === document.scrollingElement ? [0, innerHeight]
    : [s.getBoundingClientRect().top, s.getBoundingClientRect().bottom];
  const dy = st.y < top + EDGE ? -(top + EDGE - st.y) / 3
    : st.y > bottom - EDGE ? (st.y - bottom + EDGE) / 3 : 0;
  if (dy) { s.scrollBy(0, dy); follow(); }
  st.raf = requestAnimationFrame(edgeScroll);
}

const up = e => { if (e.pointerId === st.id) finish(true); };
const cancel = e => { if (e.pointerId === st.id) finish(false); };

function finish(dropping) {
  const s = st;
  st = null;
  clearTimeout(s.timer);
  cancelAnimationFrame(s.raf);
  removeEventListener('pointermove', move, true);
  removeEventListener('pointerup', up, true);
  removeEventListener('pointercancel', cancel, true);
  if (!s.live) return;
  s.ghost.remove();
  s.el.classList.remove('dragging');
  s.over?.classList.remove('drop-on');
  s.opts.end?.();
  // The release is not a click on whatever it lands on. A finger's click can trail the release,
  // so the first click within a moment is the one swallowed, and only that one.
  const swallow = e => { e.stopPropagation(); e.preventDefault(); off(); };
  const off = () => removeEventListener('click', swallow, true);
  addEventListener('click', swallow, true);
  setTimeout(off, 400);
  if (dropping && s.over) s.opts.drop(s.el, s.over);
}
