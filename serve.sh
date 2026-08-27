#!/usr/bin/env bash
# Web MIDI needs a secure context, and localhost counts -- so this must be served,
# not opened as a file:// URL.
set -euo pipefail
PORT="${1:-8765}"
cd "$(dirname "$0")"
echo "http://localhost:$PORT  (Chrome required for Web MIDI)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
