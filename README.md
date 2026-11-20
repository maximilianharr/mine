# Mine

A set of small PWAs that keep your personal data as markdown in a private GitHub repo —
calendar, zettelkasten, diary — so it stays portable and free of vendor lock-in.

**Live: https://maximilianharr.github.io/mine/** — install it to your home screen.

## Docs

| | |
| --- | --- |
| [REQUIREMENTS.md](REQUIREMENTS.md) | what the app does and how it behaves |
| [TECHNICAL-REQUIREMENTS.md](TECHNICAL-REQUIREMENTS.md) | how it is built, and the verified platform findings |
| [TEST-REQUIREMENTS.md](TEST-REQUIREMENTS.md) | what is checked before a change ships, and how |
| [calendar/](calendar/) | the calendar app, with its own pair of docs |

## Layout

```
index.html app.js style.css sw.js manifest.json   the main app
shared/      store.js github.js md.js vendor/     used by every app
calendar/                                         one folder per app
spike/                                            on-device platform checks
test/                                             the browser checks: test/run.sh
```

No build step: no bundler, no CI, no dependencies to install. `git push` deploys to GitHub
Pages. To run it locally, `python3 -m http.server` in this folder and open the printed URL.
`test/run.sh` runs the checks in a headless browser and installs nothing either.

Data lives in a **separate private repo**, never in this one. The token is entered once in the
app, stored on the device, and scoped so it can only touch that data repo.

## Status

The main app, the sync layer and the on-device checks are done and verified end to end against
a real repo. The calendar is a stub; its views are the next piece of work.
