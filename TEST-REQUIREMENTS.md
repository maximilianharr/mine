# Mine — test requirements

What has to be checked before a change ships, and how. [REQUIREMENTS.md](REQUIREMENTS.md) says
what the apps do; this says how we find out whether they still do it.

There is no CI and no test framework. `test/run.sh` runs the model checks in node and then
drives a real browser against the real app, printing one line per check, so running it is the
whole of it:

```
test/run.sh                 the checks
test/run.sh --shot DIR      the checks, and a screenshot of each view into DIR
```

It needs `chromium` and node 20 or newer on the PATH, installs nothing, and writes nothing into
the repo. A failing check prints what it got and what it wanted, and the script exits non-zero.

## Why mostly a browser

Almost everything that has actually broken here is a layout or a wiring fault — a grid track
that will not shrink, a button that stops being wired when its markup moves, a key written into
the frontmatter that should have been left out. None of those show up in a function test, which
is why the bulk of the checks drive the real app.

The exception is the model arithmetic — dates, ISO weeks, sprints, recurrence expansion, the
zone conversion, and what a write actually serialises.
It is pure: `calendar/data.js` imports
nothing that needs a DOM, and `buildModel` takes files rather than reading them. A date bug there
surfaces in the browser as a cell in the wrong place, a minute into the run, which is the worst
possible instrument for it. So `test/unit.mjs` calls those functions directly and runs first.

## How the harness works

`test/unit.mjs` is plain node — no framework, no dependencies, same one-line-per-check output.
It imports `calendar/data.js` and asserts against values: that `addMonths('2026-01-31', 1)` is
the 28th, that `isoWeek('2027-01-01')` is 53, that an occurrence overridden in the date tree
reads as `done` while its neighbours read as `todo`, that a wall-clock time inside the hour a
zone skips in spring resolves to something stable rather than drifting an hour on every save,
and that an empty field is omitted from the frontmatter rather than written as `None`.

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

**One popup, opened on a row of text.** That clicking an entry — in a grid, in the day preview
and as a card on the board alike — opens a popup containing **no input, select or textarea at
all** until something in it is clicked, and that its top row runs trashcan, `x` with **no pen and
no disk** in it: a check for each one's absence is what keeps the old split from growing back.
That the type is shown as something not pressable on an entry that already exists, and as the
live pair on a new one. That a `+` or a click on empty space opens the same popup.

**The disk appears exactly when something differs from the file.** That a popup opened and not
touched has **no disk**; that changing any one thing — a row, a toggle, the title, the when —
makes one appear; and that putting it back by hand makes it **go away again**, which is the check
that the disk reads the same comparison the discard prompt does rather than a flag set on first
touch. That the disk is the **only** control in the popup that writes: no row, no toggle and no
list leaves anything in the repo on its own, read from the queue being empty until it is pressed.

**Every value is edited where it is read, and opening it does not move the row.** This is the
measurement the whole shape exists for, so it is a height and not a look: that an open row is
**exactly as tall as it was shut**, read off `getBoundingClientRect()` for the row that opened and
for every row in the popup, set and unset alike. A pixel of growth is a row below it having moved,
which is the eye losing the field it has just tapped.

For the title, the alerts, the location and the participants: that clicking it puts an **input in
the line itself**, that the field's name is gone from the line and is the input's placeholder, and
that the row carries **a trashcan and an `x` and no save** — one save in the popup, in the top row
— with all three on the input's own line and the `x` rightmost, resolved from their top edges and
left edges. That **the title row carries neither**, the popup's own `x` being a thumb's width
above it. That the row's `x` **closes the row and keeps what is in it**, and still writes nothing.
That clicking a second row closes the first the same way.

For the when, the category, the repetition and the estimate: that clicking it opens `#fpop`
**under the row**, that the row's height, its text and the number of rows in the popup are all
unchanged, that the row holds no control of its own, and that **no scrim is raised** — the tap
that dismisses this popup has to reach the row it landed on. That tapping a different row moves
straight to it in **one tap**, and that tapping the row it is already on **closes** it rather than
reopening it. That `#fpop`'s own `x` closes it and leaves the entry popup open. That no `#sub`
popup is opened by any of the nine.

That only one is open at a time, an inline input and a field popup never both. That **Escape is
swallowed by a field popup and not by an inline row**: in a field popup it closes that and leaves
the entry popup open, and in an inline row it asks the discard question, the row staying as it is.
A new entry opens with its title row already an input, so a row that swallowed Escape would cost
two presses to leave the commonest popup in the app.

