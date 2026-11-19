# Mine

Mine is a set of PWAs (Progressive Web Apps) to digitalize ones personal or professional life.
The key idea is to save everything in a repo as markdown files. This can be calendar entries, diaries, markdowns extracted from voice recordings / pdfs / .. These .md files can easily be ported to new apps without a vendor lock-in and are processed via an (AI) assistant to help you plan your day, keep track of tasks, remind you of memories a.k.a. a second brain.
To keep complexity to a minimum each use-case lives in a separate folder. e.g. the calendar PWA lives completely in a 'calendar' folder as does the zettelkasten and all the other apps. Each folder contains a 'sample' folder with samples how the markdowns shall look and a REQUIREMENTS.md to describe how the PWA works.

## Two repositories

| Repo | Visibility | Contents |
| --- | --- | --- |
| `maximilianharr/mine` | public | this app, served by GitHub Pages at `/mine/` |
| `maximilianharr/mine-data` | **private** | the markdown data: `calendar/`, `zettelkasten/`, ... |

The app repo must be public because GitHub Pages cannot serve a private repo without
GitHub Enterprise. Data therefore never lives in this repo — it would be world-readable
at a predictable URL. The token the app holds is scoped to the data repo only, so a
leaked token cannot modify the app itself.

## One installable app, folders are routes

Mine is **one** PWA, not one PWA per folder. There is a single `manifest.json` with
`scope: /mine/` and a single service worker at the root. Subfolders are ordinary pages
inside that scope, reached by navigation.

This is what makes "set the token once" work: `/mine/` and `/mine/calendar/` are the
same origin, so they share one IndexedDB automatically, with no message passing. If each
folder were installed as its own home-screen app, iOS would give each one an isolated
storage container and the token would have to be entered again per app.

### Layout

```
/index.html            tile screen
/manifest.json         scope and start_url: /mine/
/sw.js                 one service worker, root scope, type: module
/shared/
  apps.js              APPS list - single source of truth
  store.js             IndexedDB: settings + file cache + sync queue
  github.js            GitHub API: bootstrap, pull, drain
  md.js                frontmatter parse / serialize
  vendor/              pinned third-party code, see VENDOR.md
/calendar/
  index.html
  app.js               imports ../shared/*.js by relative path
  widget.js            optional, exports summary()
  icon.svg
  REQUIREMENTS.md
  sample/
```

No build step. No bundler, no node_modules, no CI. `git push` is the deploy, and every
page can be opened directly from disk. All paths are relative, so the `/mine/` prefix
needs no configuration.

### Tile screen

`shared/apps.js` exports the list of apps and is imported by both the tile screen and
the service worker's precache list, so adding an app means editing one array.

Each tile shows the app's `icon.svg` above its folder name. An app may additionally ship
a `widget.js` exporting `summary()`; whatever it returns is rendered above the tiles.
The calendar's widget shows today's entries and the next one. This is deliberate: see
*Alerts* below — opening the app is the only reminder mechanism that works.

## PWA Setup & GitHub Sync

### Initialization (first run)

- User opens the main app URL (GitHub Pages) on the phone.
- User installs it via "Add to Home Screen" (iOS: Safari -> Share; Android: Chrome menu).
- On first launch, the app shows a setup screen asking for:
  - GitHub owner, **data** repo, and branch
  - Fine-grained personal access token, scoped to that one repo, "Contents: read and
    write", with an expiry date
- App checks the connection with a test request (`GET /repos/{owner}/{repo}`); on failure
  it shows a clear error naming the failing step.
- Settings and token are stored in IndexedDB. The expiry date is stored alongside, and
  the app warns 14 days before the token lapses. The token is never logged or displayed
  after entry.
- Service worker caches the app shell so the app opens offline.

### Token handling

The token is stored in plaintext in IndexedDB: it is as safe as the unlocked device. The
threat that matters is not a stolen phone but injected script on our own origin, which is
closed off by policy rather than encryption:

