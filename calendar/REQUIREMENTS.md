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

**Important is a plain yes or no, not a scale.** There is no priority 1, 2 and 3. Three tiers
asked you to decide twice — once whether a task matters and again how much — and the second
answer never changed what got done first. A task that matters carries `important: true`; a task
that does not carries no key at all, which is the convention the estimate already follows.

A new task starts at `todo` with an estimate of **1 day**. Both are only defaults: either can be
changed before saving, and the estimate can be cleared away again, so `estimate` stays a key an
entry may simply not have — nothing writes one into a task that never carried one.

Entries can repeat, and a repeating entry can have single occurrences skipped, moved, retitled
or moved to another stage without affecting the rest.

## Layout

A navigation pane at the top and a big calendar window below it.

**The calendar window is as wide as the browser.** Nothing caps it: a month at 1920 px is a
month 1920 px wide, because the one thing a desktop has over a phone is room, and a grid that
stops at 78 rem spends that room on margins. **The board is the exception** and keeps the cap,
centred — three columns stretched across a wide monitor are three columns of mostly empty card,
and a card is read at the width a sentence is read at, not at a third of the screen. The pane
itself is full width in both, so it never changes shape when you switch between them.

In the top pane, three groups: the two view controls at the left, the period in the middle, the
two ways out at the right.

```
[board]    [zoom]     [‹]   [NOV/26]   [›]     [☰] [⌂]     a calendar view
[calendar] [zoom]     [‹]   [7]        [›]     [☰] [⌂]     the kanban
```

Everything in the pane is drawn at **twice the size** it was: this is the row reached for on
every visit, and it was the smallest thing on the screen.

**On a phone the pane is two rows**, each one filling the width:

```
[board]  [zoom]  [☰]   [⌂]         the four that go somewhere
[‹]     [ NOV/26 ]     [›]         the period, and the way to another
```

Five controls across one line left the period label — the one thing in the pane you read rather
than aim at — no wider than the buttons beside it, and the arrows that step it had to be dropped
to make even that fit. A second row buys back both. **The four controls that go somewhere share
the first row equally**; the period takes the second, where **the two arrows are equal in size
and the label between them is larger**, because the label carries a date to be read and an arrow
carries only a direction. The pane still fits a 320 px viewport, and neither row drops a control
or lets one wrap away.

- **Leftmost, the view switch and the zoom.** One slot always holds the way to the other kind
  of view: a board icon in a calendar view, and on the board a calendar icon, which returns to
  the month view. The board is not a zoom step, which is why it has a slot of its own rather
  than a place in the zoom's list. Beside it the **zoom**, drawn as a magnifier — described
  below.
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

  **Clicking the label opens the picker**, and that is the only thing it does — in every view
  and on a phone as much as on a desktop. **There is no caret `▾`.** The caret existed only
  because the label's own tap was taken by the zoom; the zoom is a button of its own now, so the
  label is free to be the one thing it was always read as — the period, pressed to pick another.
  This is also what the board has always done, so the two kinds of view no longer differ in what
  their label means. The label carries no glyph saying it is pressable: it takes a hover and a
  press background, as the year view's month caption does.

  The picker shows a month at a time, with its name top left and left/right arrows top right.
  Clicking the month name switches to a year grid of 9 years ending with the current one, whose
  arrows page by 9 years. Today is highlighted in it, and tapping it is how you get back to today
  — there is no jump-to-today button in the pane. In the kanban the picker picks a sprint: its
  rows read `Sprint 7 · 19 Jan – 1 Feb`, and the row holding today reads
  `current · 19 Jan – 1 Feb` on a brighter background in dark mode, a darker one in light.

  **The two arrows stand well clear of the label.** On a desktop the gap either side of it is
  about half an arrow — three controls crammed together read as one control, and this is the
  group the pane is used through. On a phone the second row keeps its tight gap, because there
  the arrows are flexible halves and every millimetre of gap is taken off a thumb's target.

  **On a phone the `‹` `›` are on the second row, drawn at the size of the first row's icons.**
  They were larger than everything above them, which made the row that steps the period louder
  than the four that leave it. And **there is no swipe anywhere in the calendar**: the label was
  swiped only because the arrows were not there to press; now that they have a row of their own
  they are, and a gesture doing what a visible button does is the same second mechanism this
  document refuses a card on a desktop. So no sideways gesture does anything, in any view, and
  nothing ever has to be told apart from a card drag on the board or from a scroll in a grid.
