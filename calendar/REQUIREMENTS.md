# Calendar

Calendar is an app of [Mine](../REQUIREMENTS.md) to manage your calendar. Every entry is one
markdown file in the data repo, so your calendar stays readable and portable without this app.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for the file format.

## What an entry holds

A title, a type — **event** or **task** — a start and end, a group, a location, participants,
alerts, and a free markdown body for the agenda, checklist or notes.

A task also carries a **stage** — `todo`, `doing` or `done` — and, optionally, a priority (1, 2
or 3) and an estimate in days. An event has none of the three. Stage is the only record of a
task's progress; there is no separate done flag.

Entries can repeat, and a repeating entry can have single occurrences skipped, moved, retitled
or moved to another stage without affecting the rest.

## Layout

A navigation pane at the top and a big calendar window below it.

In the top pane, from left to right:

- Left/right buttons to move to the previous/next day, week, month, year or sprint, depending on
  the current view.
- The current day/week/month/year, with a small downward arrow for a dropdown date picker. The
  dropdown shows a month at a time, with its name top left and left/right arrows top right.
  Clicking the month name switches to a year grid of 9 years ending with the current one, whose
  arrows page by 9 years. In the kanban view the label reads `Sprint 7 · 19 Jan – 1 Feb` and the
  dropdown picks a sprint.
- A button to jump to today.
- A dropdown to filter by group. Each group shows its colour. This is a view filter and is
  remembered per device; groups are *named and coloured* in settings, not here.
- `D` `W` `M` `Y` `K` to choose the view: day, week, month, year, kanban.
- A return arrow back to the Mine tile screen.
- A gear button that opens settings.

All views show **seven columns beginning with the configured first day of the week**, with
Saturday and Sunday tinted wherever they land. A Saturday task has to be visible.

When *show calendar weeks* is on, each week row carries its ISO 8601 week number in a left
gutter, separated from the days by a thin vertical rule. The number is always ISO, whichever
day the week is set to start on.

A `+` button adds an entry. It defaults to today when today is in view, and otherwise to the
first day on screen — in the kanban, to the first day of the selected sprint, in its todo
column.

## Views

- **Year** — every month, each with a weekday header row and one row per week. The current day
  is highlighted. A day with entries takes the background colour of its group, split between
  colours if there are several — a year grid has no room for anything else. Clicking a day shows
  that day's entries.
- **Month** — one row per week. Entries appear inside each day cell as small lines carrying the
  title on the group's background colour, sorted by time, all-day items first. A cell shows at
  most four on desktop and two on a phone, then `+N`. Tasks have a rectangular icon on the right
  to move them straight to done. Clicking empty space in a cell creates an entry; clicking an
  entry opens it.
- **Week** — columns are the days, rows are the 24 hours.
- **Day** — the week view for a single day, with more detail per entry.
- **Kanban** — below.

Groups switched off in the filter are not shown in any view.

### The day preview

Clicking a day opens that day's entries as a list, each one tappable. Its top right carries a
small `+` to add an entry on that day and a small `x` to close it — not full-width buttons.

## Entry popup

A row of icon buttons at the top, from left to right:

- `T` for task, `E` for event. Choosing one deselects the other; the default is event.
- A circular-arrows button for **repetition**.
- A ball for **category**.
- A pin for **location**.
- A bell for **alerts**.
- A person for **participants**.
- `D` for **details** — the markdown body.
- Then, right-aligned: an `x` to close and discard, a trashcan to delete the entry, and a disk
  to save it.

An icon whose field is set is shown enabled: a brighter background in dark mode, a darker one in
light mode. So the row doubles as a summary of what the entry carries.

Each of the seven field buttons opens its own popup, and every popup has the same three buttons:
a trashcan that clears that one field, an `x` that abandons the sub-edit, and a disk that commits
the value into the entry form and lights the icon. **A sub-popup never writes to the repo.**
Nothing is written until the entry popup's own disk, so one entry edit is one commit, and the
entry popup's `x` discards the staged fields along with everything else. This is also what makes
a brand-new entry work, since it has no file for a sub-popup to write to.

Below the icon row:

