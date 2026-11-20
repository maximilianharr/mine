---
kanban-anchor: 2026-01-05
kanban-interval: 2
---

The two calendar settings that are data rather than preferences.

`kanban-anchor` is a bare date: the first day of sprint 1. `kanban-interval` is the sprint
length in weeks. Sprint *n* therefore runs for `interval` weeks from
`anchor + (n-1) x interval` weeks, and a task's sprint is whichever range its `start` falls
in.

They live in the repo because the sprint is *derived* from them. On the device the same file
would report a different sprint on a phone than on a laptop, and moving a card would then
write the wrong date. Everything else - theme, date format, time zone, week start,
show-calendar-weeks, the group filter - is a device preference and is not in the repo.

A `start` before the anchor has no sprint, and such a task is not on the board.
