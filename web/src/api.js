async function req(path, opts = {}) {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _t, ...fetchOpts } = opts;
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(fetchOpts.headers || {}) },
      signal: controller.signal,
      ...fetchOpts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || "Erro");
    return data;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Tempo esgotado — tente de novo.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  session: () => req("/api/session"),
  show: () => req("/api/show"),
  saveCurl: (curl) =>
    req("/api/session/curl", { method: "POST", body: JSON.stringify({ curl }) }),
  config: () => req("/api/config"),
  listYoutube: (url, limit, opts = {}) =>
    req("/api/youtube/list", {
      method: "POST",
      body: JSON.stringify({
        url,
        limit: limit || undefined,
        offset: opts.offset || 0,
        flat: Boolean(opts.flat),
      }),
      timeoutMs: 300_000,
    }),
  youtubeChannel: (url, opts = {}) =>
    req("/api/youtube/channel", {
      method: "POST",
      body: JSON.stringify({
        url,
        videoLimit: opts.videoLimit,
        videoOffset: opts.videoOffset || 0,
        playlistLimit: opts.playlistLimit,
        videosOnly: Boolean(opts.videosOnly),
        refresh: Boolean(opts.refresh),
      }),
      timeoutMs: 180_000,
    }),
  youtubeVideo: (idOrUrl) =>
    req("/api/youtube/video", {
      method: "POST",
      body: JSON.stringify(
        typeof idOrUrl === "string" && idOrUrl.startsWith("http")
          ? { url: idOrUrl }
          : { id: idOrUrl }
      ),
      timeoutMs: 60_000,
    }),
  importVideos: (payload) =>
    req("/api/import", { method: "POST", body: JSON.stringify(payload) }),
  queue: () => req("/api/queue"),
  /** Only rows touched since `iso` — used by the polling fallback. */
  queueSince: (iso) =>
    req(`/api/queue?since=${encodeURIComponent(iso)}`),
  logs: (jobId) =>
    req(`/api/logs${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`),
  /** URL for EventSource — kept here so path logic lives in one place. */
  eventsUrl: (lastEventId) =>
    `/api/events${lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : ""}`,
  jobs: () => req("/api/jobs"),
  job: (id) => req(`/api/jobs/${id}`),
  cancelJob: (id) =>
    req(`/api/jobs/${id}/cancel`, { method: "POST", body: "{}" }),
  cancelEpisode: (id) =>
    req("/api/queue/cancel", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  requeue: (id) =>
    req("/api/queue/requeue", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  startWorker: () => req("/api/worker/start", { method: "POST", body: "{}" }),
  spotifyEpisodes: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.refresh) params.set("refresh", "1");
    // bust any intermediary GET cache
    params.set("_", String(Date.now()));
    return req(`/api/spotify/episodes?${params}`, { timeoutMs: 180_000 });
  },
  deleteSpotifyEpisode: (title) =>
    req("/api/spotify/episodes/delete", {
      method: "POST",
      body: JSON.stringify({ title }),
      timeoutMs: 120_000,
    }),
};
