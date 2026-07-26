import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cancelJob,
  createJob,
  getEpisode,
  getJob,
  listEpisodes,
  listJobs,
  jobsWithActiveEpisodes,
  publishedWithMedia,
  recoverStaleWork,
  requestCancelEpisode,
  requeueFailed,
  updateEpisodeFields,
  updateJob,
  upsertEpisode,
} from "../db.js";
import { formatBytes, releaseEpisodeMedia } from "../cleanup.js";
import {
  listYoutubeVideos,
  fetchYoutubeChannel,
  fetchYoutubeVideoMeta,
} from "../download-ytdlp.js";
import { importFromCurl, loadCookies, loadConfig, saveConfig } from "../session.js";
import {
  channelCacheKey,
  getCachedChannel,
  putCachedChannel,
} from "../channel-cache.js";
import {
  deleteCreatorsEpisode,
  fetchCreatorsCatalog,
  isValidShowName,
} from "../adapters/creators-manage.js";
import { closeAllCreatorsSessions } from "../adapters/creators-session.js";
import { DATA_DIR, WEB_DIST } from "../paths.js";
import {
  BOOT_ID,
  bus,
  emitEvent,
  emitLog,
  eventsSince,
  lastEventId,
  recentLogs,
  serializeSse,
} from "./events.js";
import {
  clearSessionBlock,
  ensureUploader,
  finalizeOrphanedJobs,
  isSessionBlocked,
  isUploaderRunning,
  resumeJobs,
  runImportJob,
  watchJobToCompletion,
} from "./pipeline.js";

const PORT = Number(process.env.PORT || 8787);
const CATALOG_CACHE_PATH = path.join(DATA_DIR, "creators-catalog.json");

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
}

