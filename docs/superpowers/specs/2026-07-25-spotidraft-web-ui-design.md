# Spotidraft web UI — design

Date: 2026-07-25

## Goal

Give creators a remote-friendly web app to: refresh Spotify Creators session (curl), resolve a YouTube URL into a selectable video list with import options, run download→draft upload, watch progress, and open Creators in Spotify.

## Architecture (local-first v1)

- **Frontend**: Vite + React (SPA) in `web/`
- **Backend**: small Node HTTP API in `src/server/` wrapping existing CLI modules (`download-ytdlp`, queue DB, `importFromCurl`, worker drain)
- **Process model v1**: API process runs downloads + Playwright worker on the same machine (same as today’s CLI). Remote hosting = later phase (auth, secrets, queue isolation).

## Shell & navigation

Left nav + main canvas (not a wizard):

| Route | Purpose | Primary action |
|-------|---------|----------------|
| `/` → `/import` | Paste URL, list videos, choose options, start import | Enviar como draft |
| `/progress` | Live queue (pending/uploading/published/failed) | Requeue failed |
| `/session` | Paste curl, save cookies, session health | Salvar sessão |

Top bar (all routes): Spotidraft wordmark area · session chip (ok / expired) · **Abrir no Spotify** (accent CTA → Creators episodes URL).

Mobile: nav collapses to top tabs or drawer; same three destinations.

## Import flow

1. User pastes YouTube URL (video | playlist | channel).
2. **Listar** calls API → yt-dlp flat/metadata listing (no full download yet when possible).
3. UI shows table: checkbox, title, duration, id.
4. Batch options (apply to selected):
   - Quality: best (default) | specific height presets later
   - Media: video+audio (default) | audio only
   - Thumbnail: on (default) | off
   - Description: on (default) | off
5. **Enviar como draft** → enqueue selected → background worker uploads drafts.
6. Navigate user to `/progress` (or keep toast + link).

## Session / curl

- Textarea for raw curl from logged-in Creators.
- Server calls existing `importFromCurl`; never echoes secrets back in logs/UI.
- Session chip reads cookie presence / lightweight Creators probe when feasible.

## Progress

- Poll or SSE queue status from SQLite.
- Rows: status pill, title, error snippet.
- Actions: requeue failed; open Creators.

## Out of scope (v1)

- Multi-tenant auth / hosted secrets vault
- True publish (non-draft) as default
- Re-encoding UI beyond options above
- Mobile native apps

## Visual

Follows root `DESIGN.md` / `PRODUCT.md`: dark, Fraunces + IBM Plex Sans, sea-glass teal primary, amber Spotify CTA only.

## Success criteria

- Non-engineer can refresh session via curl, import a playlist subset as drafts, and verify in Creators without CLI.
