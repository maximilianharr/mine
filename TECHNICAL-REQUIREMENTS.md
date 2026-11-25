# Mine — technical requirements

How [REQUIREMENTS.md](REQUIREMENTS.md) is built. Everything here was verified against the live
API or on device on 2026-11-19; `spike/` re-runs the device checks and needs no token.

## Repos

| Repo | Visibility | Contents |
| --- | --- | --- |
| `maximilianharr/mine` | public | this app, served by Pages at `/mine/` |
| `maximilianharr/mine-data` | **private** | the markdown data |

Pages cannot serve a private repo without Enterprise, so data in the app repo would be
world-readable at a predictable URL. The token is scoped to the data repo only.

## Layout

One `manifest.json` with `scope: /mine/`, one service worker at the root. Subfolders are ordinary
pages inside that scope. `/mine/` and `/mine/calendar/` are the same origin, so they share one
IndexedDB — that is the whole mechanism behind "enter the token once".

```
/index.html /manifest.json /sw.js
/style.css  the shared base      /home.css  the tile screen's own
/shared/  apps.js  store.js  github.js  md.js  markdown.js  prefs.js
          ui.js  sync.js  vendor/
/calendar/  index.html  app.js  data.js  ui.js  views.js  kanban.js  popup.js  settings.js
            style.css  icon.svg  sample/
/test/    run.sh  unit.mjs  serve.py  cdp.mjs  check-mine.mjs  check-calendar.mjs
```

No build step: no bundler, no CI, no node_modules. `git push` deploys, every page opens from
disk, all paths relative so the `/mine/` prefix needs no config.

The checks in `test/` hold to the same rule: `run.sh` drives a headless Chromium over the
DevTools protocol with nothing installed, and what it covers — and the two mistakes that make
it lie to you — are in [TEST-REQUIREMENTS.md](TEST-REQUIREMENTS.md). One browser suite per app,
`check-<slug>.mjs`, discovered by `run.sh` rather than listed in it, over the harness in
`cdp.mjs`.

`shared/ui.js` is the chrome every app builds its screens out of: the DOM helpers, the icon set,
the three overlay mechanisms and the settings row. `shared/sync.js` is the sync line and the logs
panel. Both exist because both apps had their own copy: the drain-then-pull sequence was written
twice, the icon set and the overlays sat in `calendar/ui.js`, and the logs panel - which reports
on a queue shared by every app - was reachable only from the calendar.

Two couplings were cut to get them out of the calendar. `closePops()` took its list of overlays
from a literal naming the calendar's; it now takes it from `registerPops()`, which an app calls
once at boot, and the `aria-expanded` it resets is tracked by `openPop()` rather than named. The
icon set is shared for the verbs and the two conventions REQUIREMENTS.md states for all of Mine -
a green disk saves, a red trashcan deletes - and an app merges its own subjects in with
`addIcons()`; a second app drawing its own trashcan is how those conventions would quietly stop
being conventions.

`shared/apps.js` exports the app list and is imported by the tile screen, `sw.js` and
`github.js`, so adding an app means editing one array, and its `files` are what the worker
precaches. The list is
written by hand on purpose: `install` uses `cache.addAll`, which rejects as a whole if any URL
404s, so a wrong entry fails loudly at install. A *missing* one fails silently, which is how
`shared/markdown.js` stayed out of the shell while `popup.js` imported it — an app installed and
taken offline before an entry was ever opened could not draw a details body.

## Adding an app

Everything shared is in place, so an app is its folder plus two one-line registrations.

1. **`/<slug>/`** with `index.html`, `icon.svg`, your modules, and `style.css` if it needs one.
   Also `REQUIREMENTS.md`, `TECHNICAL-REQUIREMENTS.md` and `sample/`, which is the convention
   [REQUIREMENTS.md](REQUIREMENTS.md) states for every app.
2. **The head of `index.html`** carries the same CSP, viewport and theme-color as the others,
   `../style.css` before its own stylesheet, and `icon.svg` as the apple-touch-icon. No
   `manifest.json`: there is one, at the root, and its scope covers every folder.
3. **`shared/apps.js`** — one entry: `{ slug, label, files }`. `files` are the app's own files
   beyond its folder index and icon, and they are what the worker precaches.
4. **`sw.js`** — bump `VERSION`. Nothing else: the shell reads the app list.
5. **`test/check-<slug>.mjs`**, importing `test/cdp.mjs`. `test/run.sh` finds it by its name.
   A fixture goes in `test/serve.py`'s `FIXTURES`.