- the title field;
- for a task, a `todo` / `doing` / `done` button group;
- the start and end fields;
- then one row per field that is set, in the order of the icons above — so a location that has
  been given appears at the bottom. Each row has a pen to reopen its popup and a trashcan to
  clear it.

Saving **closes the popup and returns to the calendar immediately**; the push to GitHub runs in
the background and is reported in the sync line, not in the popup.

### Repetition

A dropdown, not an RRULE field:

```
does not repeat · daily · weekly · every 2 weeks ·
monthly on the x-th · monthly on the x-th weekday · yearly
```

below it an **ends** control: never, on a date, or after a number of occurrences.

Files may be hand-written or imported, so a rule the dropdown cannot express — `the last Friday
of the month`, `Mondays, Wednesdays and Fridays` — is shown as a non-selectable **custom** state
displaying the rule as text, with a note that choosing an option will replace it. Saving the
entry without touching the dropdown leaves the rule untouched. No hand-written rule is ever
silently rewritten.

### Category

The groups, each with its colour, and a `+ add` button. Adding a group asks for a label and a
colour; its stored name is derived from the label and never shown, which is why relabelling or
recolouring later touches no entry. A pen edits a group, a trashcan deletes it — and entries
still naming a deleted group render grey.

## Kanban

Three columns — **todo** (red), **doing** (yellow), **done** (green) — holding one sprint's
tasks. Every task is a card and every card is a task; events never appear.

A sprint is a date range, not a stored field: sprint 1 starts on the *kanban first week start
date* and each one runs for the *kanban interval*. A task's sprint is whichever range its start
falls in, so the number can never disagree with the date, and moving a card to another sprint
is exactly a change of its start and end. Both settings therefore live in the data repo, not on
the device — if they differed between two devices the same card would be in different sprints.

A repeating task contributes one card per occurrence inside the sprint. Moving one records an
override for that occurrence alone; the rule itself is never rewritten.

Each column header shows its state, its colour and a card count. The sprint selector and a
filter icon (category, assignee, priority) sit in the top pane, because one board shows one
sprint.

A card shows:

- a top row with a trashcan to delete, a pen to edit, the title, and `<` `>` to move it to the
  previous or next stage — `<` disabled in todo, `>` disabled in done;
- below it two lines of the markdown body;
- on the right a priority chip (1 red, 2 orange, 3 yellow), the estimate in days, and the sprint
  number. Clicking any of the three changes it; changing the sprint moves the task's start and
  end to that sprint's range.

On desktop all three columns are shown and a card can be dragged between them. On a phone one
column fills the screen, swiping sideways moves between them, and the `<` `>` buttons on each
card do the moving — so the swipe never has to be told apart from a drag. Cards are not
reordered by hand; their order comes from priority and start.

## Settings

The gear button opens a panel whose top right has an `x` to close:

- **Groups** — the list of groups, each with its colour, a pen to edit and a `+` to add.
- **Start week on** — Monday or Sunday.
- **Time zone** — a zone name such as `Europe/Berlin`, defaulting to the device's own. A plain
  `UTC+1` is not offered: it is an hour wrong for half the year in any zone with daylight saving.
- **Date format** — `auto` (the device's locale), `dd.mm.yyyy` or `mm/dd/yy`.
- **Show calendar weeks**.
- **Kanban interval** — in weeks.
- **Kanban first week start date**.
- **Theme** — system, light or dark.

Everything here is stored on the device except the groups, the kanban interval and the kanban
first week start date, which are data and live in the repo so they follow you and mean the same
thing everywhere. Theme and date format apply to all of Mine, not the calendar alone, and the
main app's settings shows the same two rows.

## On a phone

The views above describe the desktop. The same screens adapt:

- The top pane collapses to `[<] [April 2026 v] [D W M Y K] [←] [⚙]`.
- A month cell shows at most two entry lines, then `+N`; a year cell stays a coloured day.
- Tapping a day opens that day's entries as a sheet, each one tappable, with the small `+` and
  `x` in its top right — so nothing is ever smaller than a finger.
- The kanban shows one column at a time.

## On the main screen

The tile screen of the main app shows today's entries and the next one coming up.