- Every page sends a strict CSP:
  `default-src 'self'; script-src 'self'; connect-src 'self' https://api.github.com`
- **No CDNs, ever.** Every dependency is committed to `/shared/vendor/` and pinned by
  hand, with its source URL and version recorded in `VENDOR.md`. No unpkg, no cdnjs,
  no Google Fonts.
- The token is never written to a log, a URL, or the DOM.

### Cache model

Each app folder is mirrored locally in full. A decade of calendar entries is roughly
3000 files of ~500 B, so mirroring costs less than range-tracking logic and makes every
date available offline and search local and instant.

**Bootstrap** (first open of an app, **1 request**):

A single GraphQL query returns the app's folder tree *with file contents and blob SHAs*,
nested to the depth of the layout (`calendar` -> year -> month -> blob):

```graphql
repository(owner:$o, name:$r) {
  object(expression: "main:calendar") {
    ... on Tree { entries { name type
      object { ... on Tree { entries { name type
        object { ... on Tree { entries { name type
          object { ... on Blob { oid text isTruncated } } } } } } } } } }
}
```

Verified against the live API: `rateLimit.cost` is **1** regardless of how many files come
back, because `entries` is not a paginated connection; a 16 MB / 145 file response returned
without error in 6 s. `Blob.oid` is byte-identical to the REST tree SHA, so this one request
also supplies the SHAs that pulls diff against and writes send as their base.

`isTruncated` must be checked: GraphQL truncates very large blobs and returns `text: null`
for binary. Markdown entries are far below the limit, but a truncated blob falls back to a
REST blob fetch for that one path.

**Pull** (on app open and on window focus):

1. `GET /repos/{o}/{r}/commits/{branch}` with `If-None-Match`. A `304` means nothing
   changed and costs no rate-limit quota.
2. On `200`: fetch the tree, diff blob SHAs against the cache, and fetch only the files
   whose SHA changed. Deleted paths are dropped from the cache.

### Sending data to GitHub

- User creates, edits, moves or deletes an item.
- The change is written to the local cache immediately (UI updates instantly) and appended
  to a sync queue. Each queued change records the blob SHA it was based on.
- The sync worker drains the whole queue as **one atomic commit** via the Git Data API:
  - `POST /git/blobs` per changed file
  - `POST /git/trees` with `base_tree` set to the current tree, listing additions and
    deletions (a deletion is an entry with `sha: null`)
  - `POST /git/commits`
  - `PATCH /git/refs/heads/{branch}` with the expected old SHA and **no force**
- One drain is one commit, so moving an entry — a delete plus a create, because the date
  is part of the path and the API has no rename — can never be half-applied, and a
  20-item offline backlog is one commit rather than twenty.
- If the ref update is rejected, someone pushed from elsewhere: pull, rebuild the tree on
  the new base, and retry. This succeeds, because almost every write in Mine is a create
  at a freshly generated path and cannot collide.
- **True conflict** — a queued change whose recorded base SHA no longer matches the remote
  blob at that path — means the same entry was edited in two places. Nothing is discarded:
  the remote version keeps the canonical path, and the local version is committed beside it
  as `<name>.conflict-<yyyymmdd>.md` with a `conflictOf:` key naming the original. The UI
  shows a banner offering keep mine / keep theirs / keep both. The leftover is plain
  markdown, readable in any editor and visible on every device. The queue never jams.
- On 401/403: pause sync and link the user to settings to renew the token.
- Offline: the queue persists in IndexedDB and drains automatically when connectivity
  returns or the app is reopened.
- A sync indicator shows: in sync / pending / error.

Note that GitHub's Background Sync API does not exist in Safari, so draining happens in
the foreground, whenever the app is open.

### Service worker

- One service worker at the root, registered with `{type: 'module'}` so it can import the
  same `shared/apps.js` the tile screen uses.
