# Deployment and limits

## The reality: 3 hours in 4K

A video of about 3 hours in 4K can exceed **tens of GB**, depending on bitrate and codec. Spotidraft:

1. downloads it with yt-dlp
2. packages it
3. uploads it through a browser (Playwright) to Creators

That needs **a large disk**, **stable CPU and network** and **a long session**: the opposite of a
typical free tier.

| Option | Free tier? | Handles 3 h in 4K? | Notes |
|--------|------------|--------------------|-------|
| **Local (recommended)** | n/a | Yes | Your disk, GPU and network; cookies in `profiles/` |
| Desktop binary (Electron) | n/a | Yes | Bundles UI and API; still runs on the user's machine |
| Railway / Render / Fly free | Fragile | No | Ephemeral disk, timeouts, little RAM |
| Cloudflare Workers / Vercel | Yes | No | No long downloads, no heavy Playwright |
| Cheap VPS (Hetzner etc.) | Paid | Maybe | Disk plus upload time; sensitive cookies |
| GPU cloud free credits | Limited | Risky | Cost climbs fast with 4K |

**Bottom line:** a cloud free tier is not a serious option for 3 hours of 4K. Local is. The cloud
only works with a paid disk or VM, and accepting the session and cookie risk.

## Disk use in practice

The default quality is **1080p**, not "best available". Measured on a 44-minute video from the
same channel:

| Quality | Size |
|---------|------|
| Best (4K) | 2,166 MB |
| 1080p (default) | 401 MB |
| 720p | 244 MB |

That is 5.4× fewer bytes to download, store and upload, and Creators re-encodes anyway. "Best
available" is still in the options for whoever needs it.

The video file is **deleted as soon as the draft exists on Spotify** (`src/cleanup.js`). The
sidecars stay: the `.info.json` feeds duration and description in the queue, and the thumbnail is a
few dozen KB. Failed uploads keep the file, so they can be retried without downloading again.

## Concurrent downloads

Each yt-dlp call downloads one video and has its own archive file, which lets downloads run in
parallel. The default is **2 lanes** (`SPOTIDRAFT_DOWNLOAD_LANES`, max 4).

Measured with two videos from the same channel at 720p, in reversed order so neither scenario is
favoured:

| Scenario | Total | Per video |
|----------|-------|-----------|
| Parallel (2 lanes) | 46 s | 45 s, 46 s |
| Sequential | 70 s | 34 s, 36 s |

**1.52×**, not 2×, because bandwidth is shared: each download gets about 30% slower. The gain comes
from overlapping the 10 to 15 seconds of metadata extraction and using idle bandwidth.

About the `HTTP 403` the extractor sometimes returns: in a controlled test it was **not** caused by
concurrency but by *repetition*, re-downloading the same videos a few seconds later. Running both
lanes first, on fresh videos, worked (2 of 2). The 4-lane ceiling exists anyway because each lane
brings an ffmpeg competing for CPU during the merge.

End to end, uploads to Creators are usually the slowest step (see `SPOTIDRAFT_UPLOAD_LANES` in the
README). In a large batch, total time tends to be bound by uploads, so much of the download gain is
absorbed by the upload queue. It really shows on large videos, in audio-only mode, or when YouTube
is slow.

## Ways forward

### A) Local executable (Electron), preferred

| Command | Output |
|---------|--------|
| `npm run electron:dist:linux` | `release/*.AppImage` |
| `npm run electron:dist:win` | `release/*Setup*.exe` (run on Windows) |
| `npm run electron:dist:mac` | `release/*.dmg` (run on a Mac) |

Or **GitHub Actions** → the *Desktop builds* workflow (ubuntu/windows/macos matrix).

The app starts the embedded API, opens the UI and keeps the session in the OS `userData` folder. It
bundles **yt-dlp** and **Chromium (Playwright)**: a large installer (about 200 to 400 MB), but no
Node needed.

A useful external dependency: **ffmpeg** on the PATH (merges formats). Without it, use audio-only
or install ffmpeg.

### B) Light hosting (metadata and queue only)

Possible on a free tier: list channels and build the queue, but **don't** download 4K on the
server; download and upload run on the user's desktop (a local agent). A hybrid architecture, and
more work.

### C) Minimal paid VPS

If it has to be remote: one VPS with at least 100 to 200 GB of SSD, one episode at a time, cleaning
`data/downloads` after each draft. Still not free.

## Security

Never commit `profiles/`, `data/` or a session cURL. In the cloud, Creators cookies are high risk:
they are the show's account.
