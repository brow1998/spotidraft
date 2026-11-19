# Changelog

## 0.2.0

A release about speed, and about showing what used to be a blind wait. The numbers come from
measurements in the app, not estimates.

### Performance

- **Downloads and uploads overlap.** Video 1 uploads while video 2 downloads. Before, the whole
  batch downloaded before the first upload started.
- **One browser per batch, not per episode.** The Creators login (up to 60 s) used to be paid on
  every episode; now it's paid once, in parallel with the first download.
- **Parallel downloads**: 2 lanes by default (`SPOTIDRAFT_DOWNLOAD_LANES`, max 4). Measured 46 s
  against 70 s sequential (**1.52×**). Each yt-dlp call now gets its own archive file, which was the
  real point of contention.
- **Parallel uploads**: 2 lanes by default (`SPOTIDRAFT_UPLOAD_LANES`, max 5). Measured with 3 lanes
  against the real Creators site: 26 s against about 76 s sequential (**2.9×**), with 24/26/26 s per
  lane. Each lane has its own Chromium profile and shares the injected cookies.
- **Default quality is now 1080p.** "Best available" downloaded 4K: 2,166 MB against 401 MB for the
  same video, 5.4× fewer bytes to download, store and upload, for something Spotify re-encodes
  anyway.
- **The video is deleted once the draft exists.** A test catalog went from 5.0 GB to 1.3 MB. A
  failed upload keeps the file so it can be retried without downloading again.
- **Resolved channels are cached** and revalidated in the background. Reopening a channel went from
  about 34 s to about 0.01 s.
- **Polling replaced with SSE.** The queue used to be refetched every 2 s, with a disk read per
  episode; now each event patches one row.

### Visibility

- Real progress bars for download and upload, with speed, ETA and the current item.
- Uploads report the current step: sending the file, Spotify processing (with elapsed time),
  filling in the title, adding the description, uploading the thumbnail, saving the draft.
- A log panel with yt-dlp and automation output, previously only visible in the server's stderr.
- The ffmpeg merge step shows as indeterminate instead of looking stuck.

### Fixes

- **Re-queueing a failed download didn't work.** The episode moved to "ready to upload" without a
  file and failed immediately with `video_path missing`. It now goes back to the download queue
  when there is no file.
- **Concurrent jobs.** A second import marked itself as done without uploading anything.
- **Cancel didn't stop yt-dlp.** The process kept downloading for minutes, and the ffmpeg merge was
  orphaned when only the parent was signalled.
- **Interrupted work got stuck.** Downloads go back to the queue on boot; interrupted uploads become
  an explicit failure with no automatic retry, because the draft may already exist on Spotify.
- **Listing and deleting Spotify episodes never worked**: `ensureEpisodesPage` was called but never
  existed.
- **The show name came back as garbage** ("checkbox label"). The Creators nav lives in shadow DOM,
  which `querySelectorAll` doesn't cross.
- **The upload timeout was a fixed 6 minutes** and, when it ran out, carried on anyway; the error
  surfaced later as "Description field not found". It now scales with file size and fails saying
  what happened.
- **`@handle` is accepted again** in the channel field, alongside plain names and URLs.
- Cancel and re-queue had no error handling and failed silently.

### Interface

- A proper logo, used in the sidebar, the favicon and the app icon.
- Several remembered channels with quick switching; before, there was a single favorite and a
  dialog asked every time.
- Collapsible sidebar with the session status always visible; the top bar became a floating button.
- Upload and queue actions appear over the thumbnail on hover; clicking elsewhere opens the details.
- Spotify screen with the show's cover art; the Show ID is out of sight.
- Toasts that survive navigation, a confirmation dialog instead of `window.confirm`, focus trapped in
  modals, skeletons, and a fix for content stuck to the left edge.

### Internal

- Pipeline extracted from `src/server/index.js` into `src/server/pipeline.js`.
- Creators automation split into `creators-dom` (DOM), `creators-session` (reusable session) and
  `profile-lease` (profile lock).
- 82 tests, up from 5.

## 0.1.0

First version: YouTube → Spotify for Creators drafts, with a CLI, a web UI and an Electron app.
