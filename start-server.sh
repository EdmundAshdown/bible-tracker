#!/bin/sh
# Serve Bible Tracker locally (service workers + installability need http, not file://)
# and open it in the default browser. Safe to run twice — reuses a live server.
cd "$(dirname "$0")"
PORT="${PORT:-8901}"
if ! curl -fs -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
  nohup python3 -m http.server "$PORT" >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:$PORT/index.html"
