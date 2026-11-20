# Calendar — technical requirements

File format and rendering for [REQUIREMENTS.md](REQUIREMENTS.md). Sync, caching and writes are
in [../TECHNICAL-REQUIREMENTS.md](../TECHNICAL-REQUIREMENTS.md).

## Paths

```
calendar/2026/04/2026-04-18-1400-k3f9.md     one-off entry
calendar/2026/04/2026-04-25-0000-ov1q.md     occurrence override
calendar/recurring/trash-p7qm.md             entry with a recurrence rule
calendar/groups.md                           group -> colour and label
calendar/settings.md                         kanban anchor and interval
```

The whole folder is mirrored locally, so the path is not a loading optimisation. It is for
humans: the repo browses chronologically on github.com, and no directory grows past a month of
entries. `-k3f9` is 4 random characters, **not** a counter — two devices creating entries offline
on the same day must never mint the same name. No title slug, so retitling is never a rename.

**The path is never the source of truth.** It is derived from `start` at creation; after a move
or an override the two can disagree. Always read `start`. Changing an entry's date is a rename,
which is a delete plus a create in one commit.

Entries with a `recurrence:` rule live in `recurring/` rather than the date tree, because an
open-ended rule must render in months it was not created in and there is no month folder to find
it under.

## Frontmatter

RFC 5545 (iCalendar) naming wherever one exists, so `.ics` export is close to a field copy.
**Empty keys are omitted, never written as `None`** — `None` is a YAML string, not null, and a
parser hands back the text `"None"`.

| Key | Applies to | Notes |
| --- | --- | --- |
| `title` | both | required |
| `type` | both | `event` or `task` |
| `start` | both | `DTSTART`. A bare date (`2026-04-18`) is all-day; a timestamp (`2026-04-18T14:00:00Z`) is an instant |
| `end` | both | same value types as `start`; omitted when a single all-day item |
| `group` | both | a name, resolved through `groups.md` |
| `stage` | `task` only | `todo` / `doing` / `done`. Replaces the old `done` boolean |
| `priority` | `task` only | `PRIORITY`, 1-9. The UI writes 1-3, and those three read back unchanged; a hand-written 4-6 reads as 2 and 7-9 as 3 |
| `estimate` | `task` only | days. Ours, no RFC 5545 equivalent |
| `location` | both | free text |
| `alerts` | both | minutes before start, `0` = at start. Stored and exported only; nothing fires in the background |
| `participants` | both | list of email addresses |
| `recurrence` | both | RRULE string, e.g. `FREQ=WEEKLY;BYDAY=SA` |
| `exdate` / `rdate` | recurring | occurrences to skip / extra occurrences |
| `status` | override | `cancelled` removes the occurrence. The only value used |
| `series` | override | id of the recurring file it belongs to |
| `recurrence-id` | override | the original occurrence date this file replaces |
| `conflictOf` | conflict file | written by sync |

No `duration` key — it is `end - start`.

Type and time are independent: `type` decides whether the entry has a stage, a priority and an
estimate, the value type of `start` decides whether it is all-day or timed. A task is usually
all-day, but may carry a time and then renders at it.

`stage` is a task's only progress field; there is no `done` key any more. A file written before
the change, or by hand, is read for `done` as a fallback: `done: true` is stage `done`, anything
else is `todo`. Nothing rewrites such a file until it is edited, and a write never emits `done`.

`status` is deliberately *not* the stage field. It already means cancellation on an override,
and one key cannot carry both without an override's cancellation reading as a kanban column.

The bare-date form matters. An all-day task stored as `2026-04-18T00:00:00Z` lands on the wrong
day outside UTC and shifts twice a year on DST.

The markdown body is the entry's content and is preserved byte-for-byte by anything that does not
explicitly edit it.

## Overrides

A recurring file states the rule only. Anything that happens to a *single* occurrence — ticked,
moved, retitled, cancelled — is an override file in the date tree carrying `series:` and
`recurrence-id:`, holding only the keys that differ. The rule file is never rewritten, and since
each override is a fresh path it cannot conflict, even when two devices do it offline.

`exdate:` covers a plain skip where there is nothing to record.

## Rendering a range

1. Collect dated entries whose `start` falls in the range.
2. Expand every rule in `recurring/` over the range; drop dates in `exdate`, add `rdate`.
3. Replace an occurrence with the override matching `series` + `recurrence-id`; an override
   marked cancelled removes it.
4. Drop groups switched off in the filter.
5. Sort: all-day first, then by start time.

Index overrides by `` `${series}|${recurrenceId}` `` once per load; a linear scan per occurrence
is what makes month views slow.

## RRULE

Full RRULE on read — files may be hand-written or imported. The UI *writes* only the seven
shapes its dropdown offers, plus the ends control:

| Dropdown | Written |
| --- | --- |
| does not repeat | key omitted |
| daily | `FREQ=DAILY` |
| weekly | `FREQ=WEEKLY;BYDAY=<start's weekday>` |
| every 2 weeks | `FREQ=WEEKLY;INTERVAL=2;BYDAY=<start's weekday>` |
| monthly on the x-th | `FREQ=MONTHLY;BYMONTHDAY=<x>` |
| monthly on the x-th weekday | `FREQ=MONTHLY;BYDAY=<n><DD>` |
| yearly | `FREQ=YEARLY` |
| ends on a date | `+UNTIL=<yyyymmdd>T000000Z` |
| ends after n | `+COUNT=<n>` |

Anything the dropdown cannot round-trip to one of those is held as **custom**: displayed as
text, not editable, and written back byte-for-byte unless the user picks a dropdown value. The
test is round-tripping, not parsing — `FREQ=MONTHLY;BYDAY=-1FR` parses fine and is still custom,
because no dropdown entry regenerates it.

`rrule.js` works in UTC. For an all-day rule, set `DTSTART` to UTC midnight and read only the
year/month/day back, never `getDate()` on a local Date — east of UTC that returns the previous
day. `UNTIL` must be written in the `Z` form.

## Groups

`groups.md` is a markdown file whose frontmatter maps a group name to a colour and a label. An
entry stores the name, so recolouring or relabelling is a one-file edit instead of a rewrite of
every entry, and there is no cap on the number of groups. Unknown group renders grey. It lives in
the data repo, so the mapping follows you across devices.

## Settings

Two of the settings are data, not preferences, and live in `calendar/settings.md`:

```yaml
---
kanban-anchor: 2026-01-05     # bare date: the first day of sprint 1
kanban-interval: 2            # weeks
---
```

With no `settings.md` at all the anchor is `2024-01-01`, a Monday, and the interval is 2 weeks.
That fallback is a constant rather than anything read off the device, so two devices still agree
on the numbering before the file exists.

They are in the repo because the sprint a task belongs to is *derived* from them. On the device
they would make the same file report a different sprint on a phone than on a laptop, and moving
a card would then write the wrong date. Everything else — theme, date format, time zone, week
start, show-calendar-weeks, the group filter — is a device preference in IndexedDB, the group
filter under `calendar.hiddenGroups` as it already is. Theme and date format are Mine-wide keys,
not the calendar's.

## Sprints

There is no `sprint` key. Sprint *n* runs from `anchor + (n-1) × interval` weeks for `interval`
weeks, and a task's sprint is whichever range its `start` falls in. So:

- the number can never contradict the date, because there is only the date;
- moving a card to another sprint is a write of `start` and `end` and nothing else;
- changing the interval renumbers every card at once, which is correct — it is one timeline.

Computed on bare dates in whole days, never through a `Date` at local midnight: the anchor is a
bare date and sprint boundaries must not shift by a day with the viewer's zone. A `start` before
the anchor has no sprint and the card is not on the board.

## Time zone

One IANA zone name, defaulting to `Intl.DateTimeFormat().resolvedOptions().timeZone`, decides
which day a timed entry falls in, its minute offset within that day, and what a wall-clock time
typed into the form means. A bare date never goes near it.

The offset is read off the zone's own wall clock with `Intl.DateTimeFormat.formatToParts`, so
daylight saving comes for free and no table is needed. Converting a typed time to the stored
instant takes **two passes**, because the offset depends on the answer: a time within an hour of
a DST change resolves on the first pass with the wrong offset and on the second with the right
one. A wall-clock time that does not exist — the hour a zone skips in spring — resolves onto the
real time just before the gap, which is stable: it reads back as that time instead of drifting on
every save.

Read the hour with `% 24`: some engines answer `24` for midnight under `hour12: false`.

An unknown zone name falls back to the device's rather than throwing, because a bad value in
settings must not stop the calendar rendering.

## Modules

```
calendar/data.js      the model, the date and sprint arithmetic, and the writes
calendar/ui.js        DOM helpers, the icon set, and the state every view reads
calendar/views.js     year, month, week, day, and the day preview
calendar/kanban.js    the board
calendar/popup.js     the entry popup and its field sub-popups
calendar/settings.js  the settings panel
calendar/app.js       the top pane, navigation, the picker, the filter, the sync line
shared/prefs.js       theme and date format, which belong to Mine rather than to one app
```

`ui.js` holds the state in one object with `render`, `status`, `push` and `reload` as slots the
shell fills in, so a view can ask for a redraw or a background push without importing `app.js`
back and making an import cycle.

`FIELDS` in `popup.js` is built while the module is still evaluating, so anything it calls must
be a function *declaration* — a `const` arrow is still in its temporal dead zone at that point.

## Service worker version

The update banner compares versions rather than merely noticing a waiting worker. The worker
answers a `version` message with its `VERSION` constant; the UI shows "Update ready" only when a
waiting worker's version differs from the active one's. `reg.waiting` alone is not the condition
— a byte-identical worker can wait, and then the banner never goes away.

## Widget

`widget.js` exports `summary()`, returning today's entries and the next upcoming one for the main
app's tile screen.
