import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cancelJob,
  claimNextPending,
  createJob,
  getEpisode,
  getJob,
  isCancelRequested,
  listEpisodes,
  listJobs,
  markCancelled,
  markFailed,
  markPublished,
  requestCancelEpisode,
  requeueFailed,
  updateEpisodeFields,
  updateJob,
  upsertEpisode,
} from "../db.js";
import {
  downloadYoutube,
  listYoutubeVideos,
  fetchYoutubeChannel,
  fetchYoutubeVideoMeta,
  sourceDirName,
} from "../download-ytdlp.js";
import { episodeFromYtdlpMp4 } from "../enqueue-helpers.js";
import { importFromCurl, loadCookies, loadConfig, saveConfig } from "../session.js";
import { publishViaCreators } from "../adapters/creators-playwright.js";
import {
  deleteCreatorsEpisode,
  fetchCreatorsCatalog,
  isValidShowName,
} from "../adapters/creators-manage.js";
import { DOWNLOADS_DIR, DATA_DIR, WEB_DIST } from "../paths.js";

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

let workerRunning = false;
const runningImportJobs = new Set();

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

function enrichEpisodeRow(r) {
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

async function drainWorker({ headless = true } = {}) {
  if (workerRunning) return { started: false, reason: "already_running" };
  workerRunning = true;
  try {
    for (;;) {
      const job = claimNextPending();
      if (!job) break;
      if (isCancelRequested(job.id)) {
        markCancelled(job.id, "cancelado pelo usuário");
        continue;
      }
      console.error(`[api-worker] uploading ${job.id}`);
      try {
        await publishViaCreators(job, { headless });
        if (isCancelRequested(job.id)) {
          markCancelled(job.id, "cancelado após upload");
        } else {
          markPublished(job.id);
          console.error(`[api-worker] ok ${job.id}`);
        }
      } catch (e) {
        if (isCancelRequested(job.id)) {
          markCancelled(job.id, e.message || "cancelado");
        } else {
          markFailed(job.id, e.message || e);
          console.error(`[api-worker] FAIL ${job.id}:`, e.message || e);
        }
      }
    }
    return { started: true, done: true };
  } finally {
    workerRunning = false;
  }
}

function kickWorker(headless = true) {
  setImmediate(() => {
    drainWorker({ headless }).catch((e) => console.error("[api-worker]", e));
  });
}

async function runImportJob(jobId) {
  if (runningImportJobs.has(jobId)) return;
  runningImportJobs.add(jobId);
  try {
    const job = getJob(jobId);
    if (!job || job.status === "cancelled") return;
    const opts = job.options || {};
    const videoIds = opts.videoIds || [];
    const total = videoIds.length;
    updateJob(jobId, {
      status: "running",
      progress: { phase: "downloading", current: 0, total, message: "baixando…" },
    });

    const outDir = path.join(DOWNLOADS_DIR, sourceDirName(job.url));
    let done = 0;

    for (const id of videoIds) {
      const live = getJob(jobId);
      if (!live || live.status === "cancelled") break;
      if (isCancelRequested(id)) {
        markCancelled(id, "cancelado pelo usuário");
        done += 1;
        continue;
      }

      updateEpisodeFields(id, { status: "downloading" });
      updateJob(jobId, {
        status: "running",
        progress: {
          phase: "downloading",
          current: done,
          total,
          message: `baixando ${id}…`,
        },
      });

      try {
        const { files } = await downloadYoutube({
          url: job.url,
          outDir,
          videoIds: [id],
          audioOnly: Boolean(opts.audioOnly),
          withThumb: opts.withThumb !== false,
          withDescription: opts.withDescription !== false,
          maxHeight: opts.maxHeight || null,
        });

        if (isCancelRequested(id) || getJob(jobId)?.status === "cancelled") {
          markCancelled(id, "cancelado pelo usuário");
          done += 1;
          continue;
        }

        const match =
          files.find((f) => f.includes(`[${id}]`)) || files[files.length - 1];
        if (!match) {
          markFailed(id, "arquivo não encontrado após download");
        } else {
          const pkg = episodeFromYtdlpMp4(match);
          updateEpisodeFields(id, {
            title: pkg.title,
            description: opts.withDescription === false ? "" : pkg.description,
            video_path: pkg.video_path,
            image_path: opts.withThumb === false ? null : pkg.image_path,
            meta_path: pkg.meta_path,
            status: "pending",
          });
        }
      } catch (e) {
        if (isCancelRequested(id)) markCancelled(id, e.message);
        else markFailed(id, e.message || e);
      }

      done += 1;
      updateJob(jobId, {
        progress: {
          phase: "downloading",
          current: done,
          total,
          message: `${done}/${total} baixados`,
        },
      });
    }

    if (getJob(jobId)?.status === "cancelled") return;

    updateJob(jobId, {
      status: "uploading",
      progress: {
        phase: "uploading",
        current: done,
        total,
        message: "enviando drafts…",
      },
    });

    await drainWorker({ headless: opts.headless !== false });

    const still = getJob(jobId);
    if (still?.status !== "cancelled") {
      updateJob(jobId, {
        status: "completed",
        progress: {
          phase: "done",
          current: total,
          total,
          message: "concluído",
        },
      });
    }
  } catch (e) {
    console.error("[import-job]", e);
    updateJob(jobId, {
      status: "failed",
      error: e.message || String(e),
      progress: { phase: "failed", message: e.message || String(e) },
    });
  } finally {
    runningImportJobs.delete(jobId);
  }
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
    return json(res, 200, { ...result, session: sessionStatus() });
  }

  if (pathname === "/api/config" && req.method === "GET") {
    const cfg = loadConfig() || {};
    return json(res, 200, {
      showId: cfg.showId || null,
      episodesUrl: cfg.episodesUrl || null,
      workerRunning,
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
    const data = await fetchYoutubeChannel({
      url: String(body.url),
      videoLimit: body.videoLimit || 12,
      videoOffset: body.videoOffset || 0,
      playlistLimit: body.playlistLimit || 24,
      videosOnly: Boolean(body.videosOnly),
    });
    return json(res, 200, data);
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
    const rows = listEpisodes().map((r) => enrichEpisodeRow(r));
    return json(res, 200, {
      episodes: rows,
      workerRunning,
      jobs: listJobs(20),
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
    requeueFailed(body.id || undefined);
    kickWorker(true);
    return json(res, 200, { ok: true });
  }

  if (pathname === "/api/queue/cancel" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.id) return json(res, 400, { error: "id obrigatório" });
    return json(res, 200, requestCancelEpisode(String(body.id)));
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
    if (workerRunning) return json(res, 200, { started: false, workerRunning });
    kickWorker(true);
    return json(res, 200, { started: true });
  }

  return json(res, 404, { error: "not found" });
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

/**
 * Start HTTP API + static UI. port=0 picks a free port (Electron).
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string }>}
 */
export function startServer({ port = PORT, host = "127.0.0.1" } = {}) {
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
}