**One edit is one commit.** That editing four things in one popup and pressing the disk queues
**one** write, and that the file then holds all four values. This is the measurement a popup
writing per row could not pass, and it is the reason for the draft, so it is checked as a count
and not only as an outcome.

**The trashcan on a row.** That a set row carries one and an unset row does not, and that the
estimate's lives in its popup's head instead, its row being an icon with no room beside it. That
it clears the field in the draft — the row drops to its muted name and the disk appears — and that it does
**not** write on its own. That **clicking a row's trashcan does not activate the row**: the field
is cleared and no input appears, which is the same rule a kanban card holds to and matters more
here, the trashcan now being on the surface being tapped.

**A row shows its value, not its name.** That a set row's text is the value — `Work`, not
`Category Work` — and that the field's name appears **nowhere** in a set row. That an unset row
shows the field's name in its place, in the muted colour and not the plain one, resolved from the
computed colour against the two tokens rather than from a screenshot. That the **five** rows read
category, repeat, alerts, location, participants in that canonical order on a task and on an
event alike, with **details not among them** — it is the body at the foot, and a details row
appearing in the list is the body having been flattened into one; that **every one of the five
has a row whether it is set or not**; and that **setting one does not move its row** — the index
of the row before and after filling it is the same — because a row that moves when it is filled
loses the field as surely as a row that grows.

**Picking a category closes its popup.** That tapping a group puts the label in the row and closes
the popup in one tap, with nothing pressed after it and the entry popup still open, and that
**nothing is written** — the queue is still empty and the disk is now showing. That the repetition
popup, by contrast, stays open when its dropdown changes, because a rule is the dropdown and the
ends control together.

**Times are typed and 24-hour.** That the when popup holds **four** boxes whose types are
`date, text, date, text` — never a native `<input type="time">`, which would take its 12- or
24-hour shape from the device's locale. That `9`, `900`, `0815`, `7:5` and `23:59` read back as `09:00`,
`09:00`, `08:15`, `07:05` and `23:59`, and that `25:00`, `9:70`, `noon` and `99` are **refused**,
the box going back to what the draft still holds. That the row does not restate the time while the
popup is open — that is what keeps it still — and reads it the moment the popup closes.

**A new entry is a draft like any other.** That a `+` opens the popup with the title row active
and **every other row live** — clicking one opens its editor — with the when seeded from where it
was created, and that a `+` in a kanban column header seeds the stage, read off the toggle row.
That the **disk is disabled until the title has text** and enabled once it has, resolved from the
disabled state and not from how it looks. That closing it writes **nothing**: no file appears and
the queue is empty, which is what keeps a stray `+` from leaving an `Untitled` behind.

**The shared renderer, and the body.** That a details body holding `## Agenda`, a `- ` bullet, a
`- [x]` and a `- [ ]`, `**bold**` and a link renders as a heading element, a list with a ticked
and an unticked box, a bold element and an anchor whose href is the link's — and that a
`javascript:` URL in the same body produces no anchor at all. That a body containing
`<script>alert(1)</script>` puts that text on the screen and adds **no script element to the
document**: the renderer builds nodes and never markup, and this is the check that keeps it so.
That a ticked checkbox is not pressable. That the body is **rendered and shown in full** when the
row is inactive — the whole text, not a clipped line — and that clicking it replaces the rendered
nodes with a textarea holding the raw markdown, with its `x` at the foot.

**The toggle row.** That a new entry is an event and its toggle row holds `24h` by itself; that
choosing a task puts stage, important and estimate on that same row and switching back to an
event takes all three away again. That stage cycles through three stages in three badge colours
and back; that **important is a toggle and not a cycle** — two taps return it to where it started,
it carries no badge and no digit, and there is no third state to reach; and that the estimate
opens its editor **in a popup under the hourglass**, leaving the toggle row's own height and row
count untouched, prefilled with one day, badges `3d` once set and
loses its badge once cleared. That a tap on any of the four **changes the draft and not the
repo**: the disk appears, the queue stays empty. That `24h` and `!` light with the ordinary
enabled background and never with `--good`, because green is the disk's, and that nothing else in
the popup lights at all. That the row sits **below** the when row, not above it — resolved from
the elements' document order, since a row that merely looks right can still be the old one.

**That the `x` is the rightmost control in every popup**: the entry popup, each active row, each
field popup, the day preview, the filter dropdown and the settings panel. Resolved from the buttons' left edges, so a row that reads
correctly but was built in the old order cannot pass — and a check that only counted three
buttons would have passed on the old order, which is why this one reads their positions. That the
top row runs trashcan, disk, `x` in that order once the disk is showing.