- **Rightmost, the two ways out.** A **hamburger** button that names its two errands — `filter`
  and `settings` — and opens whichever is tapped, and a home icon back to the Mine tile screen. A
  house rather than an arrow, because a third arrow beside the two that step through periods reads
  as another way to move inside the calendar.

### The zoom

A magnifier beside the view switch, opening a short list under itself. **It offers what the view
it was opened in can do, and nothing else:**

| view | the list |
| --- | --- |
| day, week, month, year | `day` · `week` · `month` · `year` |
| kanban | `vertical` · `horizontal` |

The current one is marked. In a calendar view this is the whole of the zoom: it replaces the
label's cycle, which walked year → month → week → day → year and so asked for up to three taps
to reach the view you wanted and gave you no way to see which one you were in without reading
the label. A list of four names you point at is one tap and says both. There is still no `-` and
no `+` in the pane, and no `D` `W` `M` `Y` `K` row across it either — the four names are in a
popup, not spread along the row the period lives on.

On the board the same button carries the board's own one choice, its **orientation**, because a
board has no period to zoom. The two never appear together: a calendar view cannot be stacked
and a board cannot be a week.

**The orientation is remembered per device** and starts at `horizontal`. It is a preference
about this screen, like *confirm discard*, so it is kept where the rest of them are and has a
row in neither the panel nor the repo. The calendar's own zoom is **not** remembered: the app
opens on the month, on today, on the current sprint, as it always has — which view you were last
in is where you were, not what you prefer.

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
  reads as a caption but is pressable, with a hover and a press state, and clicking it opens that
  month in the month view — landing on the month you pointed at rather than the one the anchor is
  in. The whole label is the target, so it stays finger-sized where a day in a year grid is not.

  **At most six months to a row.** The months reflow with the width — four, three, two as it
  narrows — but never more than six, so a year reads as two even rows of six rather than as ten
  and then two. Now that the window is as wide as the browser, the extra width goes into wider
  months with readable day cells; a grid free to keep adding columns spends it on more of them
  instead, and twelve does not divide by seven, eight or ten.
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

The popup **opens in the middle of the screen**, on a phone as much as on a desktop — and so do
the settings panel and the day preview. Nothing rises from the bottom edge any more. A centred
card is reached with either thumb and does not pretend to be a drawer that can be dragged. The
hamburger's menu and the filter hang off the hamburger instead, as dropdowns, and a field's own
popup hangs off its row; those three name the thing they came from, which a centred card cannot.

**There is one popup, and it is both.** Clicking an entry — in any grid, in the day preview, or
as a card on the board — opens the entry, shown as text, and **every value in it is edited where
it is read**: click the thing, change it, and one save at the top writes the lot. There is no
pen, no second popup behind one, and no mode to be in.

It was two before, a read-only preview with a pen into a form, and the reason was sound: a form
answers *what day is this on* in input boxes, which are harder to read than text and leave every
value one slip away from a tap meant to scroll. Editing in place keeps that — a row is text until
it is clicked, so there is still nothing to slip into — and gives back the two things the split
cost. A change was four taps before the field was even typed into: open, pen, row, and back. And
the preview and the
form had to agree about every field twice over, in two blocks of code, which is how one of them
came to show the stage and the other to hide it.

**Each row is edited in place, and one save writes.** The rows hold a draft; nothing reaches the
repo until the popup's own disk, so **one entry edit is one commit** and the popup is one
transaction rather than a stream of them. A row that writes the file the moment it is saved was
tried on paper and gives this popup three faults it cannot see: the entry it is holding goes a
generation stale after the first write, a saved date moves the file out from under it, and four
rows saved offline queue four writes to one path. One save at the end has none of them.

**The disk appears only once something differs from the file**, and it is the only button in the
popup that writes. A popup opened to read has no save in it to wonder about — which is most
openings — and a save that is there is a save with something to do.

```
[☑]                                  [trash] [x]      opened, nothing changed
[☑]                          [trash] [disk] [x]       a row has been changed
[☑] [📅]                             [disk] [x]       a new one: the type is still a choice,
                                                      and the disk is disabled until it has a title
[☑] [this|all]               [trash] [disk] [x]       a repeating one: the scope pair
```

