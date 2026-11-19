# Calendar — technical requirements

File format and rendering for [REQUIREMENTS.md](REQUIREMENTS.md). Sync, caching and writes are
in [../TECHNICAL-REQUIREMENTS.md](../TECHNICAL-REQUIREMENTS.md).

## Paths

```
calendar/2026/04/2026-04-18-1400-k3f9.md     one-off entry
calendar/2026/04/2026-04-25-0000-ov1q.md     occurrence override
calendar/recurring/trash-p7qm.md             entry with a recurrence rule
calendar/groups.md                           group -> colour and label
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
| `done` | `task` only | `true` / `false` |
| `location` | both | free text |
| `alerts` | both | minutes before start, `0` = at start. Stored and exported only; nothing fires in the background |
| `participants` | both | list of email addresses |
| `recurrence` | both | RRULE string, e.g. `FREQ=WEEKLY;BYDAY=SA` |
| `exdate` / `rdate` | recurring | occurrences to skip / extra occurrences |
| `series` | override | id of the recurring file it belongs to |
| `recurrence-id` | override | the original occurrence date this file replaces |
| `conflictOf` | conflict file | written by sync |

No `duration` key — it is `end - start`.

Type and time are independent: `type` decides whether the entry can be ticked done, the value
type of `start` decides whether it is all-day or timed. A task is usually all-day, but may carry
a time and then renders at it.

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

Full RRULE on read — files may be hand-written or imported. The UI only *writes* daily / weekly /
monthly / yearly with `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT`.

`rrule.js` works in UTC. For an all-day rule, set `DTSTART` to UTC midnight and read only the
year/month/day back, never `getDate()` on a local Date — east of UTC that returns the previous
day. `UNTIL` must be written in the `Z` form.

## Groups

`groups.md` is a markdown file whose frontmatter maps a group name to a colour and a label. An
entry stores the name, so recolouring or relabelling is a one-file edit instead of a rewrite of
every entry, and there is no cap on the number of groups. Unknown group renders grey. It lives in
the data repo, so the mapping follows you across devices.

## Widget

`widget.js` exports `summary()`, returning today's entries and the next upcoming one for the main
app's tile screen.