What you do **not** have to build: the setup gate is a config read (`getConfig()`) and six lines
of HTML; the sync line and the logs panel are `createSync()` and `renderLogs()`; the icon set,
the overlays and the settings row come from `shared/ui.js`; the markdown renderer and its
stylesheet are shared already. Data goes under `<slug>/` in the data repo, and device settings
under `<slug>.*` in `kv`.

Two conventions the shared code assumes: an app that opens overlays has a `#scrim`, and it calls
`registerPops()` once with the overlays `closePops()` should close.

## Stylesheets

`style.css` is the **shared base**: the tokens, the form primitives, and the chrome every app
builds its screens out of - the icon button, the three overlay mechanisms, the settings row, the
logs panel and a rendered markdown body. Each app's own stylesheet loads after it and holds only
what is its own.

Every token is declared three times - once for the light theme, once inside the
`prefers-color-scheme: dark` query for the device's own choice, and once under
`:root[data-theme="dark"]` for the setting that overrides it - and the dark pair carry the same
values. Beyond the colours themselves the set holds `--raise`, the surface a popup or a card
sits on, one shade above `--bg`; `--chip-bg` and `--chip-ink`, the two mixes an entry's own
colour is drawn with, which differ between the themes because a dark page needs more tint and a
lighter ink; and `--serif` / `--sans` / `--mono`, so no stylesheet names a font family of its
own. **There are no web fonts**: the CSP is `default-src 'self'`, so every stack is system fonts
with a metric-compatible fallback behind the first name.

A colour that has to hold in both themes cannot be written in JavaScript, because the code
cannot see which theme is on. The calendar's three stage colours are the case: `STAGE_COLOR`
hands out `var(--todo)` rather than a hex, and an inline `style.color = 'var(--todo)'` resolves
against whichever theme is live. A colour that comes from the user's own data - a category's -
can only be the one hex they wrote, so the stylesheet mixes it against the theme instead: the
app sets `--c` on the element and the two `--chip-*` mixes do the rest.

`home.css` is the tile screen's own, loaded by the root `index.html` alone. It is there because
the tile screen is one app among the others: a full-width filled button and a 44rem body are its
choices, and while they sat in the base every app page had to undo them.

A rule in the base is a rule an app can no longer forget. `[hidden] { display: none !important }`
is the clearest case - a class rule setting `display` beats the UA stylesheet's `[hidden]`, so a
screen or a banner renders while still carrying the attribute. The calendar carried that rule and
the tile screen did not, which is why the root app showed "Update ready - reload" permanently.
The `.md-*` rules are the second case: `shared/markdown.js` is one renderer for every app, and
its stylesheet has to be shared with it or the second app renders a body unstyled.

Moving `.ib` into the base changed one thing on purpose. The kanban's `.knav` and `.kadd` carry
`.ib` and declare their own sizes; `.ib` used to come later in the same sheet and win, so those
sizes were dead. They apply now, which is what they were written to do.

