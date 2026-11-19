import yaml from './vendor/js-yaml.mjs';

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// CORE_SCHEMA, never DEFAULT: the default schema parses `start: 2026-04-18` into a JS Date
// at UTC midnight, which is the all-day off-by-one-day bug the format exists to avoid.
export function parse(text) {
  const m = text.match(FM);
  if (!m) return { data: {}, body: text };
  return {
    data: yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) || {},
    body: text.slice(m[0].length)
  };
}

export function serialize(data, body = '') {
  const lines = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue;   // omit, never "None"
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}:`, ...v.map(i => `  - ${scalar(i)}`));
    } else {
      lines.push(`${k}: ${scalar(v)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 _.:+/@-]*$/;
const LOOKS_TYPED = /^(true|false|null|~|-?\d+(\.\d+)?)$/i;

function scalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  const safe = PLAIN.test(s) && !/: |\s$/.test(s) && !LOOKS_TYPED.test(s);
  return safe ? s : JSON.stringify(s);   // valid YAML double-quoted scalar
}
