# Vendored dependencies

Committed, not loaded from a CDN: the CSP is `script-src 'self'`. Update by downloading the
pinned URL again and committing the result.

| File | Version | Source |
| --- | --- | --- |
| `js-yaml.mjs` | 4.1.0 | https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs |

`rrule` is not vendored yet; it is needed only once the calendar expands recurrence rules.

**Load YAML with `CORE_SCHEMA`, never the default.** The default schema is YAML 1.1 and parses
`start: 2026-04-18` into a JS Date at UTC midnight, which silently shifts all-day entries by a
day east of UTC. `shared/md.js` already does this; anything else reading frontmatter must too.
