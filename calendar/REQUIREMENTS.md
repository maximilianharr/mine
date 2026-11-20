# Calendar

Calendar is an app of [Mine](../REQUIREMENTS.md) to manage your calendar. Every entry is one
markdown file in the data repo, so your calendar stays readable and portable without this app.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for the file format.

## What an entry holds

A title, a type — **event** or **task** — a start and end, a group, a location, participants,
alerts, and a free markdown body for the agenda, checklist or notes.

A task also carries a **stage** — `todo`, `doing` or `done` — and, optionally, an **important**
mark and an estimate in days. An event has none of the three. Stage is the only record of a
task's progress; there is no separate done flag.

**Important is a plain yes or no, not a scale.** There is no priority 1, 2 and 3 any more. Three
tiers asked you to decide twice — once whether a task matters and again how much — and the second
answer never changed what got done first. A task that matters carries `important: true`; a task
that does not carries no key at all, which is the convention the estimate already follows. A file
written before this change and carrying `priority: 1` reads as important, `priority: 2` through
`9` read as not important, and the old key goes when the entry is next saved.

A new task starts at `todo` with an estimate of **1 day**. Both are only defaults: either can be
changed before saving, and the estimate can be cleared away again, so `estimate` stays a key an
entry may simply not have — nothing writes one into a task that never carried one.

Entries can repeat, and a repeating entry can have single occurrences skipped, moved, retitled
or moved to another stage without affecting the rest.

## Layout

A navigation pane at the top and a big calendar window below it.

In the top pane, three groups: the two view controls at the left, the period in the middle, the
two ways out at the right.

```
[board]    [filter]     [‹] [NOV/26 ▾] [›]     [⚙] [⌂]     a calendar view
[calendar] [filter]     [‹] [7 ▾]      [›]     [⚙] [⌂]     the kanban
[board]    [filter]       [NOV/26 ▾]           [⚙] [⌂]     either one, on a phone
```

Everything in the pane is drawn at **twice the size** it was: this is the row reached for on
every visit, and it was the smallest thing on the screen. On a phone the controls **share the
row width equally and the pane stays on one line**, down to a 320 px viewport — it neither wraps
onto a second line nor drops a control, because five controls spread across the full width is
exactly what fits at this size.

- **Leftmost, the view switch and the filter.** One slot always holds the way to the other kind
  of view: a board icon in a calendar view, and on the board a calendar icon, which returns to
  the month view. The board is not a zoom step, which is why it has a slot of its own rather
  than a place in the cycle the label walks. Beside it the filter. **Groups are a dropdown inside
  it, not a list**: one `groups` row saying how many are on, which opens to the same checkboxes,
  each group showing its colour. Any subset can still be hidden — the dropdown only folds the
  list away, so that a repo with twenty groups cannot give the filter a panel taller than the
  screen. This is a view filter and is remembered per device; groups are *named and coloured* in
  settings, not here.
- **Centred, the period.** Left/right buttons, with the period label between them, to move to
  the previous/next day, week, month, year or sprint, depending on the current view. The label
  is short, because the pane has to fit a phone:

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

  **Clicking the label zooms the calendar**: year → month → week → day → year, and round again.
  It is a cycle rather than a scale with two ends, because a single target cannot be disabled at
  an end and still be the way on. So there is no `-` and no `+` in the pane, and no
  `D` `W` `M` `Y` `K` row either. On the board the label is the sprint number and clicking it
  opens the list of sprints instead; the board has no zoom.

  **The caret `▾` beside the label is a button of its own** and opens the dropdown picker. It
  has to be, now that the label itself zooms — the picker is the only way back to today, so it
  cannot be a tap that the zoom has taken. The dropdown shows a month at a time, with its name
  top left and left/right arrows top right. Clicking the month name switches to a year grid of 9
  years ending with the current one, whose arrows page by 9 years. Today is highlighted in it,
  and tapping it is how you get back to today — there is no jump-to-today button in the pane. In
  the kanban the dropdown picks a sprint, and there the caret and the label do the same thing,
  since that list is the picker: its rows read `Sprint 7 · 19 Jan – 1 Feb`, and the row holding
  today reads `current · 19 Jan – 1 Feb` on a brighter background in dark mode, a darker one in
  light.

  **On a phone there are no `‹` `›`.** The label is swiped instead: a swipe left steps forward, a
  swipe right back — through periods in a calendar view, through sprints on the board. **The
  swipe lives on the label alone.** Nowhere else in the app does a sideways gesture do anything,
  so it never has to be told apart from a card drag on the board or from a scroll in a grid.