- A version constant names the cache. On install the shell is precached: every page,
  every `shared/` module, `vendor/`, the icons and the manifest.
- Same-origin requests are served from cache and revalidated in the background.
- Requests to `api.github.com` **bypass the service worker entirely**. Caching an API response would hand back a stale ETag and silently break
  sync.
- A new service worker waits rather than activating. The UI shows an "Update ready —
  reload" banner, and `skipWaiting()` runs only on the user's tap, so an upgrade never
  lands mid-edit.

### Alerts

**No browser can schedule a local notification for a time when the app is closed.** The
Notification Triggers API was an origin trial that never shipped, and Periodic Background
Sync does not exist in Safari. Web Push would work, but something must be awake to send
it, which means a scheduler holding a token off-device.

For this reason, in v1:

- `alerts:` is stored and exported (it is valid `VALARM` data for `.ics`), but nothing
  fires in the background. Mine will not remind you while it is closed, and the
  requirements say so rather than implying otherwise.
- While the app is open, due alerts fire as real `Notification`s via `setTimeout`.
- The tile screen's calendar widget shows today and what is next, so opening the app is
  the reminder.

If background reminders are wanted later, the cheapest path that keeps data in these two
repos is a scheduled GitHub Actions workflow in the data repo sending Web Push with VAPID
keys held as repo secrets — accepting that GitHub cron drifts 5–20 minutes.

### Dependencies

Vendored into `/shared/vendor/`, pinned by hand:

| What | Why not hand-rolled |
| --- | --- |
| `js-yaml` | Files are hand-edited in an editor and must parse as real YAML — quoting, multiline scalars, flow maps. A subset parser misreads them silently. |
| `rrule` | `FREQ=MONTHLY;BYDAY=-1FR` and DST-crossing weeklies are where hand-rolled expansion is wrong without telling you. |

YAML *writing* is ours (~20 lines): we control the output shape, so no dumper is needed.

## Verified facts

Tested against the live API on 2026-11-19; see `/spike/` for the on-device page.

- **The tarball bootstrap is impossible from a browser.** `GET /tarball/{ref}` 302-redirects
  to `codeload.github.com`, which answers `access-control-allow-origin:
  https://render.githubusercontent.com` — one specific foreign origin, not ours and not `*`.
  `fetch()` applies the CORS check to the final response after following the redirect, so the
  read is blocked; the `OPTIONS` preflight an authenticated request would need returns 403.
- **GraphQL replaces it and is better.** `api.github.com/graphql` sends
  `access-control-allow-origin: *` and a 204 preflight explicitly allowing `Authorization`,
  so it is browser-usable. One query, cost 1, contents and SHAs together.

## Open spikes — on-device assumptions

`/spike/` is a token-free page that tests all of these on a real phone. Each needs a
documented fallback before code depends on it.

1. **Shared storage across paths in an installed PWA.** That a value written by `/mine/`
   is readable by `/mine/calendar/` once the app is launched from the home screen. This is
   load-bearing for the entire "set the token once" design, so it is tested first.
   *Fallback:* none that is pleasant. If it fails, each app folder needs its own token
   entry, or the apps must become one page with client-side routing.
2. **Module service workers.** `{type: 'module'}` requires Safari 16.4+, and is what lets
   `sw.js` import the same `shared/apps.js` the tile screen uses.
   *Fallback:* a classic service worker with the app list duplicated in `sw.js`. The spike
   page attempts the classic registration automatically if the module one fails.
3. **Storage persistence.** iOS evicts script-writable storage after roughly seven days
   without engagement unless the site is installed. If `navigator.storage.persist()` is not
   granted, the token and the whole local mirror can vanish between uses.
   *Fallback:* treat the cache as disposable and re-bootstrap on launch — cheap now that
   bootstrap is one request — but the **token** disappearing means re-entering it, which
   would make a short-expiry token-per-device policy mandatory rather than optional.
