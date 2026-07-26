import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

/**
 * Disk cache for resolved YouTube channels.
 *
 * Resolving a channel costs three yt-dlp calls at ~13-17s each of pure network
 * wait (CPU sits at ~5%), so there is nothing to optimize in the calls
 * themselves — the win is not making them twice. Reopening a favourite channel
 * is the common path and it should be instant.
 *
 * Strategy is stale-while-revalidate: always serve what we have, refresh in the
 * background, and push the fresh copy over SSE when it lands.
 */

const CACHE_PATH = path.join(DATA_DIR, "channel-cache.json");
/** Older than this and we revalidate — while still serving the stale copy. */
export const CHANNEL_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 24;

function readAll() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(all));
  } catch {
    /* cache is best-effort */
  }
}

/** Cache key: the canonical channel URL plus the page window being requested. */
export function channelCacheKey(url, { videoLimit, videoOffset, playlistLimit } = {}) {
  return [String(url).trim().toLowerCase(), videoLimit ?? 12, videoOffset ?? 0, playlistLimit ?? 24].join(
    "|"
  );
}

export function getCachedChannel(key) {
  const entry = readAll()[key];
  if (!entry?.data) return null;
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    stale: Date.now() - new Date(entry.fetchedAt).getTime() > CHANNEL_TTL_MS,
  };
}

export function putCachedChannel(key, data) {
  const all = readAll();
  all[key] = { data, fetchedAt: new Date().toISOString() };

  // Keep the file small — drop the oldest entries past the cap.
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => new Date(all[a].fetchedAt) - new Date(all[b].fetchedAt))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete all[k]);
  }
  writeAll(all);
  return all[key];
}

export function clearChannelCache() {
  writeAll({});
}
