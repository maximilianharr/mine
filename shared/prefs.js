// Theme and date format belong to Mine, not to any one app: the main settings and each app's
// show the same two rows, so both read and write these keys.
import { getKV, setKV } from './store.js';

export const THEMES = ['system', 'light', 'coffee', 'dark', 'neutral'];
export const DATE_FORMATS = ['auto', 'dd.mm.yyyy', 'mm/dd/yy'];

export async function loadPrefs() {
  const [theme, dateFormat] = await Promise.all([getKV('mine.theme'), getKV('mine.dateFormat')]);
  return {
    theme: THEMES.includes(theme) ? theme : 'system',
    dateFormat: DATE_FORMATS.includes(dateFormat) ? dateFormat : 'auto'
  };
}

export const setPref = (key, value) => setKV(`mine.${key}`, value);

// 'system' means leave it to prefers-color-scheme; the attribute is what the stylesheet
// overrides that with. A pinned theme also pins the phone's bar to its page colour; 'system'
// hands the bar back to the two media-keyed tags in the page.
export function applyTheme(theme) {
  const root = document.documentElement;
  const pinned = theme !== 'system' && THEMES.includes(theme);
  if (pinned) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.dataset.own ??= m.content;
    m.content = pinned ? bg : m.dataset.own;
  }
}

// A bare 'YYYY-MM-DD' in the chosen format. 'auto' follows the device's locale. Parsed at
// local noon: a bare date is a calendar date and must not be shifted by a zone.
export function formatDate(key, fmt = 'auto', opts) {
  const [y, m, d] = String(key).split('-');
  if (fmt === 'dd.mm.yyyy') return `${d}.${m}.${y}`;
  if (fmt === 'mm/dd/yy') return `${m}/${d}/${y.slice(2)}`;
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined,
    opts || { day: 'numeric', month: 'short', year: 'numeric' });
}

export const weekdayName = (key, style = 'long') =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: style });

// The same date two characters shorter: a two-digit year, in the chosen format. The entry
// popup's when-row carries two readings on one line - a start and an end - and the short year
// is what buys the room for the second.
export function shortDate(key, fmt = 'auto') {
  const [y, m, d] = String(key).split('-');
  if (fmt === 'dd.mm.yyyy') return `${d}.${m}.${y.slice(2)}`;
  if (fmt === 'mm/dd/yy') return `${m}/${d}/${y.slice(2)}`;
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined,
    { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ---- a date as it is typed ------------------------------------------------------------------
// A date typed into a box is read in the order it is read back in, so the format row governs
// both. `auto` asks the locale about a date it cannot misread - 2026-11-19, where 19 can only
// be the day - and takes the order and the separator from the answer.

const FIELDS = { dmy: ['d', 'm', 'y'], mdy: ['m', 'd', 'y'], ymd: ['y', 'm', 'd'] };

export function dateOrder(fmt = 'auto') {
  if (fmt === 'dd.mm.yyyy') return { order: 'dmy', sep: '.' };
  if (fmt === 'mm/dd/yy') return { order: 'mdy', sep: '/' };
  const probe = new Date('2026-11-19T12:00:00').toLocaleDateString(undefined,
    { day: '2-digit', month: '2-digit', year: 'numeric' });
  const parts = probe.split(/\D+/).filter(Boolean);
  const order = parts[0] === '2026' ? 'ymd' : parts[0] === '19' ? 'dmy' : 'mdy';
  return { order, sep: (probe.match(/[.\/-]/) || ['.'])[0] };
}

const pad2 = n => String(n).padStart(2, '0');

export function dateTextOf(key, fmt = 'auto') {
  if (!key) return '';
  const [y, m, d] = String(key).split('-');
  const { order, sep } = dateOrder(fmt);
  return FIELDS[order].map(f => (f === 'y' ? y : f === 'm' ? m : d)).join(sep);
}

export const datePlaceholder = (fmt = 'auto') => {
  const { order, sep } = dateOrder(fmt);
  return FIELDS[order].map(f => (f === 'y' ? 'YYYY' : f === 'm' ? 'MM' : 'DD')).join(sep);
};

// Forgiving in the same way a typed time is: in a day-first format `19.11.2026`, `19.11.26`,
// `19112026`, `191126` and `1911` are all 19 November 2026, the last taking its year from the
// month the picker was showing. Anything that is not a date of the calendar - 31 February, a
// month of 19 where the month comes first - is refused, and the box goes back to the draft.
export function parseDateText(text, fmt = 'auto', ref = '') {
  const t = String(text).trim();
  if (!t) return null;
  const { order } = dateOrder(fmt);
  const names = FIELDS[order];
  let parts = t.split(/\D+/).filter(Boolean);
  if (parts.length === 1) {
    const digits = parts[0];
    if (names[0] === 'y') {
      if (digits.length !== 8) return null;
      parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)];
    } else {
      if (![4, 6, 8].includes(digits.length)) return null;
      parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean);
    }
  }
  if (parts.length === 2 && names[0] === 'y') return null;
  if (parts.length < 2 || parts.length > 3) return null;
  const got = {};
  names.forEach((n, i) => { got[n] = parts[i] ?? ''; });
  const refYear = String(ref).slice(0, 4) || String(new Date().getFullYear());
  const y = got.y === '' ? Number(refYear)
    : got.y.length <= 2 ? 2000 + Number(got.y) : Number(got.y);
  const m = Number(got.m), d = Number(got.d);
  if (!(y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const key = `${y}-${pad2(m)}-${pad2(d)}`;
  // 31 February parses and is not a day, so the answer is checked against the calendar.
  return new Date(`${key}T12:00:00`).getDate() === d ? key : null;
}
