#!/bin/sh
# Stop the Bible Tracker local server started by start-server.sh.
pkill -f "http.server 8901" 2>/dev/null && echo "Server stopped." || echo "No server was running."
