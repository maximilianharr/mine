#!/bin/bash
# Runs the model checks in node, then starts the fixture server and a headless Chromium for the
# browser checks and tears both down.
#
#   test/run.sh              the checks
#   test/run.sh --shot DIR   the checks, and a screenshot of each view into DIR
#
# Needs chromium and node 20+ on PATH. Nothing is installed and nothing is written to the repo.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=8787
PROFILE=$(mktemp -d)

cleanup() {
  [ -n "${CHROME:-}" ] && kill "$CHROME" 2>/dev/null
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null
  rm -rf "$PROFILE"
}
trap cleanup EXIT

command -v chromium >/dev/null || { echo "chromium not on PATH"; exit 2; }

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
node --experimental-websocket "$HERE/check.mjs" "$@" 2>&1 | grep -v 'ExperimentalWarning\|Use `node'
exit "${PIPESTATUS[0]}"
