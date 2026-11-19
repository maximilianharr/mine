# Calendar

Calendar is an app of [Mine](../REQUIREMENTS.md) to manage your calendar. Every entry is one
markdown file in the data repo, so your calendar stays readable and portable without this app.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for the file format.

## What an entry holds

A title, a type — **event** or **task** — a start and end, a group, a location, participants,
alerts, and a free markdown body for the agenda, checklist or notes.

A task can be ticked done. An event cannot. Entries can repeat, and a repeating entry can have
single occurrences skipped, moved or ticked off without affecting the rest.

## Layout

A navigation pane at the top and a big calendar window below it.

In the top pane, from left to right:

- Left/right buttons to move to the previous/next day, week, month or year, depending on the
  current view.
- The current day/week/month/year, with a small downward arrow for a dropdown date picker. The
  dropdown shows a month at a time, with its name top left and left/right arrows top right.
  Clicking the month name switches to a year grid of 9 years ending with the current one, whose
  arrows page by 9 years.
- A dropdown to choose the view: day, week, month or year.
- A dropdown to filter by group. Each group shows its colour; double-clicking one lets you edit
  its label and colour.

All views show **7 columns, Monday to Sunday**, with weekends tinted so the work week still
reads as a block. A Saturday task has to be visible.

## Views

- **Year** — every month, each with a `M T W T F S S` header row and one row per week. The
  current day is highlighted. A day with entries takes the background colour of its group, split
  between colours if there are several. Clicking a day shows that day's entries. Groups switched
  off in the filter are not shown.
- **Month** — one row per week. Entries appear as rows inside each day cell, sorted by time, all
  day items first. Tasks have a rectangular icon on the right to tick them done. Clicking empty
  space in a cell creates an entry; clicking an entry opens it.
- **Week** — columns are the days, rows are the 24 hours.
- **Day** — the week view for a single day, with more detail per entry.

## Entry popup

A title row; below it a button group to choose the type; below that the remaining fields; below
those an auto-growing monospace box holding the markdown body. A `discard` and a `save` button
at the bottom.

The body is written and shown as raw markdown, so what you see is exactly what lands in the file.

## On a phone

The views above describe the desktop. On a phone a month cell is about 50px wide, so entry rows
are neither readable nor tappable. The same screens adapt:

- The top pane collapses to `[<] [April 2026 v] [=]`.
- Month and year cells show group-coloured dots instead of rows of text.
- Tapping a day opens a sheet listing that day's entries, each one tappable, with an
  `+ add entry` button — so nothing is ever smaller than a finger.

## On the main screen

The tile screen of the main app shows today's entries and the next one coming up.