**A repeating entry, which the fixture carries.** Nothing in it repeated before, so the scope
pair and the override paths had no entry to run against at all. That the pair is in the **top
row**, reading `this` and `all`, **right of the type marker** in document order, and named in
full — `This occurrence`, `All occurrences` — for a screen reader that has two words to go on.
That it is **on one line with the `x`** at 900px *and at 360px*: `.iconbar` wraps, so a pair that
stretched would put the trashcan and the `x` on a line of their own, and only the narrow
measurement can catch that. That **nothing of it is left among the rows** — no `.seg`, no
`.scope`, no line saying the entry repeats, no `skip this one`. That a save with `this` writes an
override and leaves the series file alone, and that the same change saved with `all` writes the
series and no override — the two must be checked separately, or a scope that is read but ignored
passes. That the **repetition row is absent** on an occurrence override, since only the series
carries the rule. That switching scope and then leaving **asks nothing** and leaves **no disk**
showing: switching rebuilds the draft from the other file, so it has to retake the baseline too,
and a baseline left behind is what puts a disk in an untouched popup and makes every way out ask
about changes nobody made.

**The trashcan reads the scope pair.** `skip this one` is gone and the trashcan does both jobs, so
which one it does has to be checked from the pair rather than taken on trust. That with `this` it
is labelled `Skip this occurrence`, **asks first** — `Skip "…" on YYYY-MM-DD?` — and then leaves
the rule file **in place with an `exdate` added**, not deleted; that with `all` it is labelled
`Delete every occurrence`, asks about the whole entry, still warns that override files stay
behind, and the rule file is **gone**. `confirm()` has no answer in a headless browser, so it is
stubbed and the question read back from what the stub recorded — which is also the only way to
check the wording. These two run **last** of the repeating checks, because the second deletes the
fixture's only rule file.

**Enter closes the row, not the entry.** The popup is a real `<form>`, so this is about native
implicit submission: a synthetic `KeyboardEvent` cannot trigger it and so cannot prove it has
stopped. The press goes through CDP's `Input.dispatchKeyEvent` with the element focused first,
because the one listener reads the event's target. That Enter in the title row **leaves the popup
open**, closes the row it was pressed in, leaves the typed title in the draft, and **writes
nothing** — compared against the queue length before the press, not against zero, since earlier
checks have saved entries. That **Shift+Enter in the details textarea leaves the row open and
puts a newline in it**, which is the browser's own default and the whole reason that case is a
bail-out. That plain Enter in the same textarea closes the row and keeps the text. And that Enter
**inside a field's own popup** does neither — `#fpop` is outside `#f-rows`, and that boundary is
what one listener buys instead of five.

**The open details row carries no name of its own.** That it holds **no `label` and no `small`**,
no line about raw markdown and no second reading of *Notes*, the row's own `DETAILS` header being
the one name it needs — and that the textarea carries `aria-label="Details"`, unseen, because a
screen reader has no header to read it against.

**Discarding asks once, and only when there is something to lose.** That the `x` on a popup
nothing has been typed into closes it with no prompt; that changing something and then pressing
the popup's `x`, clicking the backdrop or pressing Escape each raise the same prompt; and that
**keep editing** leaves the popup open *with the change still in it*, which is the half of a
discard dialog that usually goes wrong. That ticking **don't ask again** and reopening a popup
makes the next `x` discard without asking, and that the settings panel's `Confirm discard` row
turns the prompt back on.

That **a row's own `x` never prompts** — it closes a row and keeps what is in it, so there is
nothing to lose by pressing it — and that a row opened and closed without typing leaves the popup
with no disk showing, so merely activating a row is not a change. That the prompt and the disk
agree in both
directions: nothing typed means no disk and no prompt, something typed means both.

**The hamburger's menu.** That **one button still covers both and opens neither**: the hamburger
is the only way in, there is no gear and no filter button anywhere in the pane, and one tap opens
a menu whose rows read `filter` and `settings` with the filter dropdown and the settings panel
both still hidden. That the menu hangs under the hamburger and within its right edge, read from
the two bounding boxes. That tapping `filter` opens the filter **alone** and tapping `settings`
opens the panel **alone**, each with the other and the menu hidden — a check that fails the moment
the two are merged back into one overlay. That the filter hangs under the hamburger rather than
being centred, because the view it narrows has to stay in sight while it is narrowed.