function loadCatalogCache() {
  try {
    if (!fs.existsSync(CATALOG_CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CATALOG_CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveCatalogCache(catalog) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();
  const payload = {
    ...catalog,
    fetchedAt: now,
    cachedAt: now,
  };
  fs.writeFileSync(CATALOG_CACHE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function readPackageMeta(metaPath) {
  if (!metaPath || !fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const s = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Enriching a row costs 3 stat calls plus a JSON parse. With the queue polled
 * every couple of seconds that was dozens of synchronous syscalls per second on
 * the same thread that drives Playwright and yt-dlp.
 *
 * updated_at is bumped by every mutation, so it makes an exact cache key: a row
 * that hasn't changed does no filesystem work at all.
 */
const enrichCache = new Map();
const ENRICH_CACHE_CAP = 500;

function enrichEpisodeRow(r) {
  const key = `${r.id}:${r.updated_at}`;
  const hit = enrichCache.get(key);
  if (hit) return hit;

  const fresh = buildEpisodeRow(r);
  if (enrichCache.size >= ENRICH_CACHE_CAP) {
    enrichCache.delete(enrichCache.keys().next().value);
  }
  enrichCache.set(key, fresh);
  return fresh;
}

function buildEpisodeRow(r) {
  const meta = readPackageMeta(r.meta_path);
  const videoPath = r.video_path || meta?.video || "";
  const ext = path.extname(videoPath).replace(/^\./, "").toLowerCase();
  const hasThumb = Boolean(r.image_path && fs.existsSync(r.image_path));
  const durationSec =
    meta?.duration ??
    meta?.duration_seconds ??
    (meta?.clipSeconds != null ? Number(meta.clipSeconds) : null);
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    draft: Boolean(r.draft),
    error: r.error || null,
    job_id: r.job_id || null,
    cancel_requested: Boolean(r.cancel_requested),
    updated_at: r.updated_at,
    published_at: r.published_at || null,
    description: r.description || meta?.description || "",
    source_url: `https://www.youtube.com/watch?v=${r.id}`,
    thumb_url: hasThumb ? `/api/media/thumb/${encodeURIComponent(r.id)}` : null,
    format: ext ? ext.toUpperCase() : null,
    duration: formatDuration(durationSec),
    duration_seconds: durationSec,
    clip_seconds: meta?.clipSeconds ?? null,
    has_video: Boolean(videoPath && fs.existsSync(videoPath)),
    // Published episodes have their video deleted on purpose to reclaim disk —
    // the UI must not present that as a missing file.
    media_released: r.status === "published" && !videoPath,
    has_thumb: hasThumb,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

/** In-flight revalidations, so N requests don't spawn N yt-dlp fleets. */
const refreshingChannels = new Set();

function refreshChannelInBackground(key, params) {
  if (refreshingChannels.has(key)) return;
  refreshingChannels.add(key);
  fetchYoutubeChannel(params)
    .then((fresh) => {
      putCachedChannel(key, fresh);
      // The client is showing the stale copy — tell it there's a newer one.
      emitEvent("channel.updated", { url: params.url, channel: fresh.channel });
    })
    .catch((e) => emitLog("warn", "ytdlp", `revalidação do canal falhou: ${e.message}`))
    .finally(() => refreshingChannels.delete(key));
}

function sessionStatus() {
  const cookies = loadCookies();
  const cfg = loadConfig() || {};
  const count = cookies?.length || 0;
  const hasSpDc = Boolean(cookies?.some((c) => c.name === "sp_dc"));
  return {
    ok: count > 0 && hasSpDc,
    cookieCount: count,
    hasSpDc,
    showId: cfg.showId || null,
    episodesUrl: cfg.episodesUrl || null,
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true, name: "Spotidraft" });
  }

  if (pathname === "/api/session" && req.method === "GET") {
    return json(res, 200, sessionStatus());
  }

  if (pathname === "/api/session/curl" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.curl) return json(res, 400, { error: "curl obrigatório" });
    const result = importFromCurl(String(body.curl));
    // Fresh cookies unblock a batch that stopped on an expired session.
    const resumed = clearSessionBlock({ headless: true });
    return json(res, 200, { ...result, resumed, session: sessionStatus() });
  }

  if (pathname === "/api/config" && req.method === "GET") {
    const cfg = loadConfig() || {};
    return json(res, 200, {
      showId: cfg.showId || null,
      episodesUrl: cfg.episodesUrl || null,
      workerRunning: isUploaderRunning(),
      sessionBlocked: isSessionBlocked(),
    });
  }

  if (pathname === "/api/youtube/list" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.url) return json(res, 400, { error: "url obrigatória" });
    const videos = await listYoutubeVideos({
      url: String(body.url),
      limit: body.limit,
      offset: body.offset || 0,
      flat: Boolean(body.flat),
    });
    return json(res, 200, {
      videos,
      count: videos.length,
      hasMore:
        body.limit != null && Number(body.limit) > 0
          ? videos.length >= Number(body.limit)
          : false,
      isPlaylistLike: videos.length > 1,
    });
  }

  if (pathname === "/api/youtube/video" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.id && !body.url) {
      return json(res, 400, { error: "id ou url do vídeo obrigatório" });
    }
    const video = await fetchYoutubeVideoMeta({
      id: body.id ? String(body.id) : undefined,
      url: body.url ? String(body.url) : undefined,
    });
    return json(res, 200, { video });
  }

  if (pathname === "/api/youtube/channel" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.url) return json(res, 400, { error: "url do canal obrigatória" });
    const params = {
      url: String(body.url),
      videoLimit: body.videoLimit || 12,
      videoOffset: body.videoOffset || 0,
      playlistLimit: body.playlistLimit || 24,
      videosOnly: Boolean(body.videosOnly),
    };

    // Paging and videos-only are not worth caching — they're already narrow and
    // the user isn't sitting on them the way they sit on a channel's first page.
    const cacheable = !params.videosOnly && !params.videoOffset;
    const key = cacheable ? channelCacheKey(params.url, params) : null;
    const cached = key ? getCachedChannel(key) : null;

    if (cached && !body.refresh) {
      // Serve instantly; revalidate behind the user's back if it aged out.
      if (cached.stale) refreshChannelInBackground(key, params);
      return json(res, 200, {
        ...cached.data,
        fromCache: true,
        stale: cached.stale,
        fetchedAt: cached.fetchedAt,
      });
    }

    const data = await fetchYoutubeChannel(params);
    if (key) putCachedChannel(key, data);
    return json(res, 200, { ...data, fromCache: false });
  }

  if (pathname === "/api/import" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.url) return json(res, 400, { error: "url obrigatória" });
    const videoIds = Array.isArray(body.videoIds) ? body.videoIds.map(String) : [];
    if (!videoIds.length) {
      return json(res, 400, { error: "selecione ao menos um vídeo" });
    }
    const titles = body.titles && typeof body.titles === "object" ? body.titles : {};
    const options = {
      videoIds,
      audioOnly: Boolean(body.audioOnly),
      withThumb: body.withThumb !== false,
      withDescription: body.withDescription !== false,
      maxHeight: body.maxHeight || null,
      headless: body.headless !== false,
    };
    const job = createJob({
      type: "import",
      url: String(body.url),
      options,
    });

    for (const id of videoIds) {
      upsertEpisode({
        id,
        title: titles[id] || id,
        description: "",
        video_path: "",
        image_path: null,
        meta_path: null,
        status: "queued",
        draft: true,
        job_id: job.id,
      });
    }

    emitEvent("queue.invalidate", {});
    setImmediate(() => {
      runImportJob(job.id).catch((e) => console.error(e));
    });

    return json(res, 202, { jobId: job.id, job: getJob(job.id) });
  }

  if (pathname === "/api/jobs" && req.method === "GET") {
    return json(res, 200, { jobs: listJobs(40) });
  }

  if (pathname.startsWith("/api/jobs/") && req.method === "GET") {
    const id = pathname.slice("/api/jobs/".length);
    const job = getJob(id);
    if (!job) return json(res, 404, { error: "job não encontrado" });
    const episodes = listEpisodes().filter((e) => e.job_id === id);
    return json(res, 200, { job, episodes });
  }

  if (pathname.startsWith("/api/jobs/") && pathname.endsWith("/cancel") && req.method === "POST") {
    const id = pathname.slice("/api/jobs/".length, -"/cancel".length);
    return json(res, 200, cancelJob(id));
  }

  if (pathname === "/api/queue" && req.method === "GET") {
    const since = url.searchParams.get("since");
    let rows = listEpisodes();
    if (since) rows = rows.filter((r) => r.updated_at > since);
    return json(res, 200, {
      episodes: rows.map((r) => enrichEpisodeRow(r)),
      workerRunning: isUploaderRunning(),
      sessionBlocked: isSessionBlocked(),
      partial: Boolean(since),
      lastEventId: lastEventId(),
      jobs: listJobs(20),
    });
  }

  if (pathname === "/api/logs" && req.method === "GET") {
    const jobId = url.searchParams.get("jobId") || undefined;
    const limit = Number(url.searchParams.get("limit")) || 300;
    return json(res, 200, {
      logs: recentLogs({ jobId, limit: Math.min(1000, limit) }),
    });
  }

  if (pathname.startsWith("/api/media/thumb/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/media/thumb/".length));
    const ep = getEpisode(id);
    if (!ep?.image_path || !fs.existsSync(ep.image_path)) {
      return json(res, 404, { error: "thumb não encontrada" });
    }
    const ext = path.extname(ep.image_path).toLowerCase();
    const type =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    return fs.createReadStream(ep.image_path).pipe(res);
  }

  if (pathname === "/api/queue/requeue" && req.method === "POST") {
    const body = await readBody(req);
    const { requeued, toDownload, jobIds, touchedJobs } = requeueFailed(
      body.id || undefined
    );
    clearSessionBlock({ headless: true });

    // Any job with work back in flight has to look active again, or the
    // progress card stays hidden and the retry runs invisibly.
    for (const id of touchedJobs) {
      updateJob(id, { status: "running", error: null });
      emitEvent("job.status", { jobId: id, status: "running" });
    }

    // Episodes with no file on disk need the download to run again, and only
    // their job knows the source URL and options — so re-run those jobs. The
    // loop skips episodes that already finished.
    if (jobIds.length) resumeJobs(jobIds);

    // Upload-only retries have no download loop to finalize them, so give the
    // job a watcher that closes it out when its episodes are terminal.
    for (const id of touchedJobs) {
      if (!jobIds.includes(id)) watchJobToCompletion(id);
    }
    ensureUploader({ headless: true });
    emitEvent("queue.invalidate", {});
    return json(res, 200, {
      ok: true,
      requeued,
      redownloading: toDownload.length,
    });
  }

  if (pathname === "/api/queue/cancel" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.id) return json(res, 400, { error: "id obrigatório" });
    const result = requestCancelEpisode(String(body.id));
    emitEvent("episode.status", { id: String(body.id), status: result.status });
    return json(res, 200, result);
  }

  if (pathname === "/api/show" && req.method === "GET") {
    const cfg = loadConfig() || {};
    const session = sessionStatus();
    const cached = loadCatalogCache();
    const name = isValidShowName(cfg.showName) ? cfg.showName : null;
    const imageUrl =
      cfg.showImage ||
      cached?.show?.imageUrl ||
      cached?.episodes?.find((e) => e.thumb)?.thumb ||
      null;
    return json(res, 200, {
      session,
      show: {
        showId: cfg.showId || null,
        episodesUrl: cfg.episodesUrl || null,
        homeUrl: cfg.homeUrl || null,
        name,
        imageUrl,
      },
    });
  }

  if (pathname === "/api/spotify/episodes" && req.method === "GET") {
    const forceRefresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";
    const cached = loadCatalogCache();

    if (!forceRefresh && cached?.episodes) {
      return json(res, 200, {
        ...cached,
        fromCache: true,
      });
    }

    const catalog = await fetchCreatorsCatalog({ headless: true });
    const patch = {};
    if (isValidShowName(catalog.show?.name)) {
      patch.showName = catalog.show.name;
    }
    if (catalog.show?.imageUrl) {
      patch.showImage = catalog.show.imageUrl;
    }
    if (Object.keys(patch).length) saveConfig(patch);
    const saved = saveCatalogCache(catalog);
    return json(res, 200, { ...saved, fromCache: false });
  }

  if (pathname === "/api/spotify/episodes/delete" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.title) return json(res, 400, { error: "title obrigatório" });
    const result = await deleteCreatorsEpisode({
      title: String(body.title),
      headless: true,
    });
    // Drop deleted title from cache so UI stays usable without full scrape
    const cached = loadCatalogCache();
    if (cached?.episodes) {
      cached.episodes = cached.episodes.filter(
        (e) => e.title !== String(body.title)
      );
      cached.fetchedAt = new Date().toISOString();
      saveCatalogCache(cached);
    }
    return json(res, 200, result);
  }

  if (pathname === "/api/worker/start" && req.method === "POST") {
    if (isUploaderRunning()) {
      return json(res, 200, { started: false, workerRunning: true });
    }
    clearSessionBlock({ headless: true });
    // Draining the queue by hand still has to close the jobs out — only
    // runImportJob does that on its own, and it isn't involved here.
    for (const id of jobsWithActiveEpisodes()) watchJobToCompletion(id);
    ensureUploader({ headless: true });
    return json(res, 200, { started: true });
  }

  return json(res, 404, { error: "not found" });
}

