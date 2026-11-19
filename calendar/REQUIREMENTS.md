# Calendar

Calendar is an app of [Mine](../REQUIREMENTS.md) to manage your calendar. It stores one
entry per markdown file in the data repo and holds no state of its own beyond the shared
cache described in [TECHNICAL-REQUIREMENTS.md](../TECHNICAL-REQUIREMENTS.md).

## Data model

### Paths

```
calendar/2026/04/2026-04-18-1400-k3f9.md     one-off entry
calendar/2026/04/2026-04-25-0000-ov1q.md     occurrence override
calendar/recurring/trash-p7qm.md             entry with a recurrence rule
calendar/groups.md                           group -> colour mapping
```

The date lives in the path, so the Trees API listing alone tells the app which days have
entries, before any file content is downloaded. The `-k3f9` suffix is 4 random characters,
**not** a counter: two devices creating entries offline on the same day must never mint
the same name. No title slug is used, so editing a title is never a rename.

Entries carrying a `recurrence:` rule live in `calendar/recurring/` instead of the date
tree, because an open-ended rule must render in months it was not created in. That folder
stays small (tens of files) and is always cached; a view is that month's folder plus every
rule expanded in memory over the visible range.

### Frontmatter

Keys follow RFC 5545 (iCalendar) naming where one exists, so `.ics` export is close to a
field copy. **Empty keys are omitted, never written as `None`** — `None` is a YAML string,
not null, and a parser hands it back as the text `"None"`.

| Key | Applies to | Notes |
| --- | --- | --- |
| `title` | both | required |
| `type` | both | `event` or `task` |
| `start` | both | `DTSTART`. A bare date (`2026-04-18`) is all-day; a timestamp (`2026-04-18T14:00:00Z`) is an instant |
| `end` | both | same value types as `start`; omitted for all-day single-day items |
| `group` | both | a name, resolved through `groups.md` |
| `done` | `task` only | `true` / `false` |
| `location` | both | free text |
| `alerts` | both | list of minutes before start; `0` means at start. Stored and exported only — see *Reminders* in [../REQUIREMENTS.md](../REQUIREMENTS.md) |
| `participants` | both | list of email addresses |
| `recurrence` | both | an RFC 5545 RRULE string, e.g. `FREQ=WEEKLY;BYDAY=SA` |
| `exdate` | recurring | occurrences to skip |
| `rdate` | recurring | extra occurrences outside the rule |
| `series` | override | the id of the recurring file it belongs to |
| `recurrence-id` | override | `RECURRENCE-ID`: the original occurrence date this file replaces |
| `conflictOf` | conflict file | written by sync, see [../TECHNICAL-REQUIREMENTS.md](../TECHNICAL-REQUIREMENTS.md) |

There is no `duration` key — it is `end - start`.

The bare-date form matters: storing an all-day task as `2026-04-18T00:00:00Z` puts it on
the wrong day for anyone not on UTC, and breaks twice a year on DST.

The markdown body below the frontmatter is the entry's content — an agenda, a checklist,
notes. It is preserved byte-for-byte by anything that does not explicitly edit it.

### Recurrence and per-occurrence state

A recurring file states the rule only. Anything that happens to a *single* occurrence —
ticking it done, moving it, retitling it, cancelling it — is written as an **override
file** in the date tree carrying `series:` and `recurrence-id:`. The rule file is never
rewritten, and because each override is a fresh path it can never conflict, even when
created offline on two devices.

When rendering, an expanded occurrence is replaced by any override whose `recurrence-id`
matches its date. `exdate:` remains available for a plain skip with nothing to record.

Full RRULE is supported on read, since files may be hand-written or imported. The UI only
*writes* the common cases: daily / weekly / monthly / yearly, `INTERVAL`, `BYDAY`,
`UNTIL`, `COUNT`.

### Groups

An entry's `group` is a semantic name, not a colour. `calendar/groups.md` maps it to a
colour and a label, so recolouring or relabelling a group is a one-file edit rather than a
rewrite of every entry that used it, and there is no cap on the number of groups. An
unknown group renders grey. The file lives in the data repo, so the mapping follows you
across devices.

## UI

The UI consists of a navigation pane at the top and a big calendar window on the rest of
the window.

In the top pane are these widgets from left to right:

- left/right button to move to the previous/next day/week/month/year (depending on current view)
- the current day/week/month/year with a small downward arrow to indicate a dropdown. When
  clicked a calendar month view is shown with all days in this dropdown view. The month is
  shown on the top left and on the top right is a left/right arrow to go to the
  previous/next month. When the user clicks on the month in the extended view it switches
  to year. The year view shows 9 years in a 3x3 grid ending with the current year, and its
  left/right arrows page back and forward by 9 years.
- A dropdown to select the view to be either day/week/month/year.
- A dropdown to filter the calendar groups by colour. Double-clicking a group icon lets the
  user edit its label; this writes `groups.md`.

All views show **7 columns, Monday through Sunday**. Weekend columns are tinted so the
work week still reads as a block. (The data requires this: a `BYDAY=SA` task is invisible
in a five-column view.)

- The **year view** shows all months and days. On the top of each month is a
  `['M','T','W','T','F','S','S']` row indicating the weekday. Each row is a new week. The
  current day is highlighted. The user can click a day and a popup shows the entries on
  that day. If there is a calendar entry on that day the day has the background colour of
  the entry's group. For multiple entries the background is split. A group disabled in the
  filter dropdown is not shown.
- The **month view** rows are weeks. Entries appear as rows inside each day cell, sorted by
  start time. `task` items have a rectangular icon at the right to mark them done; a
  completed item shows a check in the rectangle. A task has only a date, no time.
- The **week view** columns are the days, rows are the 24 hours of the day.
- The **day view** is the week view for a single day, showing more detail per entry.

### Entry popup

A top row for the title; below it a button group to select the type; below that the
remaining fields (see `sample/`); below those an auto-growing monospace textarea holding
the markdown body as raw text. At the bottom are a `discard` and a `save` button.

The body is edited and displayed as raw markdown — no renderer, so what you see is exactly
what lands in the file, and there is no third dependency to sanitise HTML for.

### Phone layout

The views above describe the desktop layout. The phone is the primary install target and
a month cell there is ~50px wide, so entry rows are neither readable nor tappable. The
same files adapt at a CSS breakpoint:

- The top pane collapses to `[<] [April 2026 v] [=]`.
- Month and year cells show group-coloured dots instead of text rows.
- Tapping a day opens a bottom sheet listing that day's entries, each tappable to edit,
  with a `+ add entry` button — so no tap target is ever smaller than a finger.
- On desktop, clicking empty space in a day cell creates an entry and clicking an entry
  row opens it.

### Widget

`widget.js` exports `summary()`, returning today's entries and the next upcoming one for
the tile screen of the main app.
