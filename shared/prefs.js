// Theme and date format belong to Mine, not to any one app: the main settings and each app's
// show the same two rows, so both read and write these keys.
import { getKV, setKV } from './store.js';

export const THEMES = ['system', 'light', 'dark'];
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
// overrides that with.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
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