The top row carries **the type**, then right-aligned a trashcan to delete the entry, the disk
once there is something to save, and an `x` to close. On an entry that already exists the type is
a **marker, not a choice** — a ticked square for a task, a calendar page for an event, shown and
not pressable — because a task turned into an event drops its stage, its importance and its
estimate, and the type is settled when the entry is made. On a new entry it is the pair, with the
event selected. On a repeating one the **scope pair** follows the marker, left of the gap —
described below.

The trashcan stays at the left of that group: deleting is not an edit of a field, it writes at
once whatever the draft holds, and the board's rule that a card is deleted from its popup in two
taps depends on the trashcan being on the first of them.

Below the row, in this order: the **title**, the **when**, the **toggle row**, the **five field
rows**, and the **details body** last. Nothing about repeating is among them.

### A row, and a row being edited

Every row is **the icon, then the value** — no field name beside it:

```
[ball]    Work                                      [trash]
[pin]     Conference room 3B                        [trash]
[repeat]  Repeat
[bell]    Alerts
```

The name is gone because it said the same thing as the icon it sat beside, in the one column
where the value has to fit. **An unset row shows the field's name in its place, muted** — which
is what an empty input does everywhere else in Mine, and what keeps a bell from being a bell and
nothing else. A set row reads as a value; an unset one reads as an invitation.

- **The rows never move.** Every row is in the canonical order below whether it is set or not.
  Set rows used to be lifted to the top, which moved a row the moment it was filled — so the
  field just typed into was no longer where it had just been looked for. That is the same
  complaint as a row that grows, and it has the same answer: the popup's shape does not depend
  on what is in it.
- **A set row carries a trashcan at its right**, which clears that field in the draft. An unset
  row has nothing to clear and carries none.
- **Opening a row does not change its height.** This is the rule the rest of this section serves.
  A row that grew a heading and a control beneath it moved every row under it, so a popup opened
  to type one word rearranged itself and the eye had to find the field again. Every row is the
  height of the tallest thing a row can hold — its trashcan and its `x`, which a set row already
  carries shut — and nothing a row opens is taller than that.
- **A field whose control fits a line holds it in the line.** The title, the location, the alerts
  and the participants become an input where their value was, at the same size, **with the field's
  name as the placeholder rather than a heading above it**: a heading was the line the row grew
  by, and it named what the icon beside it already said. The trashcan and the `x` stay at the
  right of that same line, where the closed row's trashcan already was, so the way out of a row is
  in the corner it is in everywhere in Mine. **The title row is the one with neither**, because an
  entry must have a title and so there is nothing to clear, and because the popup's own `x`, which
  discards the whole edit, is a thumb's width above that line; it closes on Escape or by opening
  any other row.
- **A field whose control cannot fit a line opens it in a popup anchored to the row.** The when,
  the category, the repetition and the estimate: four date and time boxes, a list of categories, a
  rule with an end condition, a number with a unit. The row keeps its icon, its value and its
  trashcan — **nothing about it moves** — and the popup hangs directly under it, naming the field
  and carrying an `x`. The estimate's is the one that also carries the trashcan, because its row
  is an icon on the toggle row with no room beside it.
- **The field popup carries no scrim**, alone among the calendar's overlays. A scrim would stop
  the tap that dismisses it, so moving from one field to the next would take two taps; without one
  the tap reaches the row it landed on and opens it. Tapping the row it is already on closes it
  rather than reopening it.
- **The `x` closes the row and keeps what is in it.** There is nothing to accept: the editor has
  been writing into the draft since the first keystroke, which is what lets the disk appear the
  moment something differs from the file. So closing a row is only closing it — a field typed
  into is not undone by leaving it, which is what a tap meant for the row below would otherwise
  do. Clearing the field is the trashcan beside the `x`, and undoing the edit of a whole entry is
  the popup's own `x`. There is exactly one save in this popup and it is the one in the top row.
- **Enter closes the row, and only the row.** It used to submit the form, so the key that ended
  a word saved the entry and left for the calendar — the one gesture a popup opened to type one
  word must not make. It closes the row like the row's own `x`, keeping what is in it, and the
  disk in the top row stays the only thing that writes. **Shift+Enter is left alone**, which is
  what puts a new line in the details textarea. Inside a field's own popup Enter is not the row's
  Enter and does nothing: that popup closes by its `x` or by Escape.