**The settings panel.** That it holds the nine rows and **no filter section** — `#filter-body` is
not inside it. That the nine are two halves — every label's box in the left half of the row and
every control's box in the right — so the controls' left edges all agree, which is the one
measurement that separates the new panel from the old. That no label wraps to a second line at
320 px. That **groups are not listed in it**: it holds one *edit groups* button, which opens the
same list the category row opens, and that **only this way in carries the pen, the trashcan and
the `+ add`** — reached from an entry the same list has none of the three and no `no category` row
either, which is the check that keeps the two forms apart. That the panel's last element is a
settings row and **not a paragraph of explanation**. That the last of the nine rows is **above the
fold at 320 px**, which is now unobstructed: there is no filter section above them to push them
off the screen.

**The popup is centred.** At 320 px, that the entry popup — with its tallest row active, the
details body's textarea — the settings panel and the day preview each sit clear of the bottom
edge — their bounding box's bottom is above the
viewport's, and their top below it. Nothing in the app is a bottom sheet any more, and a card
that still stretches to the bottom edge is the old sheet in new paint. **And the day preview is
centred on a desktop too**, measured at 900 px, because it is no longer anchored to the cell that
opened it — the check that catches a third overlay mechanism growing back.

**The filter dropdown.** That the groups are **listed, not folded**: there is no `groups`
dropdown row and a checkbox per group, each with its colour, is there straight away. That ticking
two of them still shows two groups and hides the rest, because a list is no excuse for the filter
having become single-select. That on the board the filter adds an assignee and **one** important
toggle, that neither appears in a calendar view, and that no `P1`, `P2` or `P3` chip is left
anywhere in it.

**The top pane.** That it holds no Today button, no `+`, no `-` or `+` zoom pair and **no caret
`▾`** — a check for each one's absence is what keeps it gone. That **clicking the label opens the
picker**, in every one of the five views and at 320 px as well as on a desktop, and that it does
**not** zoom: the label's one job is the picker now, and a cycle left behind on it would show up
as the view changing under the open picker. That the board icon reaches the kanban and is a
calendar icon there, returning to the month view, and that the home icon leaves for the Mine tile
screen. That the label reads `NOV/26`, `W47/NOV`, `FR 20/NOV`, `2026` and `7` in the five views,
and that the week label keeps its ISO number with *show calendar weeks* off.

**The zoom.** That the magnifier opens a dropdown **anchored under itself** — its top edge below
the button's bottom, as the picker's is — and not a centred card, which is the check that keeps
the app at two overlay mechanisms. That in a calendar view it lists exactly `day`, `week`,
`month`, `year` and marks the current one; that picking each lands in that view; and that it
lists **no** `vertical` or `horizontal` there. That on the board it lists exactly `vertical` and
`horizontal`, marks the current one, and lists none of the four periods — a popup offering a
period on the board is the view switcher growing a second head. That the orientation **survives a
reload** and the zoom level does not: reopening lands on the month view with the orientation last
picked.

**The pane's order and its phone layout.** That on a desktop the controls run board, zoom, then
the centred period group, then hamburger and home — read from their left edges, so a reordering
that looks right but wires the wrong button cannot pass. That at 320 px the pane is **two rows**:
board, zoom, hamburger and home share the first with their bounding boxes on one line and none
dropped, and `‹`, the label and `›` share the second. That the four on the first row are of equal
width, and that the label on the second is **wider than either arrow** — which is the whole
reason the second row exists, so a layout that splits the pane but leaves the label narrow has
not done the job. That **no horizontal swipe does anything**: the same gesture on the label, on a
grid and on the board leaves the period, the sprint and the layout exactly as they were.

**The period group's spacing and its arrows.** On a desktop, that the gap between `‹` and the
label and between the label and `›` is **about half an arrow glyph** — measured as the distance
between their bounding boxes, against the arrow's own font size, within a reasonable tolerance —
because the point is a visible separation, not a number. At 320 px, that the second row's `‹` and
`›` are drawn at **the same size as the first row's icons**: the arrows' font size resolves to
the same value as the board and home icons' box, and in particular is **not** the 2 rem it used
to be, which is the regression this check exists for.

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
opens the month view showing the month that was clicked — not the month the anchor happened to be
in. That **no row holds more than six months**: measured at 1920 px, where the uncapped grid fit
ten, the months' top edges resolve to two distinct rows of six. And that it still reflows below
that — at 320 px a row holds fewer than six, so a grid frozen at six columns fails the same
check from the other side.

**The day view has no day header.** That the day view renders the all-day strip and the hour grid
and nothing above them, and that no element in it carries the weekday-and-date pair the top pane
is already showing. That the **week** view still has its seven, and that clicking one still opens
the day preview — the same check must come out the other way in the two views, or a rule that
removed both would pass as one that removed one.