- **Rightmost, the two ways out.** A gear button that opens settings, and a home icon back to the
  Mine tile screen. A house rather than an arrow, because a third arrow beside the two that step
  through periods reads as another way to move inside the calendar.

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
  into that month in the month view — the same step clicking the period label takes, but landing
  on the month you pointed at rather than the one the anchor is in. The whole label is the target, so
  it stays finger-sized where a day in a year grid is not.
- **Month** — one row per week, and the grid **fills the whole height of the window** below the
  pane: the week rows divide the space between them equally, so the month is as tall as the
  screen allows rather than as tall as its cells happen to need. The extra height goes to the
  cell, **not to more entry lines** — the cap below is about what a glance can read, not about
  what fits. Entries appear inside each day cell as small lines carrying the
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
- **Day** — the week view for a single day, with more detail per entry, and **with no day header
  row**. The weekday and the date are already the period label in the top pane, and `TUE 20`
  repeated directly beneath that label was the same fact twice in the one view where there is
  only one day to name. So the day view is the all-day strip and the hour grid, with nothing
  above them. The week view keeps its seven headers: those name seven different days, and the
  pane names none of them.
- **Kanban** — below.

Groups switched off in the filter are not shown in any view.

### The day preview

Clicking a day opens that day's entries as a list, each one tappable. Its top right carries a
small `+` to add an entry on that day and a small `x` to close it — not full-width buttons. It
is reached from a day in the year grid, from a day cell in the month view on a phone, and from
a day header in the week grid. The day view has no header to reach it from, and needs none: it
is already showing the one day the preview would list.

## Entry popup

The popup **opens in the middle of the screen**, on a phone as much as on a desktop — and so
does every other overlay in the calendar: a field's own popup, the settings panel and the day
preview. Nothing rises from the bottom edge any more. A centred card is reached with either
thumb and does not pretend to be a drawer that can be dragged.

A row of icon buttons at the top, and it now holds the type pair and the three on the right and
nothing between them. **Every button in it is an icon; no button carries a letter.**

- Leftmost, a ticked square for **task** and a calendar page for **event**. Choosing one
  deselects the other; the default is event. What the entry *is* comes first, because it governs
  what the rest of the popup offers.
- Then, right-aligned: a trashcan to delete the entry, a disk to save it, and an `x` to close and
  discard. **The `x` is rightmost, in every popup in Mine.** The way out of an overlay sits in the
  same corner wherever you are, so leaving one is never something to look for — and that corner
  is worth more to the button you reach for by habit than to the one you aim at. The disk gives
  it up and sits beside it.

There is no dash between the two groups: the gap to the right-aligned trio already separates
them, and the field icons the dash used to divide off are not in this row at all any more.

Below it, in this order: the **title**, the **start and end** fields, the **toggle row**, and
then **one row per field**.

### The toggle row

One row of icons directly under start and end. These are not fields with a form each: they are
small values, edited in the row itself, and they **show their value** rather than merely whether
they have one — each as a small badge on the corner of its icon.

- **`24h` for all-day** — the one control in the popup that is a word rather than a picture, and
  deliberately so: every drawing of a whole day reads as something else. The sun it replaces was
  taken for weather or for daylight hours, and `24h` cannot be. **A clickable control, not a
  checkbox** — lit when on, plain when off. On an event it is alone on the row. Only the button
  changes its name: the strip in the week and day grids still reads `all-day`, and so does this
  document, because the word is the clearer one in prose and the button is the one place with no
  room for it.
- three small columns for **stage** — cycles `todo` → `doing` → `done` on each tap, its badge in
  that stage's kanban colour: red, yellow, green. There is no stage popup.
- a `!` for **important** — a straight toggle, lit when the task is important and plain when it
  is not. It carries no badge: a yes or no has nothing a badge could add that the lit state has
  not already said, which is what made the old flag need a digit and this one not.
- an hourglass for **estimate** — the one that opens a popup, because a number has to be typed.
  Its badge reads the day count as `2d`. It stays on this row rather than joining the field rows
  below, because what it carries is a badge-sized value like the other three, not a form.

On an event, stage, important and estimate are not there at all, because an event has none of
them. They sit here so that a task that is not on a board still carries the two fields a kanban
card edits.

Neither lit control — `24h` or `!` — is the save button's green: in all of Mine green is a save
and red is a trashcan, and a green toggle beside the disk would make the popup look like it
offers two primary actions.

### The field rows

Every other field is a row, and **every field has a row, set or not** — the rows are now the only
way to reach a field, so none of them can be hidden. A row is the icon on the left and the
field's name beside it, and, when the field is set, its value after that:

