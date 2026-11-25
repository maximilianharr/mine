# Working in this repo

No build step, no dependencies, no CI. `python3 -m http.server` to run it, `test/run.sh` to check
it. Everything else below is about finding things without reading the whole repo into context.

## Searching

**Always exclude `.claude`, `.entire` and `shared/vendor` from recursive searches.** They are 65 MB
of gitignored material — a stray copy of the home Claude config, the Entire checkpoint store, and
two vendored libraries — and a bare `grep -r` or `find .` sweeps all of it. Use `git grep`, which
sees tracked files only and is the right default here.

## What is big, and what to do about it

Reading the whole project costs ~140k tokens. Four files are half of that, so read none of them
whole — `git grep -n` for the symbol or the rule, then `sed -n 'A,Bp'` the range you need.

| | lines | ~tokens | |
| --- | --- | --- | --- |
| `test/check-calendar.mjs` | 2172 | 29k | the browser suite; 73% of all test bytes |
| `calendar/popup.js` | 1368 | 15k | the entry popup, its rows and its four field editors |
| `calendar/REQUIREMENTS.md` | 987 | 16k | |
| `TEST-REQUIREMENTS.md` | 575 | 11k | |

The rest of the source is 350 lines or under and is fine to read whole.

## The docs are reference, not reading

Four of them, ~40k tokens combined: `REQUIREMENTS.md` (what Mine does) and
`TECHNICAL-REQUIREMENTS.md` (how it is built) at the root, and the same pair under `calendar/` for
that app. `TEST-REQUIREMENTS.md` says what is checked and why.

They are written as prose with the reasoning kept in, which is what makes them worth having and
also what makes them expensive. **Grep them for the rule you need; do not read one to get oriented.**
They are also normative: a change that contradicts one is a change to that doc as well.

## Screenshots

`test/run.sh --shot DIR` writes a PNG per view. When several are wanted for a visual judgement,
compose them into **one** contact sheet at ~900px wide and look at that once. A full-resolution
screenshot costs ~3k tokens to read; eight of them cost more than the entire calendar app.

## Conventions worth knowing before editing

- A save is a green disk, a trashcan is a red trashcan, the `x` is rightmost in every popup.
  Nothing in Mine is a filled green button.
- Icons are outlines on a 16×16 box, drawn in `shared/ui.js` (shared verbs) and `calendar/ui.js`
  (that app's own subjects). No icon font, no CDN — the CSP forbids both.
- There are no web fonts, for the same reason: `--serif`, `--sans` and `--mono` in `style.css` are
  system stacks.
- A colour that must hold in both themes cannot be a hex in JavaScript. Declare it as a custom
  property and hand out `var(--name)`; see `STAGE_COLOR` in `calendar/ui.js`.
- `style.css` is shared by every app; an app's own stylesheet loads after it and holds only what
  is its own.
