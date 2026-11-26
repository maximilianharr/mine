# Notes

Notes is an app of [Mine](../REQUIREMENTS.md) for quick notes, in the spirit of Google Keep. Every
note is one markdown file in the data repo, so your notes stay readable and portable without this
app.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for the file format.

## What a note holds

A **title**, **tags**, and a free markdown **body**. The file also records when the note was
created and when it was last updated; neither is edited by hand in the app.

**The title is required**, as a calendar entry's is: every card and every search result has a
name to be found by.

**Tags are plain words**, as many as you like, in lower case, a space becoming `-`. They have no
colour and no file of their own: a tag exists as long as some note carries it, and the list of
tags anywhere in the app is the list the notes carry.

There is nothing else — no pin, no archive, no colour, no reminder. A deleted note is deleted;
the repo's history is the archive. Each of these is one frontmatter key away if it is ever
wanted.

## Layout

The header at the top, and a grid of cards below it, **the most recently updated first**.

```
[+] [search]                       [filter] [☰] [⌂]
```

The header is **one row at every width**, a phone at 320 px included: the five buttons are the
calendar's own, drawn the same size, and there is no period to need a second row. On a phone the
five share the width equally.

- **`+`** opens a new note. Notes have no cell to create one in, so the header carries it.
- **search** opens Mine's search over `notes/`.
- **filter** opens the filter, a dropdown off its button.
- **☰** names `settings` and `logs`, and opens whichever is tapped.
- **⌂** goes back to the Mine tile screen.

**The header can be dragged to the bottom of the screen, and back**, exactly as the calendar's
pane: hold it for a moment, a button included, drag it into the other half and release. At the
bottom the sync line moves to the top. Where it is docked is **one setting for all of Mine**: dock
it at the bottom in the calendar and it is at the bottom here too.

The sync line sits below the cards, or above them when the header is docked at the bottom, and is
a button to the logs, as in the calendar.

## The cards

A card shows the **title** in the serif, then the **body rendered** by [Mine's shared
renderer](../REQUIREMENTS.md#markdown-bodies) and cut off after about eight lines, then the
**tags** as `#home #shopping`, and the **updated date** in Mine's date format. A note with an
empty body is a title, its tags and its date.

**One column on a phone, more as the screen widens** — two, three, four — each column a stack of
cards of their own heights, as Keep lays them out. The order runs down the first column and then
the next, which is what CSS columns do; reading order across the top row is not kept, and a grid
of notes is scanned rather than read in sequence.

Tapping a card opens the note. A checkbox on a card is drawn, not operated, as everywhere in
Mine.

With nothing to show, the grid says so: `No notes yet — + makes one`, or, with a filter on,
`No notes match the filter`.

## The note popup

**The calendar's popup, with fewer rows.** A note opens in the middle of the screen, shown as text
and rendered, and **every value is edited where it is read**: tap the title and it is a text box,
tap the body and it is a textarea of raw markdown. There is no pen and no mode.

```
                                     [trash] [x]      opened, nothing changed
                             [trash] [disk] [x]       something has been changed
                                     [disk] [x]       a new one; the disk is disabled until it has a title
```

Below the top row: the **title**, the **tags row**, and the **body** last.

- **The disk appears only once something differs from the file**, and it is the only thing that
  writes. One save is one commit, and it sets `updated`. The disk closes the popup.
- **The trashcan** asks the browser's own confirm, then deletes the file and closes the popup.
- **The `x`**, a tap on the backdrop and Escape close it. With unsaved changes they ask first —
  **discard** or **keep editing**, with a **don't ask again** — the calendar's prompt, and the same
  setting: ticking *don't ask again* in either app silences it in both, and the settings row in
  either turns it back on.

**The tags row** reads `#home #shopping`, or a muted `Tags` when there are none. Tapping it opens
a small popup off the row with a checkbox for every tag any note carries — this note's ticked —
and a box to type a new one, which is added and ticked on Enter. Unticking a tag removes it from
this note only.

**The body** is shown in full and rendered. Tapping it replaces it with the raw markdown in a
textarea; the textarea grows with its text.

**A new note** opens empty with the title active, so the keyboard is up at once. Nothing is
written until the disk; a `+` thought better of leaves no file.

## Search

The magnifier opens Mine's search over `notes/` and nothing else. A note's title, body and tags
are searched, and a result is dated by its `updated`. A result opens the note **over** the
search; closing it comes back to the search as it was. Search ignores the filter.

## The filter, the settings and the logs

**The filter** is a dropdown off the funnel with a checkbox per tag, alphabetically, and
`untagged` last. **With nothing ticked every note shows.** Ticking tags narrows the grid to the
notes that carry **any** of them — `#home` and `#work` together show both — and `untagged` adds
the notes with no tag. It is the reverse of the calendar's filter, where everything starts ticked:
with dozens of tags, "show me these" is the common case and "hide those" is not.

It is remembered per device, and **a filter that is on says so on its button**: the number of
ticked tags, in a small circle at its top right. A tag that no note carries any more drops out of
the filter by itself.

**The settings** are a centred panel with three rows, all of them Mine-wide:

| row | control |
| --- | --- |
| Theme | system, light, dark, coffee or neutral |
| Date format | `auto`, `dd.mm.yyyy` or `mm/dd/yy` |
| Confirm discard | whether leaving an edited popup asks first |

**The logs** are Mine's shared logs panel, as in the calendar.

## On a phone

Every screen fits a 320 CSS px viewport, light and dark, and nothing moves sideways. The cards
are one column; the popup and the panels are centred cards, as in the calendar.
