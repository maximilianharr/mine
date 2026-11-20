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

A new task starts at `todo` with an estimate of **1 day**. Both are only defaults: either can be
changed before saving, and the estimate can be cleared away again, so `estimate` stays a key an
entry may simply not have — nothing writes one into a task that never carried one.

Entries can repeat, and a repeating entry can have single occurrences skipped, moved, retitled
or moved to another stage without affecting the rest.

## Layout

A navigation pane at the top and a big calendar window below it.

In the top pane, from left to right:

```
[‹] [NOV/26 ▾] [›] [board]    [-] [+] [filter] [⚙] [⌂]     a calendar view
[‹] [7 ▾]      [›] [calendar]         [filter] [⚙] [⌂]     the kanban
```

- Left/right buttons, with the period label between them, to move to the previous/next day,
  week, month, year or sprint, depending on the current view.
- The period label, with a small downward arrow for a dropdown date picker. The label is short,
  because the pane has to fit a phone:

  | view | label |
  | --- | --- |
  | day | `FR 20/NOV` |
  | week | `W47/NOV` |
  | month | `NOV/26` |
  | year | `2026` |
  | kanban | `7` — the sprint number alone |

  The month name is the device locale's three-letter abbreviation, upper-cased, so a German
  phone reads `OKT/26`: short beats English. The week label always carries its ISO week number,
  whether or not *show calendar weeks* is on — that setting governs the month view's gutter and
  nothing else. A week spanning two months takes the month its **fourth** day is in, which is
  the rule the gutter already uses, so label and gutter can never disagree.

  The dropdown shows a month at a time, with its name top left and left/right arrows top right.
  Clicking the month name switches to a year grid of 9 years ending with the current one, whose
  arrows page by 9 years. Today is highlighted in it, and tapping it is how you get back to
  today — there is no jump-to-today button in the pane. In the kanban the dropdown picks a
  sprint: its rows read `Sprint 7 · 19 Jan – 1 Feb`, and the row holding today reads
  `current · 19 Jan – 1 Feb` on a brighter background in dark mode, a darker one in light.
- A board icon that switches to the kanban. In the kanban that slot holds a calendar icon
  instead, which returns to the month view — so one slot is always the way to the other kind
  of view, and the board is not a zoom step.
- `-` and `+` to zoom the calendar: `+` zooms **in** towards the day, `-` out towards the year,
  through year, month, week, day. Each is disabled at its end of the scale rather than wrapping.
  There is no `D` `W` `M` `Y` `K` row. The kanban has no zoom, so the pair is not shown there.
- A dropdown to filter by group. Each group shows its colour. This is a view filter and is
  remembered per device; groups are *named and coloured* in settings, not here.
- A gear button that opens settings.
- A home icon back to the Mine tile screen. A house rather than an arrow, because a third arrow
  beside the two that step through periods reads as another way to move inside the calendar.

All views show **seven columns beginning with the configured first day of the week**, with
Saturday and Sunday tinted wherever they land. A Saturday task has to be visible.

When *show calendar weeks* is on, each week row carries its ISO 8601 week number in a left
gutter, separated from the days by a thin vertical rule. The number is always ISO, whichever
day the week is set to start on. ISO weeks run Monday to Sunday, so a row beginning on Sunday
holds one day of one ISO week and six of the next; the number shown is the one the rest of the
row is in.

**There is no `+` in the top pane.** An entry is created where it will live: by clicking empty
space in a day, week or month cell, by the small `+` in the day preview, or — in the kanban — by
the `+` in a column header, which creates a task in that column's stage on the first day of the
selected sprint. In the year view it is the day preview's `+`, as everywhere else.

## Views

- **Year** — every month, each with a weekday header row and one row per week. The current day
  is highlighted. A day with entries takes the background colour of its group, split between
  colours if there are several — a year grid has no room for anything else. Clicking a day shows
  that day's entries, as a preview like everywhere else. **The month's name is a button**: it
  reads as a caption but is pressable, with a hover and a press state, and clicking it zooms
  into that month in the month view — the same step the pane's `+` takes, but landing on the
  month you pointed at rather than the one the anchor is in. The whole label is the target, so
  it stays finger-sized where a day in a year grid is not.
