# Mine — test requirements

What has to be checked before a change ships, and how. [REQUIREMENTS.md](REQUIREMENTS.md) says
what the apps do; this says how we find out whether they still do it.

There is no CI and no test framework. `test/run.sh` drives a real browser against the real app
and prints one line per check, so running it is the whole of it:

```
test/run.sh                 the checks
test/run.sh --shot DIR      the checks, and a screenshot of each view into DIR
```

It needs `chromium` and node 20 or newer on the PATH, installs nothing, and writes nothing into
the repo. A failing check prints what it got and what it wanted, and the script exits non-zero.

## Why a browser and not unit tests

Almost everything that has actually broken here is a layout or a wiring fault — a grid track
that will not shrink, a button that stops being wired when its markup moves, a key written into
the frontmatter that should have been left out. None of those show up in a function test. The
model arithmetic that *is* worth testing in isolation (dates, sprints, recurrence expansion) is
pure and lives in `calendar/data.js`, whose `buildModel` takes files rather than reading them,
so it can be exercised from node against the same markdown the browser mirrors.

## How the harness works

`test/serve.py` serves the working tree, plus one synthetic route, `/__fixture.json`: a month of
entries generated for *the month the checks run in*. A fixture pinned to a fixed date would
leave the month view empty and every check green. It holds what has historically broken things —
long titles, timed entries, a day with more entries than a phone cell shows, all-day items, a
Saturday task.

`test/check.mjs` connects to Chromium over the DevTools protocol, seeds that fixture into
IndexedDB with a throwaway config, and drives the app by clicking the real buttons.

Two things about it are deliberate and easy to get wrong:

- **The viewport comes from `Emulation.setDeviceMetricsOverride`, never from `--window-size`.**
  Chromium's headless mode lays the page out at a fixed 500 px and then *scales the capture* to
  the window size, so a 320 px screenshot taken with `--window-size` is a picture of a 500 px
  layout. It passes a fit check that a real phone fails. This cost an afternoon once.
- **The config holds a fake token.** The mirror is local, so every view renders from it; the
  push fails and writes a line into the sync indicator, which is correct and is not a failure.
  Nothing in the checks talks to GitHub, and no real token ever goes near a browser profile.

## What is checked

**Every view fits a phone.** Day, week, month, year and kanban, at 320 and 360 CSS px, in light
and dark. The test is `scrollWidth === clientWidth`: nothing may extend past the screen, in any
view, at any width. 320 px is the floor because it is the narrowest phone still in use and it
leaves room for Android's display-zoom setting, which makes a wider screen behave like a
narrower one.

This is the check that earns its keep. The month grid once ran 1239 px wide at a 360 px
viewport, and it looked perfect on a desktop the whole time: a `1fr` track is
`minmax(auto, 1fr)`, and a cell holding a `white-space: nowrap` title has that whole title as
its minimum width, so seven cells grew to fit their text rather than sharing the screen. A grid
cell that holds text needs `min-width: 0` or it does not shrink. The other offender was the
period label in the top pane, which is long enough in the week and sprint views to overflow a
narrow phone on its own.

**The entry popup's icon row, toggle row and field rows.** That the icon row holds icons alone,
with no letter anywhere in it, and that it holds nothing but the type pair and the three on the
right — task, event, then close, delete, save — with no field icon and no dash left in it.

That a new entry is an event and its toggle row holds the sun by itself; that choosing a task
puts stage, priority and estimate on that same row and switching back to an event takes all
three away again. That stage cycles through three stages in three badge colours and back, that
priority cycles 1, 2, 3, none with the digit on its own colour, and that the estimate opens a
popup prefilled with one day, badges `3d` once set and loses its badge once cleared. That all-day
lights with the ordinary enabled background and never with `--good`, because green is the save
button's. That the row sits **below** the start and end fields, not above them — resolved from
the elements' document order, since a row that merely looks right can still be the old one.

That the six field rows read details, category, repeat, alerts, location, participants, in that
order on a task and on an event alike, each one carrying its icon and its name; that every field
has a row whether it is set or not; that setting one moves its row above the unset ones while the
order inside each group stays canonical; that a set row shows the field's value and no pen; and
that a set row carries no enabled background, because position and value are what say it is set.

**The popup is centred.** At 320 px, that the entry popup, a field sub-popup, the settings panel
and the day preview each sit clear of the bottom edge — their bounding box's bottom is above the
viewport's, and their top below it. Nothing in the app is a bottom sheet any more, and a card
that still stretches to the bottom edge is the old sheet in new paint.