// ------------------------------------------------------------------ SSE

const sseClients = new Set();

function handleEvents(req, res, url) {
  // Deliberately not going through json() — that helper pins the content type.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Tell any intermediary not to buffer; a buffered stream looks identical
    // to a dead one from the client's side.
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders?.();
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  const write = (evt) => {
    if (res.writableEnded) return;
    try {
      res.write(serializeSse(evt));
    } catch {
      cleanup();
    }
  };

  write({ id: 0, type: "hello", data: { bootId: BOOT_ID, lastEventId: lastEventId() } });

  // EventSource sends Last-Event-ID automatically when it reconnects.
  const resume =
    req.headers["last-event-id"] || url.searchParams.get("lastEventId");
  if (resume) for (const evt of eventsSince(resume)) write(evt);

  bus.on("event", write);
  sseClients.add(res);

  // A real `ping` event, not a `:` comment: a comment keeps the socket alive but
  // is invisible to EventSource, so the client can't use it as a liveness signal.
  const heartbeat = setInterval(() => write({ id: 0, type: "ping", data: {} }), 15_000);
  heartbeat.unref?.();

  let done = false;
  function cleanup() {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    bus.off("event", write);
    sseClients.delete(res);
  }
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function serveStatic(req, res, url) {
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "Content-Type": contentType(file) });
    return fs.createReadStream(file).pipe(res);
  }
  const index = path.join(WEB_DIST, "index.html");
  if (fs.existsSync(index)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(index).pipe(res);
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Build the web app: cd web && npm run build");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/api/events" && req.method === "GET") {
      return handleEvents(req, res, url);
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message || String(e) });
  }
});

