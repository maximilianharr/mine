# Mine

Mine is a set of PWAs (Progressive Web Apps) to digitalize once personal or professional life.
The key idea is to save everything in a repo as markdown files. This can be calendar entries, diaries, markdowns extracted from voice recordings / pdfs / .. These .md files can easily be ported to new apps without a vendor lock-in are processed via an (AI) assistant to help you plan your day, keep track of tasks, remind you of memories a.k.a. a second brain.
To keep complexity to a minimum each use-case will have a separate folder. e.g. the calender PWA lives completely in a 'calendar' folder as does the zettelkasten and all the other apps. Each folder contains a 'sample' folder with samples how the markdowns shall look and a REQUIREMENTS.md to describe how the PWA works.

## Main PWA

The main app is a PWA in the root directory with tiles to call the other apps.
Each tile has the apps folder name at the bottom and the respective icon.svg above it.

### PWA Setup & GitHub Sync

#### Initialization (first run)
- User opens the main app URL (GitHub Pages) on the phone.
- User installs it via "Add to Home Screen" (iOS: Safari → Share; Android: Chrome menu).
- On first launch, the app shows a setup screen asking for:
  - GitHub owner, data repo, and branch
  - Fine-grained personal access token (only this repo, "Contents: read and write", with expiry)
- App checks the connection with a test request (GET repo); on failure it shows a clear error.
- Settings and token are stored locally (IndexedDB); the token is never logged or displayed.
- Service worker caches the app shell so the app opens offline.
- App loads the file list with SHAs via the Git Trees API (recursive) and fetches all
  Markdown files into the local cache.

### Sending data to GitHub
- User creates, edits, or moves an item (e.g. Kanban card to "Doing").
- Change is written to the local cache immediately (UI updates instantly) and added
  to a sync queue.
- Sync worker processes the queue in order:
  - Create/update: PUT to the Contents API with the file content in Base64
    (UTF-8 safe, so umlauts work), a commit message, and the current SHA for updates.
  - Delete: DELETE to the Contents API with SHA and commit message.
- On success: store the new SHA returned by GitHub and remove the item from the queue.
- On conflict (409/422, file changed elsewhere): reload the file, keep the remote
  version, notify the user, and never overwrite silently.
- On 401/403: pause sync and link the user to settings to renew the token.
- Offline: the queue persists; sync runs automatically when the app regains
  connectivity or is reopened.
- A sync indicator shows: in sync / pending / error.