- **Month** — one row per week. Entries appear inside each day cell as small lines carrying the
  title on the group's background colour, sorted by time, all-day items first. On desktop a timed
  entry's line is prefixed with its time; on a phone it is the title alone, because seven columns
  across a phone have no room for both and the title is the part worth reading — the time is one
  tap away in the day preview. A cell shows at most four on desktop and two on a phone, then
  `+N`. A line is a single line of text: a title too long for the cell is **clipped at the
  cell's edge with no `…`**, because three dots cost three characters in the one place in the app
  where characters are scarcest, and a clipped word already says there is more. The month view
  carries **no done-rectangle** — that width goes to the title; one-tap done stays in the week
  and day grids and in the day preview, and a task seen in the month is moved through its popup
  or on the board. Clicking empty space in a cell creates an entry; clicking an entry opens it.
- **Week** — columns are the days, rows are the 24 hours.
- **Day** — the week view for a single day, with more detail per entry.
- **Kanban** — below.

Groups switched off in the filter are not shown in any view.

### The day preview

Clicking a day opens that day's entries as a list, each one tappable. Its top right carries a
small `+` to add an entry on that day and a small `x` to close it — not full-width buttons. It
is reached from a day in the year grid, from a day cell in the month view on a phone, and from
a day header in the week and day grids.

## Entry popup

A row of icon buttons at the top, from left to right. **Every button in it is an icon; no button
carries a letter.**

- A ticked square for **task**, a calendar page for **event**. Choosing one deselects the other;
  the default is event. Then a short vertical dash, which sets the two apart from the rest:
  what the entry *is* comes first, and it governs what the rest of the popup offers.
- Then the six field icons, in the same order on a task as on an event, so the row does not
  reshuffle when the type changes:
  - three lines of text for **details** — the markdown body;
  - a ball for **category**;
  - circular arrows for **repetition**;
  - a bell for **alerts**;
  - a pin for **location**;
  - a person for **participants**.
- Then, right-aligned: an `x` to close and discard, a trashcan to delete the entry, and a disk
  to save it.

An icon whose field is set is shown enabled: a brighter background in dark mode, a darker one in
light mode. So the row doubles as a summary of what the entry carries.

### The all-day row

A second row of icons, where the all-day checkbox used to be: under the title, above the start
and end fields. **All-day is a clickable icon, not a checkbox**, and on a task stage, priority
and estimate sit on this same row, in this order:

- a sun for **all-day**. On an event it is alone on the row.
- three small columns for **stage** — cycles `todo` → `doing` → `done` on each tap. There is no
  stage popup.
- a flag for **priority** — cycles none → 1 → 2 → 3 → none.
- an hourglass for **estimate** — the one that opens a popup, because a number has to be typed.

On an event, stage, priority and estimate are not there at all, because an event has none of
them.

All-day follows the enabled rule above — lit when on, plain when off — and deliberately **not**
the save button's green: in all of Mine green is a save and red is a trashcan, and a green
toggle beside the disk would make the popup look like it offers two primary actions.

**Stage, priority and estimate are still not like the others.** They are three small values
rather than fields with a form each, so they are edited in the row itself and they **show their
value** rather than merely whether they have one — each as a small badge on the corner of its
icon:

- stage: a badge in that stage's kanban colour — red, yellow, green.
- priority: the digit, on that priority's chip colour.
- estimate: the day count as `2d`, exactly as a kanban card shows it.

So the enabled rule is about the six field icons; these three are always legible instead. They
sit here so that a task that is not on a board still carries the two fields a kanban card
edits.

Each of the six field buttons opens its own popup, and every popup has the same three buttons:
a trashcan that clears that one field, an `x` that abandons the sub-edit, and a disk that commits
the value into the entry form and lights the icon. **A sub-popup never writes to the repo**,
with the single exception noted under Category.
Nothing is written until the entry popup's own disk, so one entry edit is one commit, and the
entry popup's `x` discards the staged fields along with everything else. This is also what makes
a brand-new entry work, since it has no file for a sub-popup to write to.

Below the icon row:

- the title field;
- the all-day row above;
- the start and end fields;
- then one row per field that is set, in the order of the icons above — so participants, once
  given, appear at the bottom. Each row has a pen to reopen its popup and a trashcan to clear
  it.

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
recolouring later touches no entry. Adding one writes `groups.md` immediately rather than staging
it: that is a different file from the entry, and a category must not disappear because the entry
it was created for was discarded. A pen edits a group, a trashcan deletes it — and entries
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

