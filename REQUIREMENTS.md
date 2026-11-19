# Mine

Mine is a set of PWAs (Progressive Web Apps) to digitalize ones personal or professional life.
The key idea is to save everything in a repo as markdown files. This can be calendar entries,
diaries, markdowns extracted from voice recordings / pdfs / .. These .md files can easily be
ported to new apps without a vendor lock-in and are processed via an (AI) assistant to help you
plan your day, keep track of tasks, remind you of memories a.k.a. a second brain.

To keep complexity to a minimum each use-case lives in a separate folder. e.g. the calendar PWA
lives completely in a 'calendar' folder as does the zettelkasten and all the other apps. Each
folder contains a 'sample' folder with samples how the markdowns shall look and a REQUIREMENTS.md
to describe how the PWA works.

See [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) for how this is built.

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

## Using it

- Changes appear instantly and are queued for GitHub in the background.
- A sync indicator shows: in sync / pending / error.
- Offline, the queue is kept and sent when you are back online or reopen the app.
- Editing the same entry on two devices never loses either version: the other device's version
  keeps the file, yours is kept beside it, and the app asks which to keep.
- Everything works offline, including dates and search, because the app keeps a full local copy.

## Reminders

**Mine cannot notify you while it is closed.** No browser can schedule a notification for later;
this is a platform limitation, not a missing feature. Alerts are stored with each entry and
exported, and they fire while the app is open. The summary on the tile screen is the reminder.

## Updates

When a new version is deployed the app shows "Update ready — reload". It never updates while you
are in the middle of editing.

## Privacy

Your data lives in a **private** repo. The app itself is public, but it contains no data, and the
token is scoped so that it can only touch the data repo.