/** Reconcile work left mid-flight by a crash, before we accept any request. */
function bootRecovery() {
  const r = recoverStaleWork();
  if (r.stuckDownloads) {
    emitLog(
      "warn",
      "server",
      `${r.stuckDownloads} download(s) interrompidos foram recolocados na fila`
    );
  }
  if (r.stuckUploads) {
    emitLog(
      "warn",
      "server",
      `${r.stuckUploads} envio(s) interrompidos foram marcados como falha — confira no Spotify antes de reenviar`
    );
  }
  // Apply the "uploaded, so drop the file" policy to anything published before
  // the policy existed — otherwise that backlog sits on disk forever.
  let freed = 0;
  for (const ep of publishedWithMedia()) {
    const { freedBytes } = releaseEpisodeMedia(ep);
    if (freedBytes > 0) {
      updateEpisodeFields(ep.id, { video_path: "" });
      freed += freedBytes;
    }
  }
  if (freed > 0) {
    emitLog(
      "info",
      "server",
      `${formatBytes(freed)} liberados de episódios já publicados`
    );
  }

  if (r.orphaned.length) finalizeOrphanedJobs(r.orphaned);
  if (r.resumable.length) {
    emitLog("info", "server", `retomando ${r.resumable.length} job(s)`);
    resumeJobs(r.resumable);
  }
}

/**
 * Close SSE streams first: `server.close()` waits on in-flight responses, and an
 * event stream never ends on its own — without this the Electron app would hang
 * on quit instead of shutting the server down.
 */
export async function stopServer() {
  await closeAllCreatorsSessions().catch(() => {});
  for (const res of [...sseClients]) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * Start HTTP API + static UI. port=0 picks a free port (Electron).
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string }>}
 */
export function startServer({ port = PORT, host = "127.0.0.1" } = {}) {
  bootRecovery();
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host}:${p}`;
      console.error(`[spotidraft] ${url}`);
      resolve({ server, port: p, url });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      stopServer()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }
}