- **There is no keyboard save.** The disk is a button in the top row, reached by Tab and pressed
  by Enter or space like any other. A shortcut that wrote and closed would be the thing Enter was
  just stopped from doing, under a different key.
- **Only one row is open at a time**, and a line's input and a field's popup are never both open.
  Opening either closes the other, which likewise keeps what is in it.
- **Escape unwinds the one layer there is.** A field popup swallows it, so Escape inside a field
  does not throw away the edit the field is part of. **An inline row does not** — it is the row in
  its editing state rather than a layer over anything, and leaving it loses nothing, so Escape
  there keeps meaning *leave the popup*. A new entry opens with its title row already an input,
  and making that swallow the first press would cost two presses to leave the commonest popup in
  the app. The row's own `x` is what closes a row.
- **Clicking a row's trashcan does not activate the row.** This is the rule a kanban card already
  holds to, and it matters more here, because the trashcan now sits on the surface being tapped.
  The row and its controls are one place where a click that does two things is easy to build.

**Five of the six fields are rows**, in this canonical order:

- a ball for **category**;
- circular arrows for **repetition**;
- a bell for **alerts**;
- a pin for **location**;
- a person for **participants**.

The sixth, **details**, is not a row: it is the body, and it is drawn in full at the foot of the
popup — described below. A markdown body is the one value that cannot be read on one line, so a
row is the wrong shape for it, and putting it first in the canonical order pushes everything else
below the fold on any entry with an agenda in it. It keeps its place in the canonical order of
fields everywhere that order is a list of fields; it simply is not one of the rows.

**No editor writes to the repo.** The field popups write into the draft exactly as the inline
rows do, so the old rule that a sub-popup never writes is not a carve-out any more: nothing
below the top row's disk writes at all. **The body is the one field whose open shape still
carries a line of its own** — a textarea cannot have its name and its buttons beside it — and
that line is the same header the closed body already shows, so nothing moves there either. **That
header is the only name it carries**: the open body is the textarea and nothing else. A label
reading *Notes* under a header reading *Details* named the field twice, and a line explaining that
the box held raw markdown said what the monospace face already says. The group manager behind
*edit groups* is the one overlay here that does write, and it is not editing a field of an entry.

**Picking a category takes it.** Tapping a group puts it in the draft and closes the popup —
there is nothing more to say about a choice from a list, and with no save in it there is nothing
for a second tap to press.

### The title, the when, and the toggle row

**The title is a row too** — text until clicked, then an input in the same line at the same size.
So is **the when**, which reads `MON, 20.11.2026 · 09:00–10:00` and opens the start and end date
and time boxes in a popup under it. Four input boxes at the top of a popup opened to find out what
day something is on was the form at its least readable; four of them also cannot be a line, which
makes the when the clearest case for the popup — the row goes on reading the day while they are
open, and only takes the new reading once they are shut.

