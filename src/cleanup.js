import fs from "node:fs";
import path from "node:path";

/**
 * Reclaim disk after an episode is safely on Spotify.
 *
 * The video file is by far the bulk (hundreds of MB to a few GB each) and is
 * dead weight once the draft exists. The sidecars stay: the .info.json feeds
 * duration/description in the queue view and the .jpg is a few dozen KB.
 *
 * Only ever called after markPublished, so a failed upload keeps its file and
 * can be retried without re-downloading.
 */

/** Files a finished episode no longer needs, in the same directory. */
function leftoverParts(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base) && /\.(part|ytdl)$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * @returns {{ freedBytes: number, removed: string[] }}
 */
export function releaseEpisodeMedia(episode) {
  const removed = [];
  let freedBytes = 0;

  const targets = [];
  if (episode?.video_path) {
    targets.push(episode.video_path, ...leftoverParts(episode.video_path));
  }

  for (const file of targets) {
    try {
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      fs.unlinkSync(file);
      freedBytes += stat.size;
      removed.push(file);
    } catch {
      // Best effort — a locked or already-gone file must never fail a job.
    }
  }

  return { freedBytes, removed };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Total bytes held by downloaded media, for a "free up space" affordance. */
export function downloadsSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mp4|m4a|webm|mkv|part)$/i.test(e.name)) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return total;
}
