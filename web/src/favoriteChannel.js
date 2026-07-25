const KEY = "spotidraft.favoriteChannel";

export function loadFavoriteChannel() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.url || !data?.title) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveFavoriteChannel(channel) {
  if (!channel?.url) return;
  const payload = {
    id: channel.id || null,
    handle: channel.handle || null,
    title: channel.title || channel.handle || "Canal",
    url: channel.url,
    thumb: channel.thumb || null,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload;
}

export function clearFavoriteChannel() {
  localStorage.removeItem(KEY);
}
