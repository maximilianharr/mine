# Vendored dependencies

Committed, not loaded from a CDN: the CSP is `script-src 'self'`. Update by downloading the
pinned URL again and committing the result.

| File | Version | Source |
| --- | --- | --- |
| `js-yaml.mjs` | 4.1.0 | https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs |
| `rrule.mjs` | 2.8.1 | https://cdn.jsdelivr.net/npm/rrule@2.8.1/+esm |
| `tslib.mjs` | 2.6.2 | https://cdn.jsdelivr.net/npm/tslib@2.6.2/+esm |

**Load YAML with `CORE_SCHEMA`, never the default.** The default schema is YAML 1.1 and parses
`start: 2026-04-18` into a JS Date at UTC midnight, which silently shifts all-day entries by a
day east of UTC. `shared/md.js` already does this; anything else reading frontmatter must too.

## rrule

`rrule.mjs` is jsDelivr's bundle of `rrule@2.8.1/dist/esm/index.js`. It is the only vendored
file with an edit: jsDelivr emits a single `import` of its tslib helpers from a CDN path, which
`script-src 'self'` forbids and which would not resolve from disk. That one specifier is
rewritten to a relative import of the tslib bundle beside it:

```
-import{__extends as ne,…}from"/npm/tslib@2.6.2/+esm"
+import{__extends as ne,…}from"./tslib.mjs"
```

Nothing else is changed, and neither file references any other URL. Re-apply that single
substitution when updating. `tslib.mjs` is jsDelivr's bundle of `tslib@2.6.2/tslib.es6.mjs` and
imports nothing.

**rrule works in UTC.** For an all-day rule, `DTSTART` is UTC midnight and the occurrence is
read back with `getUTC*()`; calling `getDate()` on the returned Date gives the previous day east
of UTC. `UNTIL` is written in the `Z` form. `calendar/data.js` is the only caller.