**The times are typed, not a native time control.** `HH:MM`, and forgiving about how it is reached:
`9` and `900` and `9:00` all read back as `09:00`, `930` and `0930` and `9:3` as `09:30`, and
anything that is not a time of day is refused and the box goes back to what the draft still holds.
A native `<input type="time">` takes its 12- or 24-hour shape from the device's locale and nothing
in markup, CSS or a `lang` attribute can tell it otherwise, while [every other time in the
calendar is 24-hour by construction](#the-filter-and-the-settings). **The two dates stay native**,
because a date picker is worth more than a format and a date, unlike a time, cannot be misread
into a different value.

The when-line no longer repeats the stage, the importance and the estimate as words. The toggle
row shows all three, live, directly beneath it.

### The toggle row

One row of icons directly under the when. These are not fields with an editor each: they are
small values, edited in the row itself with a single tap, and they **show their value** rather
than merely whether they have one — each as a small badge on the corner of its icon.

**A tap on one of them is the whole edit**, into the draft like everything else — there is
nothing in these four to type, so there is nothing for a row's `x` to put back and no editor to
open. The disk appears on the first tap, as it does for any other change.

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
- an hourglass for **estimate** — the one of the four that opens an editor, because a number has
  to be typed. It opens **in a popup under the hourglass**, so the toggle row keeps its one line
  like every other row. That popup is the one that carries the trashcan itself, because its row is
  an icon with no room beside it. Its badge reads the day count as `2d`.

On an event, stage, important and estimate are not there at all, because an event has none of
them. They sit here so that a task that is not on a board still carries the two fields a kanban
card edits.

Neither lit control — `24h` or `!` — is the disk's green: in all of Mine green is a save and red
is a trashcan, and a green toggle beside the disk would make the popup look like it offers two
primary actions.

### The details body

Last in the popup, and **shown in full and rendered** — not clipped to two lines, not as raw
markdown — by [Mine's shared renderer](../REQUIREMENTS.md#markdown-bodies). Two lines on a card
and the whole text here are the difference between a glance and having opened the thing, and that
is the one thing the old preview existed for, so it is not spent on making the body look like the
rows above it.

It carries a small header of its own: the `lines` icon, and the trashcan at the right when there
is a body to clear. **Clicking the body makes it active**, replacing the rendered text with the
raw markdown in a textarea and putting the `x` in that same header beside the trashcan. A body
is read far more often than it is written, which is the same argument the rows make, with more
text behind it — and the body's header is the shape every open row takes, since a textarea is
the clearest case for why the buttons do not sit under the editor.

### A new entry

A new entry is **a draft like any other edit**, and no row behaves differently in it. It opens
with its title row active and the when seeded from wherever it was made — the cell, the day
preview's `+`, or a kanban column header, which seeds the stage as well — and every other row is
live from the start. The disk creates the file; until it is pressed, a `+` opened and thought
better of leaves no file and no commit.

**The disk is disabled until the title has something in it**, because an entry must have one.
That is the only way a new entry differs from an edit of a saved one, and it is a disabled button
rather than a rule about which row may be touched first.

### A repeating entry

A repeating entry carries one thing the rest do not: **the scope pair**, `this` or `all`, in the
top row immediately right of the type marker. It governs **what the two writes in that row do** —
the disk and the trashcan both — and it is one choice about one write, which is what it always
was. Switching it rebuilds the draft from the other file, so it also resets what a discard is
measured against.

It sits in the top row because that is where the controls it governs are. Below the title it
needed a line saying *Part of a repeating entry* to explain itself; beside the marker, between
the type and the trashcan, it explains itself, and that line is gone with it.

**It reads `this` and `all`, not the noun.** The entry behind it is a task as often as an event,
and the marker a thumb's width to its left already says which; a pair reading *all events* above
a ticked square would be wrong on half the entries that have one. Two words also fit a top row
that already holds a marker, a trashcan, a disk and an `x` without wrapping on a phone.

**There is no `skip this one`.** Skipping one occurrence is what the trashcan does when the pair
says `this` — a delete scoped the same way a save is, by the same control, rather than a link
that did one of the two things on the row by another name. With `all` the trashcan deletes the
whole entry, which is what it always did. Both ask first.

Only the series carries the rule, so **the repetition row is absent on an occurrence override** —
a rule the popup must not rewrite has no row at all.

### Saving, and leaving

The disk **closes the popup and returns to the calendar immediately**; the push to GitHub runs in
the background and is reported in the sync line, not in the popup. **Both ways out land on the
calendar**, the disk and the `x` alike. The cell or the card behind it shows the result anyway,
and there is no preview left to step back to.

Deleting the entry, by either scope, also closes the popup, because it leaves nothing to look
at.

### Discarding an edit

**Leaving a popup that holds unsaved changes asks first.** The popup's `x`, a click on the
backdrop and Escape are one way out and ask one question: a small centred prompt offering
**discard** or **keep editing**. A popup that has not been touched closes without a word — the
question is about losing work, and there is none to lose, which is also when there is no disk in
the top row to have missed. A half-written new entry counts as work: it is as easy to lose as an
edit of a saved one, and one rule covering both is shorter than two with an exception between
them.

**A row's own `x` is not guarded**, and has nothing to guard: it closes a row and keeps what is
in it. Nothing is lost by pressing it, which is the whole reason it is not the one that asks.

The prompt carries a **don't ask again** toggle. Ticking it silences the prompt on that device for
good, so the `x` goes straight back to discarding. That is a preference about this screen's
behaviour rather than data, so it is stored on the device like the rest of them — and it has a
row in the panel's settings section, because nothing in Mine may be switched off from a place
that cannot switch it back on.

What the merge changes about losing work is only where it is typed. The unit is still the whole
popup, the question is still asked once, and the disk is still the one thing that writes — so an
entry is never half-written to the repo, and a row left open when the disk is pressed is taken
along with the rest.

### Repetition

A dropdown, not an RRULE field:

```
does not repeat · daily · weekly · every 2 weeks ·
monthly on the x-th · monthly on the x-th weekday · yearly
```

below it an **ends** control: never, on a date, or after a number of occurrences. Both sit in
the repetition row while it is active, and **the row stays open when the dropdown changes** —
unlike the category's list, which closes on the tap, because a rule is the two controls together
and `weekly` taken the moment it is chosen would be a rule with no end yet.

Files may be hand-written or imported, so a rule the dropdown cannot express — `the last Friday
of the month`, `Mondays, Wednesdays and Fridays` — is shown as a non-selectable **custom** state
displaying the rule as text, with a note that choosing an option will replace it. Saving the entry
without having touched the dropdown leaves the rule untouched. No hand-written rule is ever
silently rewritten.

### Category

**One list, two forms.** It is the same list of groups wherever it is opened, each with its
colour — but what it lets you do depends on where you came from, and the two sets of controls
never appear together.

- **Reached from an entry it only picks**, in the category row, and **a tap on a group closes
  the row**. The groups and nothing else: no pen, no trashcan, no `+ add category`. Naming,
  recolouring and deleting a group are settings, and an entry popup is not where a list the whole
  repo shares should be rewritten — least of all by a trashcan a thumb's width from the group
  being aimed at. The way to clear the field is the row's own trashcan, as in the other five, so
  there is no `no category` row in the list either: that was a second way to do what the row's
  trashcan already does, in the same place in every row.
- **Reached from the panel's *edit groups* it only manages.** Every group with its
  colour, a pen, a trashcan and a `+ add`, and no way to pick one, because nothing is being
  filled in. Adding a group asks for a label and a colour; its stored name is derived from the
  label and never shown, which is why relabelling or recolouring later touches no entry. Entries
  still naming a deleted group render grey.

This is **the only place in the calendar where a group is named or coloured**. One list, because
two would have to be kept in step and neither would gain anything by it.

Managing is **the one place the old sub-popup mechanism survives**, because it is not editing a
field of an entry: it is reached from the panel, it writes `groups.md` the moment a row commits,
and it has no entry around it to write into. That is also why it keeps a popup of its own rather
than becoming a row — there is no row it could be.

## Kanban

Three columns — **todo** (red), **doing** (yellow), **done** (green) — holding one sprint's
tasks. Every task is a card and every card is a task; events never appear.

**The board is capped and centred**, in both orientations, where the calendar window is as wide
as the browser. A card is read at the width a sentence is read at; a third of a wide monitor is
mostly empty card.

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
selector sits in the top pane, because one board shows one sprint, and the filter is behind the
hamburger like everywhere else. On the board that filter gains an assignee and a single
**important only** toggle — one switch, now that importance is a yes or no, where four priority
chips used to ask which tiers you meant.

### Vertical and horizontal

The board has one choice of its own, in the zoom: **horizontal**, the three columns side by side,
or **vertical**, the three stages stacked one under the other, each full width.

Horizontal is the default and is the board as it was. Vertical is for the sprint that does not
fit: three columns side by side give each a third of the width and all of the height, which is
the wrong way round for a stage holding fifteen cards and one holding none. Stacked, each stage
takes the whole width and only the height its cards need, and the board is read by scrolling
down — the direction everything else in Mine is read in.

- **A stacked stage keeps its header**: the coloured name and the `+`, as before.
- **The phone's `‹` `›` pager is horizontal's alone.** It exists because exactly one column is
  on screen and it is the only way to see another; stacked, all three are already there, so
  there is nothing to page and the header carries neither arrow. The rule that **exactly one
  column is visible** likewise describes horizontal on a phone and says nothing about vertical.
- **A card keeps its own `<` `>` on a phone in both**, because a phone has nothing to drag onto,
  and **a desktop card is dragged between stages in both**, because a stacked stage is as good a
  drop target as a column.
- Vertical is not a phone layout: it is offered at every width, since a desktop board can be as
  lopsided as a phone's.

A card shows:

- a top row with the title, and a `!` in front of it when the task is important. **No pen and no
  trashcan.** The pen said what clicking the card already does — and there is no pen anywhere in
  the calendar now. The trashcan put the one irreversible action on the board, a thumb's width
  from the title you were aiming at. **On a
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

**A card is deleted from the entry popup, not from the board.** Clicking the card opens the
entry; that popup's trashcan deletes the whole entry, or drops the single occurrence of a
repeating task when its scope pair says `this`. Two taps rather than one, and no reachable
trashcan on a surface whose whole purpose is to be tapped.

**There is no sprint control anywhere.** A sprint is derived from the start date, so moving a
task to another sprint *is* changing its date, and the date is the only way to do it. A control
that rewrote the date to mean the same thing was a second truth to keep in step with the first.

**Clicking a card opens it; clicking a control on a card does not.** The phone's `<` `>` move the
card and nothing else follows — the click must not also reach the card beneath and open the entry
popup on top of the move. This holds for every control a card may ever carry, and it is the
reason a card may carry none that is not worth the care.

On desktop all three columns are shown and a card can be dragged between them, and each header is
its stage's name, centred, with the `+` at its right and **no `‹` `›`** — with every column on
screen there is nothing for a per-column pager to page. On a phone, **horizontally**, one column
fills the screen and its header pages between the three: `[‹] doing [›]`, the two buttons
flanking the stage name on a background of their own — because the `<` `>` on a card mean
something else entirely, they move that card. Stacked, there is nothing off screen to page to,
so a vertical board's headers carry no arrows at any width.

**The pager fills the header.** The two arrows are equal, flexible halves taking the whole width
left of the `+`, the stage name centred between them, and each sits on a background **slightly
brighter than the header's own**, so the target is visible and not merely large:

```
[     ‹     ]   doing   [     ›     ]  [+]
```

This is the control pressed most often on a phone board, because it is the only way to see
another stage — and a small square in the middle of an otherwise empty row asked a thumb to aim
at the narrowest part of it. Filling the row needs no width re-tuned per screen and cannot
outgrow a 320 px one. **A disabled arrow keeps no background at all**, flat against the header at
todo and at done, which is what tells it from the one that still works; the pair is disabled
rather than wrapping.

**There is no swipe on the board**, and none anywhere else in the calendar either. A sideways
gesture on a column or on a card does nothing; the sprint is stepped by the `‹` `›` in the top
pane's second row — so no gesture here ever has to be told apart from a drag.

**Exactly one column is visible at a time**, on a phone, horizontally. No part of the next
column may show at the edge of the screen: a sliver of `done` beside `doing` is a layout fault,
and the cause is always the same — a gap between columns in a strip that is shifted by whole
column widths. Stacked, all three stages are on screen by design and this says nothing.

Cards are not reordered by hand; their order comes from importance and start — the important ones
first, each block by start date.

## The filter and the settings

**One button, two errands, named before either opens.** The hamburger opens a short dropdown
reading `filter` and `settings`, and opens neither of them; a second tap opens the one that was
meant. One button still covers both, so the pane stays at four controls and the phone's first row
does not gain a fifth — but the button no longer decides which of the two you came for.

They were one panel for a while, under a heading each. A heading is a weak way to separate a thing
you open daily from a thing you open twice, and it cost the filter the room to show its groups:
the list had to be folded away or it pushed the nine settings rows below the fold. Naming the two
and opening them apart costs one tap and buys each of them its own shape.

**The filter is a dropdown off the hamburger.** It is the half you open often — a group hidden
this afternoon, the board narrowed to what is important — and the view it narrows has to stay in
sight while it is narrowed, which a centred card over the middle of the screen cannot do.

**The settings are a centred panel**, titled `Settings`, whose top right has an `x` to close.
They are the nine rows that change once, so they may take the middle of the screen.

| overlay | holds |
| --- | --- |
| Filter (a dropdown) | a checkbox per group; on the board also **important only** and an **assignee** |
| Settings (a centred panel) | the nine rows below |

**The groups are listed, not folded behind a dropdown.** One checkbox per group, each showing its
colour, straight away — one tap to hide a group instead of two. The fold existed for one reason,
that an open list pushed the nine settings rows below the fold, and that reason went with the
settings. A repo with twenty groups scrolls inside the dropdown rather than growing it past the
screen. This is a view filter and is remembered per device; groups are *named and coloured* in the
settings panel's **edit groups**, not here.

**Times read 24-hour everywhere, and are typed that way.** The hour gutter in the week and day
grids, a time on a card, a time in a row — all `HH:MM`, with no setting to change it and no
12-hour form anywhere. There is no *time format* row beside *date format* because there is nothing
to choose. The one control that could have disagreed was the native time input in the when popup,
which took its shape from the device's locale; [it is a typed box
instead](#the-title-the-when-and-the-toggle-row).

**Every row is two halves: the label in the left half, its control in the right.** That one rule
is what the panel was missing. A select, a text box, a checkbox and a date field each began
wherever its own label happened to end, so nine tidy rows read as a ragged column — and the fix
is alignment, not fewer settings. The controls now line up in one column down the panel.

Nine rows, and the labels are short enough to fit their half on one line at 320 px — which is
why two of them are no longer named after the kanban:

| row | control |
| --- | --- |
| Groups | an **edit groups** button |
| Start week on | Monday or Sunday |
| Time zone | a zone name such as `Europe/Berlin`, defaulting to the device's own |
| Date format | `auto` (the device's locale), `dd.mm.yyyy` or `mm/dd/yy` |
| Calendar weeks | the month view's week-number gutter |
| Confirm discard | whether leaving an edited popup asks before discarding |
| Sprint length | in weeks |
| First sprint | the date sprint 1 starts on |
| Theme | system, light or dark |

Those are labels only: the two renamed rows still read and write `kanban-interval` and
`kanban-anchor` in the repo, because renaming a row must not rewrite a file.

**Groups are behind the button, not listed in the panel.** *Edit groups* opens the category
popup in its manage-only form — every group with its colour, a `+ add`, a pen and a trashcan. A
list in the panel grew with the repo and pushed the nine settings that never change below the
fold, which is the one thing a settings panel must not do. The checkbox list in the filter is a
different thing: it hides and shows, it names and colours nothing, and it is in an overlay with
nothing below it to push.

**The panel ends at its last settings row.** There is no paragraph under it explaining what is
stored where. That rule is the next two paragraphs, and it belongs in this document rather than
on a screen you opened to change the theme.

A zone name, not an offset: a plain `UTC+1` is an hour wrong for half the year in any zone with
daylight saving. This zone, not the device's, decides which day a timed entry lands in, where it
sits in the week and day grids, and what a time you type means. All-day entries are bare dates
and are never run through it at all. The week view's label carries its ISO week number whether
*calendar weeks* is on or off: that row governs the month view's gutter and nothing else.

Everything in either section is stored on the device except the groups, the sprint length and the
first sprint date, which are data and live in the repo so they follow you and mean the same thing
everywhere. The board's orientation is a device preference too, and the one of them with no row
here: it is picked in the zoom, where it is read as a view control rather than as a setting.
Theme and date format apply to all of Mine, not the calendar alone, and the main app's settings
shows the same two rows.

## On a phone

The views above describe the desktop. The same screens adapt:

- The top pane is **two rows**: `[board] [zoom] [☰] [⌂]` sharing the first equally, and
  `[‹] [NOV/26] [›]` filling the second, at twice their old size and at every phone width, 320
  px included. The two arrows are equal, **drawn at the size of the icons on the row above**, and
  the label between them is larger than either and opens the picker. Nothing is swiped.
- A month cell shows at most two entry lines, then `+N`; a line carries the title alone, with no
  time prefix and no done-rectangle, clipped at the cell's edge. A year cell stays a coloured
  day.
- Tapping a day in the month or year view opens that day's entries as a centred card, each one
  tappable, with the small `+` and `x` in its top right — so nothing is ever smaller than a
  finger. Tapping a month's name in the year view zooms into that month instead.
- The kanban, **horizontally**, shows one column at a time, paged by the `‹` `›` in its header,
  which **fill the header's width** either side of the stage name on a background brighter than
  it. Stacked, all three stages are on screen and no header carries an arrow. Either way its
  cards keep their own `<` `>`, because there is nothing to drag a card onto.

**Every view fits a 320 CSS px viewport**, with the week gutter on and whatever the entries happen
to be — the two-row top pane and the double-size kanban header included. **Nothing in the app
moves sideways**: no view scrolls or extends horizontally, in any view, at any width, and no
gesture moves anything sideways either, there being none left. A view that demands
more width than
the screen has is a defect even when it looks right on a desktop, and a cell insisting on room
for a time, a title and an icon at once is the usual cause — seven of them across a phone is
where it shows. `test/run.sh` checks every view at 320 and 360 px, in light and dark; see
[../TEST-REQUIREMENTS.md](../TEST-REQUIREMENTS.md).

## On the main screen

The tile screen of the main app shows today's entries and the next one coming up.
