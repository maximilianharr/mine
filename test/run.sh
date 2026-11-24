#!/bin/bash
# Runs the model checks in node, then starts the fixture server and a headless Chromium for the
# browser checks and tears both down.
#
#   test/run.sh              every check
#   test/run.sh --shot DIR   every check, and a screenshot of each view into DIR
#   test/run.sh mine         one app's browser checks, by the name in test/check-<app>.mjs
#
# Needs chromium and node 20+ on PATH. Nothing is installed and nothing is written to the repo.
#
# A browser suite per app, discovered rather than listed: adding test/check-diary.mjs is all it
# takes for the diary to be checked by this script. They share one Chromium and run in turn,
# because they drive the same page target.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=8787
PROFILE=$(mktemp -d)

cleanup() {
  [ -n "${CHROME:-}" ] && kill "$CHROME" 2>/dev/null
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null
  rm -rf "$PROFILE" 2>/dev/null
  return 0
}
trap cleanup EXIT

command -v chromium >/dev/null || { echo "chromium not on PATH"; exit 2; }

# A bare word is an app name; everything else is passed to the suites.
ONLY=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --shot) ARGS+=("$1" "$2"); shift 2 ;;
    -*) ARGS+=("$1"); shift ;;
    *) ONLY="$1"; shift ;;
  esac
done

SUITES=()
for f in "$HERE"/check-*.mjs; do
  name=$(basename "$f" .mjs); name=${name#check-}
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  SUITES+=("$f")
done
if [ ${#SUITES[@]} -eq 0 ]; then
  echo "no browser suite matches '${ONLY}' — expected test/check-${ONLY}.mjs"
  exit 2
fi

node "$HERE/unit.mjs" || exit 1

python3 "$HERE/serve.py" $PORT >/dev/null 2>&1 &
SERVER=$!
chromium --headless --no-sandbox --disable-gpu --hide-scrollbars --no-first-run \
  --disable-extensions --remote-debugging-port=9222 --user-data-dir="$PROFILE" \
  about:blank >/dev/null 2>&1 &
CHROME=$!

for i in $(seq 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/calendar/" && break
  sleep 0.2
done

# Node 20 keeps WebSocket behind a flag; 21+ ignores the flag harmlessly.
failed=0
for suite in "${SUITES[@]}"; do
  node --experimental-websocket "$suite" ${ARGS[@]+"${ARGS[@]}"} 2>&1 \
    | grep -v 'ExperimentalWarning\|Use `node'
  [ "${PIPESTATUS[0]}" -eq 0 ] || failed=1
done
exit $failed
