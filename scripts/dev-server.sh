#!/usr/bin/env bash
# Run the server against the SAME data/profile the installed desktop app uses,
# so the Spotify session (cookies + showId) is shared instead of re-pasted.
#
# Note: Chromium locks the profile directory exclusively — don't upload from the
# desktop app and from here at the same time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_DATA="${SPOTIDRAFT_APP_DATA:-$HOME/Library/Application Support/Spotidraft}"

if [ ! -d "$APP_DATA" ]; then
  echo "Perfil do app não encontrado em: $APP_DATA" >&2
  echo "Abra o Spotidraft uma vez, ou defina SPOTIDRAFT_APP_DATA." >&2
  exit 1
fi

export SPOTIDRAFT_ROOT="$APP_DATA"
export SPOTIDRAFT_DATA="$APP_DATA/data"
export SPOTIDRAFT_PROFILE="$APP_DATA/profiles/creators"
export SPOTIDRAFT_RESOURCES="$ROOT"

# yt-dlp is not on PATH — the app ships its own copy. Prefer the vendored one,
# fall back to the installed app's, then to whatever is on PATH.
for candidate in \
  "$ROOT/vendor/yt-dlp/yt-dlp" \
  "/Applications/Spotidraft.app/Contents/Resources/bin/yt-dlp" \
  "$(command -v yt-dlp || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    export YT_DLP="$candidate"
    break
  fi
done

if [ -z "${YT_DLP:-}" ]; then
  echo "yt-dlp não encontrado. Rode: npm run electron:yt-dlp" >&2
  exit 1
fi

# Playwright browsers ship vendored too.
if [ -d "$ROOT/vendor/ms-playwright" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$ROOT/vendor/ms-playwright"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "AVISO: ffmpeg não está no PATH — o merge de áudio+vídeo vai falhar." >&2
fi

export PORT="${PORT:-8787}"

echo "data:    $SPOTIDRAFT_DATA"
echo "profile: $SPOTIDRAFT_PROFILE"
echo "yt-dlp:  $YT_DLP"
echo "porta:   $PORT"
echo

exec node src/server/index.js
