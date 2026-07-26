const KEY = "spotidraft.channels";
const LEGACY_KEY = "spotidraft.favoriteChannel";
const LAST_KEY = "spotidraft.lastChannel";
const MAX = 12;

/**
 * Remembered YouTube channels. Replaces the single-favourite model: people work
 * across several channels and re-pasting a URL each time is the friction.
 *
 * Stored newest-used first, so the list doubles as "recent".
 */

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((c) => c?.url);
    }
  } catch {
    /* fall through to migration */
  }

  // One-time migration from the old single-favourite key.
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (legacy?.url) {
      const migrated = [normalize(legacy)];
      write(migrated);
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked — remembering is best-effort */
  }
}

function normalize(channel) {
  return {
    id: channel.id || null,
    handle: channel.handle || null,
    title: channel.title || channel.handle || "Canal",
    url: channel.url,
    thumb: channel.thumb || null,
    savedAt: channel.savedAt || new Date().toISOString(),
  };
}

/** Same channel? URL is the primary key; id/handle catch URL-format drift. */
export function isSameChannel(a, b) {
  if (!a || !b) return false;
  if (a.url && b.url && a.url === b.url) return true;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.handle && b.handle && a.handle === b.handle) return true;
  return false;
}

export function loadChannels() {
  return read();
}

/** Add or move-to-front. Returns the updated list. */
export function rememberChannel(channel) {
  if (!channel?.url) return read();
  const next = normalize(channel);
  const list = read().filter((c) => !isSameChannel(c, next));
  list.unshift(next);
  write(list);
  return list;
}

export function forgetChannel(channel) {
  const list = read().filter((c) => !isSameChannel(c, channel));
  write(list);
  return list;
}

/** The channel to open on load — the most recently used one. */
export function lastChannel() {
  try {
    const url = localStorage.getItem(LAST_KEY);
    if (url) {
      const hit = read().find((c) => c.url === url);
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }
  return read()[0] || null;
}

export function setLastChannel(channel) {
  try {
    if (channel?.url) localStorage.setItem(LAST_KEY, channel.url);
  } catch {
    /* ignore */
  }
}