```
[ball]    Category     Work
[pin]     Location     Conference room 3B
[lines]   Details
[repeat]  Repeat
```

The six fields, in their canonical order:

- three lines of text for **details** — the markdown body;
- a ball for **category**;
- circular arrows for **repetition**;
- a bell for **alerts**;
- a pin for **location**;
- a person for **participants**.

- **Clicking a row opens that field's popup.** The row *is* the pen, so no row carries one, and
  clearing a field is the trashcan inside its popup, which is already there.
- **The rows that are set move to the top.** Set fields come first, unset ones follow, and inside
  each group the order is always the canonical one above. Setting a field lifts its row into the
  top group and shuffles nothing else, so a row never moves for a reason you did not cause.
- **A set row is plain.** Being in the top group and showing a value is what says the field is
  set — which is what the old lit icon said, in a row that no longer exists. Nothing in the
  popup lights except the two toggles on the row above, `24h` and `!`.

Each of the six opens its own popup, and every popup has the same three buttons in the entry
popup's own order: a trashcan that clears that one field, a disk that commits the value into the
entry form, and, rightmost, an `x` that abandons the sub-edit. **A sub-popup never writes to the
repo**, with the single exception noted under Category.
Nothing is written until the entry popup's own disk, so one entry edit is one commit, and the
entry popup's `x` discards the staged fields along with everything else. This is also what makes
a brand-new entry work, since it has no file for a sub-popup to write to.

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

**This is the same popup the settings panel's *edit groups* button opens**, and the only place in
the calendar where a group is named or coloured. Reached from an entry it also picks one; reached
from settings it only manages them. One list, because two would have to be kept in step and
neither would gain anything by it.

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

Each column header shows its state and a `+` that creates a task in that stage, on the first day
of the selected sprint. **The state's name carries the colour** — `todo` red, `doing` yellow,
`done` green, the board's own three colours exactly, the yellow being the cards' `#e0a500` rather
than a pure one, which would not be readable on the light theme. There is no colour dot and no
card count: the dot said what the coloured name now says, and a count is a number nobody acts
on. The name is **centred and drawn at twice the size**; the `+` stays at the right of the
header, where it is the board's only way to make a task, since the top pane has none. The sprint
selector and the filter sit in the top pane, because one board shows one sprint. On the board the
filter holds the groups dropdown, an assignee, and a single **important only** toggle — one
switch, now that importance is a yes or no, where four priority chips used to ask which tiers you
meant.

A card shows:

- a top row with the title, and a `!` in front of it when the task is important. **No pen and no
  trashcan.** The pen said what clicking the card already does. The trashcan put the one
  irreversible action on the preview, a thumb's width from the title you were aiming at. **On a
  phone the row also carries `<` `>`** to move the card to the previous or next stage — `<`
  disabled in todo, `>` disabled in done. **On a desktop it does not**: all three columns are
  there and the card is dragged between them, so arrows on every card are a second way to do what
  the drag already does, in the one place they are also easiest to mistake for the header's pager;
- below it two lines of the markdown body, and the day the task sits on.

**That is the whole card.** The estimate, the sprint number and the priority chip are gone from
it. The estimate and the importance are set in the entry popup's toggle row, which is one tap
further away and is where the rest of the task is edited anyway; the sprint number was identical
on every card on the board, because a board shows one sprint. What is left is a coloured bar, a
title and two lines — the three things worth reading at a glance across three columns.

The `!` is a **marker, not a button**: it is read on the card and set in the popup. So on a
desktop the card holds nothing to press at all, and on a phone only the two arrows.

**A card is deleted from the entry popup, not from the board.** Clicking the card opens it; the
popup's trashcan deletes the whole entry, and its skip control drops a single occurrence of a
repeating task. Two taps rather than one, and no reachable trashcan on a surface whose whole
purpose is to be tapped.

**There is no sprint control anywhere.** A sprint is derived from the start date, so moving a
task to another sprint *is* changing its date, and the date is the only way to do it. A control
that rewrote the date to mean the same thing was a second truth to keep in step with the first.

**Clicking a card opens it; clicking a control on a card does not.** The phone's `<` `>` move the
card and nothing else follows — the click must not also reach the card beneath and open the entry
popup on top of the move. This holds for every control a card may ever carry, and it is the
reason a card may carry none that is not worth the care.

On desktop all three columns are shown and a card can be dragged between them, and each header is
its stage's name, centred, with the `+` at its right and **no `‹` `›`** — with every column on
screen there is nothing for a per-column pager to page. On a phone one column fills the screen
and its header pages between the three: `[‹] doing [›]`, **centred as a group and drawn at twice
the size**, the two buttons flanking the stage name on a background of their own — because the
`<` `>` on a card mean something else entirely, they move that card. The group is sized so that
it never exceeds the width of a 320 px screen. The header pair is disabled at todo and at done
rather than wrapping.

