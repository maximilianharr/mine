# Mine

Mine is a set of PWAs (Progressive Web Apps) to digitalize ones personal or professional life.
The key idea is to save everything in a repo as markdown files. This can be calendar entries,
diaries, markdowns extracted from voice recordings / pdfs / .. These .md files can easily be
ported to new apps without a vendor lock-in and are processed via an (AI) assistant to help you
plan your day, keep track of tasks, remind you of memories a.k.a. a second brain.

To keep complexity to a minimum each use-case lives in a separate folder. e.g. the calendar PWA
lives completely in a 'calendar' folder as does the zettelkasten and all the other apps. Each
folder contains a 'sample' folder with samples how the markdowns shall look, a REQUIREMENTS.md
describing how the PWA works and a TECHNICAL-REQUIREMENTS.md describing how it is built.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for how this is built, and
[TEST-REQUIREMENTS.md](TEST-REQUIREMENTS.md) for how it is checked.

## One app, one setup

Mine installs as **one** app on the phone, with one icon. The apps in the subfolders are pages
inside it, not separate installs.

This is what makes the central requirement work: **the GitHub repo and token are entered once,
in the main app, and every app in a subfolder uses them.** Verified on iPhone and Android.

## Main app

A tile per app: its `icon.svg` above its folder name.

Above the tiles, apps may contribute a summary. The calendar's shows today's entries and the
next one — which matters, because opening the app is the only reminder that works (see below).

## First run

1. Open the app URL and add it to the home screen (iOS: Share → Add to Home Screen;
   Android: menu → Install).
2. The setup screen asks for GitHub owner, data repo, branch, and a personal access token.
3. The app tests the connection and reports clearly if it fails.

Settings are stored on the device only. The token is never displayed again after entry, and the
app warns 14 days before it expires.

Two settings belong to Mine rather than to any one app, and the same two rows appear in the main
settings and in each app's: **theme** (system, light or dark) and **date format** (auto, which
follows the device's locale, or `dd.mm.yyyy`, or `mm/dd/yy`). Both default to following the
device, so Mine looks like the rest of the phone until you say otherwise.

One convention is the same in every app: **a save icon is green and a trashcan is red**, wherever
either appears — a trashcan is red even where it only clears one field of one entry, because the
rule is the icon, not the consequence. Both are **glyphs on no
background**: a save is a green disk, a trashcan is a red trashcan. **Nothing in Mine is a filled
green button.** The weight of a primary action comes from the icon being the familiar one in the
familiar place, not from a block of colour — and a save drawn like the rest of the row cannot be
mistaken for a background that means something. The `x` that closes or abandons something is
neither green nor red, and stays plain.

A second convention follows from it: **the `x` is rightmost in every popup**, and the row ends
trashcan, save, `x`. The way out of an overlay is in the same corner wherever you are, so leaving
one is never something to look for — and that corner is worth more to the button reached for by
habit than to the one aimed at deliberately. The save keeps its familiar place beside it, which
is enough, because what makes it findable is the green disk and not the edge of the card.

## Markdown bodies

Every app keeps its text as markdown, so every app has to show it. **One renderer, in `shared/`,
used by all of them** — the calendar's details body today, a zettelkasten note and a diary entry
next. Two renderers would drift, and a note that looked right in one app and wrong in the next
would be the plainest possible sign that these files are not as portable as the whole idea claims.

It is **deliberately small**, and covers what a personal note actually holds: paragraphs, `#` to
`###` headings, bullet and numbered lists, `- [ ]` and `- [x]` checkboxes, **bold**, *italic*,
`code`, and links. No tables, no blockquotes, no fenced code blocks and no images — each of them
is more code to own for something an agenda or a diary page rarely carries, and the app that first
genuinely needs one can add it then.

A checkbox is **rendered, not operated**: `- [x]` draws a ticked box, and ticking it is an edit of
the text like any other. A body is read far more often than its checklist is advanced, and a
tappable box would have to write a file from a screen whose whole point is that it writes nothing.

**It builds nodes, never HTML.** The renderer makes DOM elements and sets text, so nothing in a
body can turn into markup: a body carrying a `<script>` tag shows that tag as text. This is the
threat the CSP exists for — injected script on our own origin — and a data file in your own repo
is the likeliest thing to carry a stray angle bracket. A link is rendered only for `http`, `https`
and `mailto`; anything else stays text, so a `javascript:` URL is never something to press. Links
open in a new tab, because leaving the app would lose the view you were in.

It is hand-written rather than vendored. It is small enough to be, and the dependency table in
[TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) asks of everything in it what would be
wrong with hand-rolling it — for this, nothing.

## Using it

- Changes appear instantly and are queued for GitHub in the background.
- A sync indicator shows: in sync / pending / error.
- Offline, the queue is kept and sent when you are back online or reopen the app.
- Editing the same entry on two devices never loses either version: the other device's version
  keeps the file, yours is kept beside it and flagged, and the sync indicator tells you there is
  something to review. Nothing is discarded and nothing is silently overwritten — but the app
  does not interrupt you to ask which to keep, because by then you are somewhere else.
- Everything works offline, including dates and search, because the app keeps a full local copy.

## Reminders

**Mine cannot notify you while it is closed.** No browser can schedule a notification for later;
this is a platform limitation, not a missing feature. Alerts are stored with each entry and
exported, and they fire while the app is open. The summary on the tile screen is the reminder.

## Updates

When a new version is deployed the app shows "Update ready — reload". It never updates while you
are in the middle of editing.

The banner appears only when the version waiting to take over genuinely differs from the one
running. A new worker can sit waiting while being identical to the active one, so "a worker is
waiting" is not the test — if it were, the banner would appear on an app with no update at all
and never go away. Reloading twice with no deploy in between must leave no banner.

## Privacy

Your data lives in a **private** repo. The app itself is public, but it contains no data, and the
token is scoped so that it can only touch the data repo.
