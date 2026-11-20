#!/usr/bin/env python3
"""Serves the working tree for the browser checks, plus one synthetic route.

/__fixture.json is a month of entries for check.mjs to seed the local mirror with. It is
generated rather than committed as markdown so that it always lands in the month the checks
run in - a fixture pinned to April would leave the month view empty and the checks green.
"""
import http.server, json, os, sys
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787

# Weekday offsets within the month, so there is always a Saturday task, a day with more entries
# than a phone cell shows, all-day items, and the long titles that used to blow the grid open.
#
# A task row may carry a sixth item: extra frontmatter lines. Three of them are there for the
# importance checks - one written the way the app writes it, and two carrying the old `priority`
# key, which has to read as important at 1 and not at 3.
ROWS = [
    (1,  "09:00", "Sprint planning",                  "work",   "event"),
    (1,  "14:00", "Review the open pull requests",    "work",   "task",  "todo",
     ["important: true"]),
    (2,  None,    "Dentist",                          "health", "event"),
    (3,  "08:30", "Standup",                          "work",   "event"),
    (3,  "11:00", "Write the quarterly board report", "work",   "task",  "doing"),
    (3,  "17:00", "Gym",                              "health", "event"),
    (5,  "13:00", "Deploy the release",               "work",   "task",  "todo",
     ["priority: 1"]),
    (6,  "10:00", "Fix the bathroom tap",             "home",   "task",  "todo",
     ["priority: 3"]),
    (7,  None,    "Family lunch",                     "home",   "event"),
    (10, "08:30", "Standup",                          "work",   "event"),
    (12, "11:00", "Weekly shop",                      "home",   "task",  "done"),
    (15, "14:00", "Physiotherapy appointment",        "health", "event"),
    (17, "10:00", "Architecture review",              "work",   "event"),
    (17, "16:00", "Call the insurance company",       "home",   "task",  "todo"),
    (20, "09:00", "Design review",                    "work",   "event"),
    (20, "15:00", "Submit the expenses",              "work",   "task",  "todo"),
    (21, "10:00", "Repaint the hallway",              "home",   "task",  "todo"),
    (24, "13:00", "Doctor",                           "health", "event"),
    (26, "09:00", "Sprint review",                    "work",   "event"),
]


def fixture():
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
        fm = ['title: "%s"' % title, "type: " + kind]
        if time:
            fm.append("start: %sT%s:00Z" % (key, time))
            fm.append("end: %sT%02d:%s:00Z" % (key, int(time[:2]) + 1, time[3:]))
        else:
            fm.append("start: " + key)
        fm.append("group: " + group)
        if kind == "task":
            fm.append("stage: " + row[5])
            fm.extend(row[6] if len(row) > 6 else [])
        files.append({
            "path": "calendar/%04d/%02d/%s-%s-%04x.md" % (
                today.year, today.month, key, (time or "0000").replace(":", ""), i),
            "oid": "f%d" % i,
            "text": "---\n" + "\n".join(fm) + "\n---\n\nNotes for %s.\n" % title})
    return files


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=REPO, **k)

    def do_GET(self):
        if not self.path.startswith("/__fixture.json"):
            return super().do_GET()
        body = json.dumps(fixture()).encode()
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
