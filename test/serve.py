#!/usr/bin/env python3
"""Serves the working tree for the browser checks, plus one synthetic route per app.

/__fixture/<app>.json is what test/check-<app>.mjs seeds the local mirror with. It is generated
rather than committed as markdown so that it always lands in the month the checks run in - a
fixture pinned to April would leave the month view empty and the checks green.

A new app adds a function here and names it in FIXTURES. An app with no data of its own - the
tile screen - takes the empty one, which still gets it a config and a mirror to open against.
"""
import http.server, json, os, sys
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787

# Weekday offsets within the month, so there is always a Saturday task, a day with more entries
# than a phone cell shows, all-day items, and the long titles that used to blow the grid open.
#
# A row may carry a sixth item: extra frontmatter lines - `important: true` for the importance
# checks, a recurrence rule for the repeating ones, an `end:` for the multi-day ones. `{+n}` in
# one of those is the start day plus n, written out, so a span lands in the month being checked.
# An explicit `end:` replaces the one a timed row is given automatically.
ROWS = [
    (1,  "09:00", "Sprint planning",                  "work",   "event"),
    (1,  "14:00", "Review the open pull requests",    "work",   "task",  "todo",
     ["important: true"]),
    (2,  None,    "Dentist",                          "health", "event"),
    (3,  "08:30", "Standup",                          "work",   "event"),
    (3,  "11:00", "Write the quarterly board report", "work",   "task",  "doing"),
    (3,  "17:00", "Gym",                              "health", "event"),
    (5,  "13:00", "Deploy the release",               "work",   "task",  "todo"),
    (3,  None,    "Water the plants",                 "home",   "task",  "todo",
     ['recurrence: "FREQ=WEEKLY"']),
    (6,  "10:00", "Fix the bathroom tap",             "home",   "task",  "todo"),
    (7,  None,    "Family lunch",                     "home",   "event"),
    (10, "08:30", "Standup",                          "work",   "event"),
    (12, "11:00", "Weekly shop",                      "home",   "task",  "done"),
    (15, "14:00", "Physiotherapy appointment",        "health", "event"),
    (17, "10:00", "Architecture review",              "work",   "event"),
    (17, "16:00", "Call the insurance company",       "home",   "task",  "todo"),
    (20, "09:00", "Design review",                    "work",   "event"),
    (20, "15:00", "Submit the expenses",              "work",   "task",  "todo",
     ["important: true"]),
    (21, "10:00", "Repaint the hallway",              "home",   "task",  "todo"),
    (24, "13:00", "Doctor",                           "health", "event"),
    (26, "09:00", "Sprint review",                    "work",   "event"),
    # Two spans: an all-day one across three days, and a timed one across midnight. Both are
    # top-row entries in every view, and the all-day one covers a day that already has an entry
    # on it, which is where a span and an ordinary line have to share a cell.
    (9,  None,    "Berlin conference",               "work",   "event", None, ["end: {+2}"]),
    (22, "21:00", "Night shift",                     "home",   "event", None,
     ["end: {+1}T06:00:00Z"]),
]


def plus(line, today, day):
    """`{+n}` is the row's own day plus n, as a date in the month being checked."""
    import re
    return re.sub(r"\{\+(\d+)\}",
                  lambda m: "%04d-%02d-%02d" % (today.year, today.month, day + int(m.group(1))),
                  line)


def calendar():
    today = date.today()
    files = [
        {"path": "calendar/groups.md", "oid": "g1",
         "text": open(os.path.join(REPO, "calendar/sample/groups.md")).read()},
        {"path": "calendar/settings.md", "oid": "s1",
         "text": "---\nkanban-anchor: %s\nkanban-interval: 2\n---\n" % today.replace(day=1)},
    ]
    for i, row in enumerate(ROWS):
        day, time, title, group, kind = row[:5]
        key = "%04d-%02d-%02d" % (today.year, today.month, day)
        extra = [plus(x, today, day) for x in (row[6] if len(row) > 6 else [])]
        ends = any(x.startswith("end:") for x in extra)
        fm = ['title: "%s"' % title, "type: " + kind]
        if time:
            fm.append("start: %sT%s:00Z" % (key, time))
            if not ends:
                fm.append("end: %sT%02d:%s:00Z" % (key, int(time[:2]) + 1, time[3:]))
        else:
            fm.append("start: " + key)
        fm.append("group: " + group)
        if kind == "task":
            fm.append("stage: " + row[5])
        fm.extend(extra)
        files.append({
            "path": "calendar/%04d/%02d/%s-%s-%04x.md" % (
                today.year, today.month, key, (time or "0000").replace(":", ""), i),
            "oid": "f%d" % i,
            "text": "---\n" + "\n".join(fm) + "\n---\n\nNotes for %s.\n" % title})
    return files


# Notes with different `updated` times, two tags shared between them, one untagged, one with a
# long body, one carrying a key the app does not own, which a save must keep, and the oldest one
# pinned, so it leads the grid.
NOTES = [
    ("2026-11-20T08:00:00Z", "2026-11-25T09:00:00Z", "Groceries", ["home", "shopping"],
     "- [x] milk\n- [ ] eggs\n- [ ] **good** coffee", []),
    ("2026-11-18T10:00:00Z", "2026-11-24T19:40:00Z", "Trip ideas", ["travel"],
     "## Portugal\n\nLisbon, then the train to *Porto*. " + "A long paragraph about it. " * 40,
     ["source: phone"]),
    ("2026-11-10T12:00:00Z", "2026-11-22T07:00:00Z", "Quarterly report", ["work"],
     "Outline the `numbers` first.", []),
    ("2026-11-05T09:00:00Z", "2026-11-21T09:00:00Z", "Loose thought", [],
     "Nothing tagged here.", []),
    ("2026-11-01T09:00:00Z", "2026-11-20T09:00:00Z", "Paint the hallway", ["home"], "",
     ["pinned: true"]),
]


def notes():
    files = []
    for i, (created, updated, title, tags, body, extra) in enumerate(NOTES):
        fm = ['title: "%s"' % title, "created: " + created, "updated: " + updated]
        if tags:
            fm.append("tags:")
            fm.extend("  - " + t for t in tags)
        fm.extend(extra)
        day, time = created.split("T")
        files.append({
            "path": "notes/%s/%s/%s-%s-n%03d.md" % (day[:4], day[5:7], day, time[:5].replace(":", ""), i),
            "oid": "n%d" % i,
            "text": "---\n" + "\n".join(fm) + "\n---\n\n" + body + "\n"})
    return files


# The tile screen reads no files of its own: what it needs is the config the seed writes anyway.
FIXTURES = {"calendar": calendar, "notes": notes, "mine": lambda: []}

PREFIX = "/__fixture/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=REPO, **k)

    def do_GET(self):
        if not self.path.startswith(PREFIX):
            return super().do_GET()
        app = self.path[len(PREFIX):].split("?")[0].removesuffix(".json")
        if app not in FIXTURES:
            return self.send_error(404, "no fixture for %r" % app)
        body = json.dumps(FIXTURES[app]()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # never check a cached copy
        super().end_headers()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
