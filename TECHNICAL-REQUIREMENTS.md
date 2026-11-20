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
/shared/  apps.js  store.js  github.js  md.js  prefs.js  vendor/
/calendar/  index.html  app.js  data.js  ui.js  views.js  kanban.js  popup.js  settings.js
            style.css  icon.svg  sample/
```

No build step: no bundler, no CI, no node_modules. `git push` deploys, every page opens from
disk, all paths relative so the `/mine/` prefix needs no config.

`shared/apps.js` exports the app list and is imported by both the tile screen and `sw.js`, so
adding an app means editing one array. An app may export `summary()` from `widget.js`.

## Bootstrap — 1 request

One GraphQL query returns an app folder's tree **with contents and blob SHAs**, nested to the
depth of the layout:

```graphql
repository(owner:$o, name:$r) { object(expression:"main:calendar") {
  ... on Tree { entries { name type object {
    ... on Tree { entries { name type object {
      ... on Tree { entries { name type object {
        ... on Blob { oid text isTruncated } } } } } } } } } } }
```

- `rateLimit.cost` is **1** however many files return — `entries` is not a paginated connection.
  A 16 MB / 145 file response came back in 6 s without error.
- `Blob.oid` is byte-identical to the REST tree SHA, so this single request also supplies the
  SHAs that pulls diff against and writes send as their base.
- Check `isTruncated`: GraphQL truncates very large blobs and returns `text: null` for binary.
  Fall back to a REST blob fetch for that path.
- An **empty repo** returns `object: null` rather than an error, and `defaultBranchRef: null`.
  Treat it as an empty mirror, not a failure.

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
   costs no rate-limit quota.
2. On 200: fetch the tree, diff blob SHAs, fetch only changed files, drop deleted paths.

Run on app open and on window focus. Background Sync does not exist in Safari, so all syncing is
foreground.

## Writes — one commit per drain

Queue each change locally with the blob SHA it was based on, then drain the whole queue as one
commit via the Git Data API: `POST /git/blobs` per file, `POST /git/trees` with `base_tree`
(deletion = entry with `sha: null`), `POST /git/commits`, `PATCH /git/refs/heads/{branch}` with
the expected old SHA and **no force**.

One drain is one commit, so a move — delete plus create, because the date is in the path and the
API has no rename — cannot be half-applied, and a 20-item offline backlog is one commit.

A rejected ref update means someone pushed elsewhere: pull, rebuild on the new base, retry. This
succeeds, because nearly every write is a create at a freshly generated path.

**True conflict** = a queued change whose base SHA no longer matches the remote blob. Remote keeps
the canonical path; the local version is committed beside it as `<name>.conflict-<yyyymmdd>.md`
with `conflictOf:`. Nothing is discarded and the queue never jams. On 401/403, pause and send the
user to settings.

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

Verified in both installed home-screen apps (iPhone/Safari, Pixel/Chrome); screenshots in
`spike/res/`.

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