**There is no swipe on the board.** A sideways gesture on a column or a card does nothing. The
only swipe in the calendar is on the period label in the top pane, which steps the sprint — so a
gesture here never has to be told apart from a drag.

**Exactly one column is visible at a time.** No part of the next column may show at the edge of
the screen: a sliver of `done` beside `doing` is a layout fault, and the cause is always the
same — a gap between columns in a strip that is shifted by whole column widths.

Cards are not reordered by hand; their order comes from importance and start — the important ones
first, each block by start date.

## Settings

The gear button opens a centred panel whose top right has an `x` to close.

**Every row is two halves: the label in the left half, its control in the right.** That one rule
is what the panel was missing. A select, a text box, a checkbox and a date field each began
wherever its own label happened to end, so eight tidy rows read as a ragged column — and the fix
is alignment, not fewer settings. The controls now line up in one column down the panel.

Eight rows, and the labels are short enough to fit their half on one line at 320 px — which is
why two of them are no longer named after the kanban:

| row | control |
| --- | --- |
| Groups | an **edit groups** button |
| Start week on | Monday or Sunday |
| Time zone | a zone name such as `Europe/Berlin`, defaulting to the device's own |
| Date format | `auto` (the device's locale), `dd.mm.yyyy` or `mm/dd/yy` |
| Calendar weeks | the month view's week-number gutter |
| Sprint length | in weeks |
| First sprint | the date sprint 1 starts on |
| Theme | system, light or dark |

Those are labels only: the two renamed rows still read and write `kanban-interval` and
`kanban-anchor` in the repo, because renaming a row must not rewrite a file.

**Groups are behind the button, not listed in the panel.** *Edit groups* opens the category
popup in its manage-only form — every group with its colour, a `+ add`, a pen and a trashcan. A
list in the panel grew with the repo and pushed the eight settings that never change below the
fold, which is the one thing a settings panel must not do.

**The panel ends at its last row.** There is no paragraph under it explaining what is stored
where. That rule is the next two paragraphs, and it belongs in this document rather than on a
screen you opened to change the theme.

A zone name, not an offset: a plain `UTC+1` is an hour wrong for half the year in any zone with
daylight saving. This zone, not the device's, decides which day a timed entry lands in, where it
sits in the week and day grids, and what a time you type means. All-day entries are bare dates
and are never run through it at all. The week view's label carries its ISO week number whether
*calendar weeks* is on or off: that row governs the month view's gutter and nothing else.

Everything here is stored on the device except the groups, the sprint length and the first sprint
date, which are data and live in the repo so they follow you and mean the same thing everywhere.
Theme and date format apply to all of Mine, not the calendar alone, and the main app's settings
shows the same two rows.

## On a phone

The views above describe the desktop. The same screens adapt:

- The top pane holds five controls — `[board] [filter] [NOV/26 ▾] [⚙] [⌂]` — at twice their old
  size, sharing the row width equally on **one line at every phone width**, 320 px included.
  There are no `‹` `›`: the label is swiped left and right instead, and the caret `▾` on it still
  opens the picker.
- A month cell shows at most two entry lines, then `+N`; a line carries the title alone, with no
  time prefix and no done-rectangle, clipped at the cell's edge. A year cell stays a coloured
  day.
- Tapping a day in the month or year view opens that day's entries as a centred card, each one
  tappable, with the small `+` and `x` in its top right — so nothing is ever smaller than a
  finger. Tapping a month's name in the year view zooms into that month instead.
- The kanban shows one column at a time, paged by the centred, double-size `‹` `›` in its header,
  and its cards keep their own `<` `>` because there is nothing to drag a card onto.

**Every view fits a 320 CSS px viewport**, with the week gutter on and whatever the entries happen
to be — the double-size top pane and the double-size kanban header included. **Nothing in the app
moves sideways**: no view scrolls or extends horizontally, in any view, at any width. The period
label's swipe is no exception, because it moves the period, not the layout. A view that demands
more width than
the screen has is a defect even when it looks right on a desktop, and a cell insisting on room
for a time, a title and an icon at once is the usual cause — seven of them across a phone is
where it shows. `test/run.sh` checks every view at 320 and 360 px, in light and dark; see
[../TEST-REQUIREMENTS.md](../TEST-REQUIREMENTS.md).

## On the main screen

The tile screen of the main app shows today's entries and the next one coming up.
