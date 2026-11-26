# Notes — technical requirements

File format for [REQUIREMENTS.md](REQUIREMENTS.md). Sync, caching and writes are in
[../TECHNICAL-REQUIREMENTS.md](../TECHNICAL-REQUIREMENTS.md).

## Paths

```
notes/2026/11/2026-11-26-1430-k3f9.md
```

The calendar's scheme, keyed on the **creation** time in UTC: the repo browses chronologically on
github.com and no folder grows past a month. `-k3f9` is 4 random characters, so two devices
creating notes offline in the same minute never mint the same name. No title slug, so retitling
is never a rename — **the path never changes** after creation. Every `.md` under `notes/` is a
note; there is no settings or tags file.

## Frontmatter

```
---
title: Groceries
created: 2026-11-26T14:30:00Z
updated: 2026-11-26T15:02:11Z
tags:
  - home
  - shopping
---
```

| Key | Notes |
| --- | --- |
| `title` | required by the app |
| `created` | UTC instant to the second, set once when the note is first saved |
| `updated` | UTC instant to the second, set by every save from the app |
| `tags` | a YAML list, lower case, a space written as `-`; omitted when empty |

Written by `shared/md.js`'s `serialize`, so empty keys are omitted, never `None`. **A key the app
does not own survives a save**, and the body is preserved byte-for-byte by anything that does not
edit it.

A file written by hand is read leniently. A missing `updated` falls back to `created`, then to
the date in the path; a missing `title` shows the first `#` heading or the file name; a `tags`
given as a single string is one tag. The grid sorts on `updated`, newest first, with the path as
the tie-break.

## Modules

```
notes/app.js     the whole app: the model, the grid, the popup, the filter, the settings, boot
notes/style.css  the grid, the cards and the popup's rows
```

One module: the app is a fraction of the calendar, and a split into model and views would be
files that import only each other. The model is `buildNotes(files)` — the mirror's `notes/`
files parsed and sorted — and is exported for `test/unit.mjs`.

Everything else is shared: the store and the sync (`shared/store.js`, `github.js`, `sync.js`),
the renderer, the search, the prefs, the icon set and overlays (`shared/ui.js`), and the header
drag (`shared/drag.js`, `dockable()` in `shared/ui.js`). The discard prompt reads and writes
`mine.confirmDiscard`; the dock position is `mine.barPosition`. The filter is `notes.tags` in
`kv`, the ticked tags as a list, `''` standing for `untagged`.

The popup holds a **draft** — title, tags, body — and compares it with the note as opened; the
disk shows when the two differ. A save rewrites the frontmatter it read with the draft's three
fields and a new `updated`, leaving every other key as it was.

## Service worker

`notes` is one entry in `shared/apps.js`, and its files are precached like the calendar's.