**The top pane.** That it holds no Today button, no `+`, and no `-` or `+` zoom pair — the two
zoom buttons are gone, and a check for their absence is what keeps them gone. That **clicking the
label walks the zoom** year → month → week → day → year, round the cycle, with nothing disabled
at an end. That on the board clicking the label opens the sprint list instead and does not zoom.
That the **caret is a button of its own** and opens the picker, and that clicking the label does
not open it. That the board icon reaches the kanban and is a calendar icon there, returning to
the month view, and that the home icon leaves for the Mine tile screen. That the label reads
`NOV/26`, `W47/NOV`, `FR 20/NOV`, `2026` and `7` in the five views, and that the week label keeps
its ISO number with *show calendar weeks* off.

**The pane's order and its phone layout.** That the controls run board, filter, then the centred
period group, then settings and home — read from their left edges, so a reordering that looks
right but wires the wrong button cannot pass. That at 320 px the pane is **one line**: every
control's bounding box shares the same row, none wraps to a second, and none is dropped. That
the `‹` `›` are not rendered at that width, and that a horizontal swipe on the label steps the
period while the same swipe on the grid below it changes nothing.

**The month fills the window.** That the month grid's bottom edge reaches the bottom of the
calendar window — within a pixel or two of the sync line above the viewport's end — rather than
stopping at the height its cells happen to need, and that it does so at 320 px and on a desktop
alike without the page gaining a vertical scroll. That a cell still shows at most four lines on
a desktop and two at 320 px: the rows got taller, the cap did not change.

**A month cell.** That a task line carries no done-rectangle, and that a long title is clipped
with no `…` — resolved from the computed `text-overflow` and the line's width against the
cell's, not from a screenshot. One-tap done must still be there in the week grid, the day grid
and the day preview.

**The year view.** That clicking a day opens the day preview, and that clicking a month's name
zooms into the month view showing the month that was clicked — not the month the anchor happened
to be in.

**The kanban on a phone.** That exactly one column is visible: the next column's left edge is at
or past the viewport's right edge. This is the check the sliver of `done` beside `doing` failed,
and a gap reintroduced between the columns must turn it red. That the header's `‹` `›` page
between the columns and are disabled at todo and at done, that a sideways touch gesture on the
board changes nothing, and that a column header's `+` opens a new task in that stage. That the
header carries **no card count and no colour dot**, and that the stage name is drawn in its own
stage colour — red, yellow, green — resolved against the same table the cards use.

**The kanban on a desktop.** That a column header has no `‹` `›` at all, since every column is on
screen, and that **a card has none either** — a card's top row is a trashcan, a pen and the
title, and the stage is changed by dragging. On a phone the card keeps its pair, so the same
check must come out the other way at 320 px.

**A save is green and a trashcan is red**, in the entry popup, a field sub-popup, a kanban card
and the settings panel. The check resolves `--good` and `--bad` from the page rather than naming
colours, so retheming does not break it. Both are **glyphs**: the save's `--good` must be its
text colour and its background must be transparent. A filled green button anywhere in Mine is a
failure, so the check reads the background as well as the colour — that is the half of it that
can catch a regression to the old style.

**What a saved task writes.** A new task saved with nothing but a title must land as
`stage: todo` with `estimate: 1`, and a task whose estimate was cleared must have no `estimate`
key at all — not an empty one, and never `None`. This is the check that holds the file format
to [calendar/TECHNICAL-REQUIREMENTS.md](calendar/TECHNICAL-REQUIREMENTS.md), and it reads the
file back out of the local mirror rather than trusting the form.

## A check must be able to fail

Before trusting a new check, break the thing it covers and watch it go red. A fit check written
against `--window-size` passes on a broken layout; a colour check that names `#0a7b3e` instead
of resolving `--good` passes when the token changes underneath it. Removing `min-width: 0` from
`.day` must turn the month fit checks red, and putting it back must turn them green.

## What the harness cannot tell you

Headless Chromium on a desktop is not a phone. It does not cover:

- **the real device** — a system font scale, a notch, a software keyboard, Safari's and
  Chrome's own quirks. Serve the tree with `python3 -m http.server` and open it from the phone
  on the same network, or push and open the live URL.
- **installing to the home screen, the service worker and the update banner** — these need an
  installed app over HTTPS. `spike/` covers the platform questions and needs no token.
- **GitHub sync**: pulling, the one-commit drain, conflict files, an expiring token. Only a real
  token against the real data repo exercises those, and that is done by hand.

A change to any of those three is checked on a device before it ships, and
[TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) records what was found and when.