Each column header shows its state, its colour, a card count and a `+` that creates a task in
that stage, on the first day of the selected sprint. The sprint selector and a filter icon
(category, assignee, priority) sit in the top pane, because one board shows one sprint.

A card shows:

- a top row with a trashcan to delete, a pen to edit, the title, and `<` `>` to move it to the
  previous or next stage — `<` disabled in todo, `>` disabled in done;
- below it two lines of the markdown body;
- on the right a priority chip (1 red, 2 orange, 3 yellow), the estimate in days, and the sprint
  number. Clicking any of the three changes it: the priority chip cycles 1 → 2 → 3, and the
  estimate and the sprint ask for a number. Changing the sprint moves the task's start and end
  into that sprint's range, keeping its offset within the sprint and its time of day.

On desktop all three columns are shown and a card can be dragged between them. On a phone one
column fills the screen and its header pages between the three: `[<] doing [>]`, the two
buttons flanking the stage name, drawn larger and on a background of their own — because
the `<` `>` on a card mean something else entirely, they move that card. The header pair is
disabled at todo and at done rather than wrapping.

**There is no swipe.** A sideways gesture on the board does nothing, so it never has to be told
apart from a drag.

**Exactly one column is visible at a time.** No part of the next column may show at the edge of
the screen: a sliver of `done` beside `doing` is a layout fault, and the cause is always the
same — a gap between columns in a strip that is shifted by whole column widths.

Cards are not reordered by hand; their order comes from priority and start.

## Settings

The gear button opens a panel whose top right has an `x` to close:

- **Groups** — the list of groups, each with its colour, a pen to edit and a `+` to add.
- **Start week on** — Monday or Sunday.
- **Time zone** — a zone name such as `Europe/Berlin`, defaulting to the device's own. This
  zone, not the device's, decides which day a timed entry lands in, where it sits in the week and
  day grids, and what a time you type means. A plain `UTC+1` is not offered: it is an hour wrong
  for half the year in any zone with daylight saving. All-day entries are bare dates and are
  never run through it at all.
- **Date format** — `auto` (the device's locale), `dd.mm.yyyy` or `mm/dd/yy`.
- **Show calendar weeks** — the month view's week-number gutter. The week view's label carries
  its ISO week number either way.
- **Kanban interval** — in weeks.
- **Kanban first week start date**.
- **Theme** — system, light or dark.

Everything here is stored on the device except the groups, the kanban interval and the kanban
first week start date, which are data and live in the repo so they follow you and mean the same
thing everywhere. Theme and date format apply to all of Mine, not the calendar alone, and the
main app's settings shows the same two rows.

## On a phone

The views above describe the desktop. The same screens adapt:

- The top pane keeps every control and wraps onto a second line rather than dropping any:
  `[‹] [NOV/26 ▾] [›] [board] [-] [+] [filter] [⚙] [⌂]`. The short labels are what keep it to
  one line on a wider phone; at 320 and 360 px it takes two, and the kanban's shorter pane one.
- A month cell shows at most two entry lines, then `+N`; a line carries the title alone, with no
  time prefix and no done-rectangle, clipped at the cell's edge. A year cell stays a coloured
  day.
- Tapping a day in the month or year view opens that day's entries as a sheet, each one
  tappable, with the small `+` and `x` in its top right — so nothing is ever smaller than a
  finger. Tapping a month's name in the year view zooms into that month instead.
- The kanban shows one column at a time, paged by the `<` `>` in its header.

**Every view fits a 320 CSS px viewport**, with the week gutter on and whatever the entries happen
to be. **Nothing in the app moves sideways**: no view scrolls or extends horizontally, in any
view, at any width — and now that the kanban's swipe is gone, there is no exception left to the
rule. A view that demands more width than
the screen has is a defect even when it looks right on a desktop, and a cell insisting on room
for a time, a title and an icon at once is the usual cause — seven of them across a phone is
where it shows. `test/run.sh` checks every view at 320 and 360 px, in light and dark; see
[../TEST-REQUIREMENTS.md](../TEST-REQUIREMENTS.md).

## On the main screen

The tile screen of the main app shows today's entries and the next one coming up.
