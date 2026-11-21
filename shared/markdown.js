// One markdown renderer for every app in Mine. Every app keeps its text as markdown, so every
// app has to show it, and two renderers would drift - a note that looked right in the calendar
// and wrong in the zettelkasten would be the plainest sign that these files are not as portable
// as the whole idea claims.
//
// It returns a DOM node and never a string of HTML, so nothing in a body can turn into markup:
// a body carrying a `<script>` tag shows that tag as text and there is no sanitiser to get
// right. That is the threat the CSP is there for, and a data file in your own repo is the
// likeliest thing to hold a stray angle bracket.
//
// What it covers: paragraphs, `#` to `###` headings, bullet and numbered lists, `- [ ]` and
// `- [x]` checkboxes, bold, italic, inline code and links. No tables, no blockquotes, no fenced
// code and no images - each is more code to own for something an agenda or a diary page rarely
// carries, and the app that first genuinely needs one can add it then.

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^[-*+]\s+(.+)$/;
const NUMBER = /^\d+[.)]\s+(.+)$/;
const TASK = /^\[([ xX])\]\s*(.*)$/;

// Bold, italic, code and a link in one pass. `**` is tried before `*`, so the longer marker
// wins. Built fresh per call rather than kept global, because inline() recurses and a shared
// lastIndex would eat its own matches.
const INLINE = String.raw`(\*\*|__)(\S(?:[\s\S]*?\S)?)\1|([*_])(\S(?:[\s\S]*?\S)?)\3|` +
  '`([^`]+)`' + String.raw`|\[([^\]]*)\]\(([^()\s]+)\)`;

// Only a scheme that cannot execute is rendered as a link; anything else stays text, so a
// `javascript:` URL is never something to press.
const SAFE = /^(https?:|mailto:)/i;

const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

// The text of a list item, or null when the line is not one.
const item = line => (line.match(BULLET) || line.match(NUMBER) || [])[1] ?? null;

export function render(text) {
  const out = document.createDocumentFragment();
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      // `#` is an h3: the popup's own title is the heading above it, and a body must not
      // out-shout the thing it belongs to.
      out.append(inline(el(`h${h[1].length + 2}`, 'md-h'), h[2]));
      i++;
      continue;
    }

    if (item(line) !== null) { i = list(out, lines, i); continue; }

    // A paragraph runs to the next blank line, heading or list item, and keeps its newlines:
    // a body typed as lines is read as lines.
    const buf = [];
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || HEADING.test(l) || item(l) !== null) break;
      buf.push(l);
    }
    out.append(inline(el('p', 'md-p'), buf.join('\n')));
  }
  return out;
}

function list(out, lines, i) {
  const list = el(NUMBER.test(lines[i].trim()) ? 'ol' : 'ul', 'md-list');
  for (; i < lines.length; i++) {
    const text = item(lines[i].trim());
    if (text === null) break;
    const li = el('li');
    const task = text.match(TASK);
    if (!task) { list.append(inline(li, text)); continue; }
    // Rendered, not operated: ticking a box is an edit of the text like any other, and a body
    // is read far more often than its checklist is advanced.
    const box = el('input');
    box.type = 'checkbox';
    box.checked = task[1] !== ' ';
    box.disabled = true;
    li.className = 'md-task';
    li.append(box);
    list.append(inline(li, task[2]));
  }
  out.append(list);
  return i;
}

function inline(node, text) {
  const re = new RegExp(INLINE, 'g');
  let last = 0;
  for (let m; (m = re.exec(text));) {
    if (m.index > last) node.append(text.slice(last, m.index));
    if (m[2] != null) inline(node.appendChild(el('strong')), m[2]);
    else if (m[4] != null) inline(node.appendChild(el('em')), m[4]);
    else if (m[5] != null) node.appendChild(el('code', 'md-code')).textContent = m[5];
    else node.append(link(m[6], m[7]));
    last = m.index + m[0].length;
  }
  if (last < text.length) node.append(text.slice(last));
  return node;
}

// A new tab, because leaving the app would lose the view you were in.
function link(text, href) {
  if (!SAFE.test(href)) return `[${text}](${href})`;
  const a = el('a', 'md-a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text || href;
  return a;
}