`shared/md.js` and `shared/markdown.js` are two different jobs and stay two files. `md.js` is the
file envelope — it parses and serialises frontmatter and is imported by the paths that read and
write the repo. `markdown.js` renders a body for the screen and is imported only by UI, so nothing
on the file-IO path pulls a renderer in. It **returns a DOM node and never a string of HTML**, which
is what makes a body carrying a `<script>` tag harmless without a sanitiser to get right; what it
covers and why it is hand-rolled rather than vendored is in
[REQUIREMENTS.md](REQUIREMENTS.md#markdown-bodies).

## Fetching the repo

There is one read path, `pull`, and it is also the first mirror: with no stored ETag it fetches
the tree and every blob in it. A GraphQL query returning a folder's contents and blob SHAs in a
single request was built and measured — cost 1, 145 files in 6 s — and then never wired in,
because `pull` already handled the first run and the empty repo. It was deleted rather than left
as a second way to do the same thing; against a mirror measured in single-digit MB, fetched once
per device, the request count it saved was not worth a path nothing exercised.

**Do not use the tarball.** `GET /tarball/{ref}` 302-redirects to `codeload.github.com`, which
answers `access-control-allow-origin: https://render.githubusercontent.com` — one specific
foreign origin. `fetch()` applies CORS to the final response after the redirect, so it is
blocked, and the preflight an authenticated request needs returns 403. `api.github.com/graphql`
by contrast sends `allow-origin: *` and a 204 preflight allowing `Authorization`.

**A repo with no commits rejects the Git Data API outright.** Not just the ref read — `POST
/git/blobs` itself answers 409 "Git Repository is empty", so there is nothing to build a tree
from. Only `PUT /contents/{path}` can create the first commit. The first queued file goes that
way, and everything after drains normally once a history exists.

## Pull

1. `GET /repos/{o}/{r}/commits/{branch}` with `If-None-Match`. A 304 means nothing changed and
   costs no rate-limit quota, and no ETag at all means a first mirror.
2. On 200: fetch the tree, diff blob SHAs, fetch only changed files, drop deleted paths.

**Always the whole repo, and deliberately no way to ask for one app's folder.** There is a single
`commitEtag` for the whole mirror, so a pull restricted to `diary/` would store the ETag of a
commit it had not mirrored, and the calendar's next pull would 304 against it and never see its
own files again. `pull()` used to take a prefix that did exactly this; no caller passed one, and
it was the parameter a second app would have reached for first. A per-folder pull would need a
per-folder ETag, and what it saves is one conditional GET.

Run on app open and on window focus. Background Sync does not exist in Safari, so all syncing is
foreground.

**A queue is drained first and the pull waits for it**, and the pull runs only if the drain got
through: whatever fails a drain — the token, the network — fails a pull too, and pulling over a
dirty queue rewrites the mirror underneath the changes still in it.

## Writes — one commit per drain

Queue each change locally with the blob SHA it was based on, then drain the whole queue as one
commit via the Git Data API: `POST /git/blobs` per file, `POST /git/trees` with `base_tree`
(deletion = entry with `sha: null`), `POST /git/commits`, `PATCH /git/refs/heads/{branch}` with
the expected old SHA and **no force**.

One drain is one commit, so a move — delete plus create, because the date is in the path and the
API has no rename — cannot be half-applied, and a 20-item offline backlog is one commit.

**A drain removes the keys it read, never the store.** `queued()` returns each item with its key,
and the drain deletes exactly those keys when the commit lands. Clearing the store instead would
discard anything queued *while the drain was in flight* — a save made during a slow push — and
that loss is silent and total: the item's text stays in the mirror under the blob SHA it was
based on, and the next pull deletes the file for not being in the remote. The next drain picks up
those later keys. For the same reason the first commit into an empty repo now takes only its own
item out of the queue and leaves the rest where they are, rather than clearing and re-adding
them, which also keeps their queued-at times.

A rejected ref update means someone pushed elsewhere: pull, rebuild on the new base, retry. This
succeeds, because nearly every write is a create at a freshly generated path.

**True conflict** = a queued change whose base SHA no longer matches the remote blob **and whose
text differs from it**. Remote keeps the canonical path; the local version is committed beside it
as `<name>.conflict-<yyyymmdd>.md` with `conflictOf:`. Nothing is discarded and the queue never
jams.

**One tree entry per path, and no impossible deletion.** The queue is collapsed to the last
queued op per path before the tree is built, and a queued delete whose path is not in the remote
listing is dropped. `sha: null` on a path that `base_tree` does not contain answers **422
`GitRPC::BadObjectState`** and refuses the whole commit — and it refuses it identically on every
retry, so one such item wedges the queue for good. A file moved or deleted before the queue ever
drained is exactly that case, because a move is a delete of a path GitHub never saw: with the
date in the path, changing an unpushed entry's date queues `del <old>` for a path that was only
ever local. Dropping it is also what was asked for — the file is gone locally and GitHub has
nothing to remove. If every queued item turns out to be such a no-op, the queue is cleared and
no commit is made.

This is also why a concurrent delete from another device heals itself: the listing is re-read on
every attempt, so the path is gone from it and the entry is dropped rather than refused.

**A matching text is a receipt, not a conflict.** A drain that died between the ref update and
the queue being cleared leaves items behind whose base SHA no longer matches — because the remote
now holds our own commit. Those are dropped, not forked: the blob is fetched in that branch
anyway, so comparing it costs no request, and without the comparison the app forks its own
committed work into `.conflict` files on the next attempt.

**Every attempt is retried.** The queue is never a reason to skip a drain, including on 401/403:
the error is reported and recorded, and the next open or focus tries again. The user needs one
thing from a failure, which is to be told what it was.

## The sync record

One row in `kv` under `sync.last`, written inside `drain()` and `pull()` so that every caller is
covered — every app's refresh and every background push — and so the reason outlives the status
line, which the next focus overwrites.

`app` is the folder the attempt was made from, read off the path and checked against `APPS`. It
used to be a literal test for `/calendar/`, which would have named every later app `mine`.

`{ at, lastAt, count, app, op, outcome, status, detail }`. A repeat of the same op, outcome and
status bumps `count` and `lastAt` rather than appending, because a wedged queue is retried on
every window focus and twenty copies of one 403 would bury the pull that explains it. A 304 pull
is not an attempt at anything and is not recorded. It is one row and not a history: what is worth
knowing is what is failing and for how long.

Queued items carry `at`, the time they were queued, so a backlog can be told from a jam.

**Discarding the queue repairs the mirror.** `discardQueue()` clears it, forgets the local copy
of every path it held, and drops the ETag — the next pull then restores exactly what GitHub
holds. Forgetting the queue alone would leave unpushable text in the mirror filed under the blob
SHA it was based on, which every later pull would compare as equal and skip forever.

## Service worker

Registered `{type: 'module'}` so it can import `shared/apps.js`. A version constant names the
cache; install precaches the shell. Same-origin requests are cache-then-revalidate.

Requests to `api.github.com` **bypass the worker entirely** — caching an API response would hand
back a stale ETag and silently break sync.

A new worker waits; the UI offers "Update ready — reload" and `skipWaiting()` runs only on tap.

**The offer is gated on the version, not on a worker waiting.** The worker answers a `version`
message over a `MessageChannel` port with its `VERSION` constant, and the page compares the
waiting worker's answer with the active one's; equal answers mean no banner. A worker that is
byte-identical to the running one can sit in `waiting` indefinitely, and `reg.waiting` alone as
the condition is what makes the banner appear on an app with no update and never go away. A
worker too old to answer reports `null` after a 1.5 s timeout, which differs from a real version
and so still offers the update.

## Token and CSP

Stored plaintext in IndexedDB with its expiry: as safe as the unlocked device. The threat that
matters is injected script on our own origin, closed off by policy rather than encryption:

```
default-src 'self'; script-src 'self'; connect-src 'self' https://api.github.com
```

**No CDNs, ever.** Dependencies are committed to `/shared/vendor/`, pinned by hand, with source
URL and version in `VENDOR.md`. The token is never written to a log, a URL, or the DOM.

The OAuth device flow is not an option: GitHub's `login/device/code` endpoints send no CORS
headers, so a fine-grained PAT is the only no-backend path.

## Dependencies

| What | Why not hand-rolled |
| --- | --- |
| `js-yaml` | Files are hand-edited and must parse as real YAML — quoting, multiline scalars, flow maps. A subset parser misreads them silently. |
| `rrule` | `FREQ=MONTHLY;BYDAY=-1FR` and DST-crossing weeklies are where hand-rolled expansion is wrong without telling you. |

YAML *writing* is ours (~20 lines): we control the output shape, so no dumper is needed.

**Load with `CORE_SCHEMA`, never js-yaml's default.** The default is YAML 1.1 and parses
`start: 2026-04-18` into a JS Date at UTC midnight — silently shifting every all-day entry by a
day east of UTC. `CORE_SCHEMA` keeps it a string and still handles bools, numbers, flow maps and
quoted scalars. This is the same off-by-one the bare-date format exists to prevent, arriving
through the parser instead.

## Platform findings

Verified in both installed home-screen apps (iPhone/Safari, Pixel/Chrome) on 2026-11-19.

| | Result |
| --- | --- |
| Storage shared across paths | **Yes.** A marker written by `/mine/spike/` was read back byte-identical by `/mine/spike/sub/`, both reporting `STANDALONE`. Cross-path module imports work too. |
| `{type:'module'}` service worker | Registers on Safari as well as Chrome. No classic fallback needed. |
| `storage.persisted()` | **Already granted**, no prompt, on both. An installed app is exempt from the ~7-day eviction that applies to uninstalled sites, so the token and mirror survive idle periods. |
| Quota | 35 GB (iPhone), 56 GB (Pixel), against a mirror measured in single-digit MB. |

Not tested, and no longer relevant: whether separately-installed PWAs get isolated storage. That
expectation is why the one-app topology was chosen.

Re-run `spike/` after a major iOS release — two of the four results above contradicted the
documented platform behaviour, and that is exactly the kind of thing that regresses silently.