**The kanban on a phone, horizontally.** That exactly one column is visible: the next column's
left edge is at or past the viewport's right edge. This is the check the sliver of `done` beside
`doing` failed, and a gap reintroduced between the columns must turn it red. That the header's
`‹` `›` page between the columns and are disabled at todo and at done; that the two of them
**fill the header's width** up to the `+`, are of equal width, and leave the stage name centred
between them; that an enabled one has a background and a disabled one has none, so the pair
cannot be made large by making the disabled one look live; that a sideways touch gesture on the
board changes nothing; and that a column header's `+` opens a new task in that stage. That the
header carries **no card count and no colour dot**, and that the stage name is drawn in its own
stage colour — red, yellow, green — resolved against the same table the cards use. Each of these
is read with the orientation set to horizontal, which is also the default, so none of them may be
written in a way that a stacked board would satisfy by accident.

**The kanban stacked.** With `vertical` picked in the zoom, at 320 px and at 900 px alike: that
**all three stages are on screen**, their boxes stacked — each one's top below the previous one's
bottom — and each as wide as the board; that **no header carries a `‹` or a `›`** at either
width, since there is nothing off screen to page to; that each header keeps its coloured name and
its `+`; and that a card on a phone keeps its own `<` `>`, which move it as before. That the
board **does not extend sideways** at 320 px, the rule that holds in every view. And that
switching back to `horizontal` restores the one-column strip and its pager, so the two layouts
are reachable from each other and not a one-way door.

**The kanban on a desktop.** That a column header has no `‹` `›` at all in either orientation,
since every stage is on screen, and that **a card has none either** — the stage is changed by
dragging, **in both orientations**: a drop onto a stacked stage moves the card exactly as a drop
onto a column does. On a phone the card keeps its pair, so the same check must come out the other
way at 320 px.

**What is full width and what is capped.** At 1920 px: that the month grid's right edge reaches
the window's, within the pane's own padding, in the day, week, month and year views — a calendar
that still stops at 78 rem leaves a margin this check measures. That the **board does not**: the
columns' bounding box is at most 78 rem wide and is centred, in both orientations. And that the
**top pane is full width in both**, measured in a calendar view and on the board and found to be
the same — the pane narrowing with the board is the failure mode of capping `#cal` instead of the
board, and it is invisible until the two widths are compared.

**What a card holds, and what it no longer holds.** That a card's top row is the title alone,
with a `!` in front of it when the task is important and nothing in front of it when not; that
the `!` is **not a button** — no element bearing it is pressable; and that the card carries **no
pen, no trashcan, no estimate, no sprint number and no priority chip** — and there is no pen
anywhere in the calendar to find. On a desktop the card
holds no pressable element at all, and on a phone only the two stage arrows: the count is what
keeps the removed controls removed, since each of them came back once as a chip.

**Clicking a control on a card does not open the ticket.** That tapping the phone's `<` or `>`
moves the card and leaves the entry popup closed, and that clicking the card's body does open it,
with no input element in it until a row is clicked.
This is the check for the bug where the board's own click delegation matched the card from inside
one of its buttons, so both happened at once; it must be written so that a handler that stops at
the button but lets the event bubble turns it red.

**A save is green and a trashcan is red**, in the popup's top row, on a field row, and in the
groups popup — no longer on a kanban card, which has no trashcan to colour. The check resolves
`--good`
and `--bad` from the page rather than naming colours, so retheming does not break it. Both are
**glyphs**: the save's `--good` must be its text colour and its background must be transparent.
A filled green button anywhere in Mine is a failure, so the check reads the background as well as
the colour — that is the half of it that
can catch a regression to the old style.

**What a saved task writes.** A new task saved with nothing but a title must land as
`stage: todo` with `estimate: 1`, and a task whose estimate was cleared must have no `estimate`
key at all — not an empty one, and never `None`. The same holds for importance: a task marked
important writes `important: true`, an unmarked one writes **no `important` key**, and no file
ever gains `important: false`. That a file carrying `important: true` reaches the toggle row lit
and one without the key does not. There is no `priority` and no `done` to read any more, and
`unit.mjs` asserts that neither is honoured — put either reader back and those two checks go red.
This is the check that holds the file format to
[calendar/TECHNICAL-REQUIREMENTS.md](calendar/TECHNICAL-REQUIREMENTS.md), and it reads the file
back out of the local mirror rather than trusting the form.

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
