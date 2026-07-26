/** Shared YouTube URL/id helpers, used by both the Home shelf and Import. */

export function ytThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Playlist / canal / lista — não vídeo solto. */
export function isListUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.searchParams.get("list")) return true;
    const p = u.pathname;
    if (p.includes("/playlist")) return true;
    if (p.includes("/channel/")) return true;
    if (p.includes("/c/")) return true;
    if (p.includes("/user/")) return true;
    if (p.startsWith("/@")) return true;
    if (p.includes("/videos")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Does this look like something we can resolve to a channel? Checked before
 * spending half a minute server-side on yt-dlp, so a typo fails immediately.
 *
 * Accepts more than URLs on purpose — the server's normalizeChannelInput also
 * takes "@handle" and a bare handle, and typing "@canalgweek" is the fastest
 * way in.
 */
export function isChannelQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;

  // @handle
  if (/^@[\w.-]{2,}$/.test(s)) return true;

  // Bare handle / channel name, no scheme and no spaces.
  if (/^[\w.-]{2,}$/.test(s) && !s.includes("/")) return true;

  // youtube.com/... without a scheme
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, "")}`;
  try {
    const u = new URL(withScheme);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** True only for a full YouTube URL — used where a bare handle makes no sense. */
export function isYoutubeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}
