#!/bin/bash
# Double-click this file to open the Sinking Funds app.
# Serves this folder on localhost so the browser can save to disk
# (the File System Access API is blocked on file:// origins).
# Close the Terminal window to stop the server.

cd "$(dirname "$0")" || exit 1
PORT=8756

# reuse the server if it's already running
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi

open "http://127.0.0.1:$PORT/index.html"

echo "Sinking Funds is running at http://127.0.0.1:$PORT"
echo "Close this window when you're done."

# keep the window (and the server) alive
wait
