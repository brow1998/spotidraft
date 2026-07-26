import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DOWNLOADS_DIR } from "./paths.js";

const DEFAULT_YT_DLP_CANDIDATES = [
  process.env.YT_DLP,
  process.env.SPOTIDRAFT_RESOURCES &&
    `${process.env.SPOTIDRAFT_RESOURCES}/bin/yt-dlp`,
  process.env.SPOTIDRAFT_RESOURCES &&
    `${process.env.SPOTIDRAFT_RESOURCES}/bin/yt-dlp.exe`,
  ...[
    process.env.HOME &&
      `${process.env.HOME}/.asdf/installs/python/3.12.11/bin/yt-dlp`,
  ].filter(Boolean),
  "yt-dlp",
].filter(Boolean);

export function resolveYtDlp() {
  for (const c of DEFAULT_YT_DLP_CANDIDATES) {
    if (c === "yt-dlp") return c;
    if (fs.existsSync(c)) return c;
  }
  return "yt-dlp";
}

/**
 * Kill a child and anything it spawned. yt-dlp forks ffmpeg for the merge step,
 * so signalling only the parent orphans a process that keeps writing to disk.
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  const hard = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 5000);
  hard.unref?.();
  child.once("close", () => clearTimeout(hard));
}

function abortError(message) {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function run(cmd, args, { quiet = false, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError("cancelado"));

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Line-buffer each stream so onLine sees whole lines even when a chunk
    // splits mid-line (yt-dlp emits progress ~10x/s with --newline).
    const buffers = { stdout: "", stderr: "" };
    const feed = (name, chunk) => {
      if (!onLine) return;
      buffers[name] += chunk;
      const parts = buffers[name].split(/\r?\n/);
      buffers[name] = parts.pop() ?? "";
      for (const line of parts) if (line.length) onLine(line, name);
    };
    const flush = () => {
      if (!onLine) return;
      for (const name of ["stdout", "stderr"]) {
        const rest = buffers[name];
        buffers[name] = "";
        if (rest.length) onLine(rest, name);
      }
    };

    child.stdout.on("data", (d) => {
      const s = String(d);
      stdout += s;
      feed("stdout", s);
      if (!quiet) process.stderr.write(d);
    });
    child.stderr.on("data", (d) => {
      const s = String(d);
      stderr += s;
      feed("stderr", s);
      if (!quiet) process.stderr.write(d);
    });
    child.on("error", (e) => {
      signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      flush();
      if (aborted) return reject(abortError("cancelado pelo usuário"));
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${cmd} exited ${code}: ${(stderr || stdout).slice(-3000)}`
          )
        );
    });
  });
}

const PROGRESS_PREFIX = "SPDPROG";

/** yt-dlp writes "NA" for values it doesn't know yet. */
function numOrNull(raw) {
  if (raw == null || raw === "NA" || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one line of yt-dlp output into a progress signal.
 * Pure — the interesting cases are covered by test/ytdlp-progress.test.js.
 *
 * Returns one of:
 *   { kind: "progress", pct, downloaded, total, speed, eta }
 *   { kind: "destination", ext }   — a new stream started (video, then audio)
 *   { kind: "merge" }              — ffmpeg is muxing, no progress available
 *   null                           — not a progress line
 */
export function parseYtDlpProgressLine(line) {
  if (typeof line !== "string") return null;
  const s = line.trim();
  if (!s) return null;

  if (s.startsWith(PROGRESS_PREFIX)) {
    const [, downloadedRaw, totalRaw, estimateRaw, speedRaw, etaRaw] =
      s.split(/\s+/);
    const downloaded = numOrNull(downloadedRaw);
    const total = numOrNull(totalRaw) ?? numOrNull(estimateRaw);
    const pct =
      downloaded != null && total ? Math.min(100, (downloaded / total) * 100) : null;
    return {
      kind: "progress",
      pct,
      downloaded,
      total,
      speed: numOrNull(speedRaw),
      eta: numOrNull(etaRaw),
    };
  }

  const dest = s.match(/^\[download\]\s+Destination:\s+(.+)$/i);
  if (dest) {
    const ext = path.extname(dest[1]).replace(/^\./, "").toLowerCase() || null;
    return { kind: "destination", ext };
  }

  if (/^\[Merger\]/i.test(s)) return { kind: "merge" };

  return null;
}

/**
 * Turn the raw per-stream signals into a single monotonic view.
 *
 * The default selector is `bv*+ba/b`, so yt-dlp downloads video, then audio,
 * then merges — the raw percentage runs 0→100 twice. Track which stream we are
 * on and fold both into one overall value, and surface the merge explicitly:
 * ffmpeg can take a minute on a long file while emitting nothing at all.
 */
export function createProgressTracker({ audioOnly = false } = {}) {
  const streams = audioOnly ? 1 : 2;
  let streamIndex = -1;
  let merging = false;

  return function track(line) {
    const sig = parseYtDlpProgressLine(line);
    if (!sig) return null;

    if (sig.kind === "destination") {
      if (streamIndex < streams - 1) streamIndex += 1;
      return null;
    }
    if (sig.kind === "merge") {
      merging = true;
      return { stage: "merge", pct: null, overallPct: null, speed: null, eta: null };
    }
    if (merging) return null;

    const idx = Math.max(0, streamIndex);
    const stage = audioOnly || idx === 0 ? (audioOnly ? "audio" : "video") : "audio";
    const overallPct =
      sig.pct == null ? null : ((idx + sig.pct / 100) / streams) * 100;
    return {
      stage,
      pct: sig.pct,
      overallPct,
      speed: sig.speed,
      eta: sig.eta,
      downloaded: sig.downloaded,
      total: sig.total,
    };
  };
}

/**
 * Archive path for a single-video download.
 *
 * yt-dlp appends to the archive with no locking, so two processes sharing one
 * file can interleave writes. One file per video removes the contention while
 * keeping the "already downloaded, skip it" behaviour on re-runs.
 */
export function archiveForVideo(dir, videoId) {
  const safe = String(videoId).replace(/[^\w-]/g, "_");
  return path.join(dir, `.archive-${safe}.txt`);
}

/** Derive a stable folder name from video / playlist / channel URL. */
export function sourceDirName(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    const h = createHash("sha1").update(url).digest("hex").slice(0, 10);
    return `url-${h}`;
  }
  const list = u.searchParams.get("list");
  if (list) return `playlist-${list}`;
  const v = u.searchParams.get("v");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel" && parts[1]) return `channel-${parts[1]}`;
  if (parts[0] === "c" && parts[1]) return `channel-${parts[1]}`;
  if (parts[0] === "user" && parts[1]) return `channel-${parts[1]}`;
  if (parts[0]?.startsWith("@")) return `channel-${parts[0].slice(1)}`;
  if (v) return `video-${v}`;
  if (parts[0] === "shorts" && parts[1]) return `video-${parts[1]}`;
  if (parts[0] === "embed" && parts[1]) return `video-${parts[1]}`;
  if (parts[0] === "live" && parts[1]) return `video-${parts[1]}`;
  if (u.hostname.includes("youtu.be") && parts[0]) return `video-${parts[0]}`;
  const h = createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `url-${h}`;
}

function formatSelector({ audioOnly = false, maxHeight } = {}) {
  if (audioOnly) return "ba/b";
  if (maxHeight) return `bv*[height<=${maxHeight}]+ba/b`;
  return "bv*+ba/b";
}

/**
 * Prefer native/original metadata over auto-translated (EN) titles.
 * yt-dlp accepts `pt` (not `pt-BR`) — see youtube:_SUPPORTED_LANG_CODES.
 */
export function normalizeYtLang(raw) {
  const v = String(raw || "pt").trim();
  if (/^pt([-_]br)?$/i.test(v)) return "pt";
  if (/^en([-_](us|gb|in))?$/i.test(v)) return "en";
  return v;
}

function ytNativeLangArgs() {
  const lang = normalizeYtLang(process.env.YT_LANG || "pt");
  const accept =
    lang === "pt"
      ? "pt-BR,pt;q=1.0,en;q=0.1"
      : `${lang};q=1.0,en;q=0.1`;
  return [
    // Apply to both watch pages and channel/tab listings.
    "--extractor-args",
    `youtube:lang=${lang};youtubetab:lang=${lang}`,
    "--add-header",
    `Accept-Language:${accept}`,
  ];
}

function pickThumb(j) {
  const thumbs = Array.isArray(j?.thumbnails) ? j.thumbnails : [];
  const last = thumbs[thumbs.length - 1];
  if (last?.url) return last.url;
  if (j?.id && !String(j.id).startsWith("PL")) {
    return `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`;
  }
  return null;
}

/**
 * List videos for a YouTube URL (no download).
 * flat=true: rápido p/ Home (sem description). flat=false: traz description (Import).
 */
export async function listYoutubeVideos({
  url,
  limit,
  offset = 0,
  flat = false,
  ytDlpPath,
} = {}) {
  if (!url) throw new Error("url obrigatória");
  const bin = ytDlpPath || resolveYtDlp();
  // Options before URL — extractor-args must apply to youtube:tab listings.
  const args = [
    ...ytNativeLangArgs(),
    ...(flat ? ["--flat-playlist"] : []),
    "--skip-download",
    "--print",
    flat
      ? "%(.{id,title,duration,url,webpage_url,thumbnails,playlist_count,_type})j"
      : "%(.{id,title,duration,description,url,webpage_url,thumbnails})j",
    "--ignore-errors",
    "--no-abort-on-error",
    "--js-runtimes",
    "node",
  ];
  const start = Math.max(1, Number(offset) + 1 || 1);
  const lim = limit != null && Number(limit) > 0 ? Number(limit) : null;
  if (start > 1) args.push("--playlist-start", String(start));
  if (lim != null) args.push("--playlist-end", String(start + lim - 1));
  args.push(url);
  const { stdout } = await run(bin, args, { quiet: true });
  const videos = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t);
      if (!j.id) continue;
      videos.push({
        id: j.id,
        title: j.title || j.id,
        duration: j.duration ?? null,
        description: flat ? "" : j.description || "",
        url: j.webpage_url || j.url || `https://www.youtube.com/watch?v=${j.id}`,
        thumb: pickThumb(j),
        count: j.playlist_count ?? null,
      });
    } catch {
      /* skip */
    }
  }
  return videos;
}

/** Full metadata for one video (description on expand). */
export async function fetchYoutubeVideoMeta({ id, url, ytDlpPath } = {}) {
  const watch =
    url || (id ? `https://www.youtube.com/watch?v=${id}` : null);
  if (!watch) throw new Error("id ou url do vídeo obrigatório");
  const bin = ytDlpPath || resolveYtDlp();
  const args = [
    ...ytNativeLangArgs(),
    "--skip-download",
    "--no-playlist",
    "--ignore-errors",
    "--no-abort-on-error",
    "--print",
    "%(.{id,title,duration,description,url,webpage_url,thumbnails})j",
    "--js-runtimes",
    "node",
    watch,
  ];
  try {
    const { stdout } = await run(bin, args, { quiet: true });
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const j = JSON.parse(t);
        if (!j.id) continue;
        return {
          id: j.id,
          title: j.title || j.id,
          duration: j.duration ?? null,
          description: j.description || "",
          url: j.webpage_url || j.url || watch,
          thumb: pickThumb(j),
        };
      } catch {
        /* skip */
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    if (/membros|members|members-only|exclusiv/i.test(msg)) {
      return {
        id: id || null,
        title: id || watch,
        duration: null,
        description:
          "Este vídeo é exclusivo para membros do canal — descrição indisponível.",
        url: watch,
        thumb: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
      };
    }
    throw e;
  }
  throw new Error("vídeo não encontrado");
}

/** Normalize @handle / channel URL into canonical + tab URLs. */
export function normalizeChannelInput(raw) {
  if (!raw || typeof raw !== "string") throw new Error("url do canal obrigatória");
  let input = raw.trim();
  if (input.startsWith("@")) {
    input = `https://www.youtube.com/${input}`;
  } else if (!/^https?:\/\//i.test(input) && input.includes("youtube.com")) {
    input = `https://${input.replace(/^\/\//, "")}`;
  } else if (!/^https?:\/\//i.test(input) && /^[\w.-]+$/.test(input)) {
    input = `https://www.youtube.com/@${input.replace(/^@/, "")}`;
  }

  let u;
  try {
    u = new URL(input);
  } catch {
    throw new Error("URL de canal inválida");
  }
  if (!/youtube\.com|youtu\.be/i.test(u.hostname)) {
    throw new Error("Informe um link de canal do YouTube");
  }

  const parts = u.pathname.split("/").filter(Boolean);
  let handle = null;
  let channelId = null;
  if (parts[0]?.startsWith("@")) {
    handle = parts[0];
  } else if (parts[0] === "channel" && parts[1]) {
    channelId = parts[1];
  } else if ((parts[0] === "c" || parts[0] === "user") && parts[1]) {
    handle = parts[1];
  } else {
    throw new Error("Não reconheci o canal — use @handle ou /channel/…");
  }

  const base = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}`;

  return {
    canonicalUrl: base,
    videosUrl: `${base}/videos`,
    playlistsUrl: `${base}/playlists`,
    handle: handle || channelId,
  };
}

async function listYoutubeFlat({ url, limit, offset = 0, ytDlpPath } = {}) {
  const rows = await listYoutubeVideos({
    url,
    limit,
    offset,
    flat: true,
    ytDlpPath,
  });
  // Re-shape to raw-ish for channel mapping (id/title already normalized).
  return rows.map((v) => ({
    id: v.id,
    title: v.title,
    duration: v.duration,
    url: v.url,
    webpage_url: v.url,
    thumbnails: v.thumb ? [{ url: v.thumb }] : [],
    playlist_count: v.count ?? null,
    _type: "url",
  }));
}

/**
 * Channel home: metadata + recent videos + playlists (flat / fast).
 */
export async function fetchYoutubeChannel({
  url,
  videoLimit = 12,
  videoOffset = 0,
  playlistLimit = 24,
  videosOnly = false,
  ytDlpPath,
} = {}) {
  const norm = normalizeChannelInput(url);
  const bin = ytDlpPath || resolveYtDlp();
  const offset = Math.max(0, Number(videoOffset) || 0);
  const limit = Math.max(1, Number(videoLimit) || 12);

  if (videosOnly) {
    const videoRows = await listYoutubeFlat({
      url: norm.videosUrl,
      limit,
      offset,
      ytDlpPath: bin,
    });
    const videos = videoRows
      .filter((j) => j.id && !String(j.id).startsWith("PL"))
      .map((j) => ({
        id: j.id,
        title: j.title || j.id,
        duration: j.duration ?? null,
        description: "",
        url: j.webpage_url || j.url || `https://www.youtube.com/watch?v=${j.id}`,
        thumb: pickThumb(j) || `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`,
      }));
    return {
      videos,
      hasMore: videos.length >= limit,
      videoOffset: offset,
      videoLimit: limit,
      urls: norm,
    };
  }

  const metaArgs = [
    ...ytNativeLangArgs(),
    "-J",
    "--flat-playlist",
    "--playlist-end",
    "1",
    "--js-runtimes",
    "node",
    norm.canonicalUrl,
  ];
  const [{ stdout: metaRaw }, videoRows, playlistRows] = await Promise.all([
    run(bin, metaArgs, { quiet: true }),
    listYoutubeFlat({
      url: norm.videosUrl,
      limit,
      offset,
      ytDlpPath: bin,
    }),
    listYoutubeFlat({
      url: norm.playlistsUrl,
      limit: playlistLimit,
      ytDlpPath: bin,
    }),
  ]);

  let meta = {};
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    meta = {};
  }

  const avatar =
    meta.thumbnails?.find((t) => t.id === "avatar_uncropped")?.url ||
    meta.thumbnails?.[meta.thumbnails.length - 1]?.url ||
    null;

  const channel = {
    id: meta.channel_id || meta.id || String(norm.handle),
    handle: meta.uploader_id
      ? meta.uploader_id.startsWith("@")
        ? meta.uploader_id
        : `@${meta.uploader_id}`
      : norm.handle?.startsWith("@")
        ? norm.handle
        : norm.handle
          ? `@${norm.handle}`
          : null,
    title: meta.channel || meta.title || meta.uploader || String(norm.handle),
    url: meta.channel_url || norm.canonicalUrl,
    thumb: avatar,
    followers: meta.channel_follower_count ?? null,
  };

  const videos = videoRows
    .filter((j) => j.id && !String(j.id).startsWith("PL"))
    .map((j) => ({
      id: j.id,
      title: j.title || j.id,
      duration: j.duration ?? null,
      description: "",
      url: j.webpage_url || j.url || `https://www.youtube.com/watch?v=${j.id}`,
      thumb: pickThumb(j) || `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`,
    }));

  const playlists = playlistRows
    .filter((j) => j.id && String(j.id).startsWith("PL"))
    .map((j) => ({
      id: j.id,
      title: j.title || j.id,
      url:
        j.webpage_url ||
        j.url ||
        `https://www.youtube.com/playlist?list=${j.id}`,
      count: j.playlist_count ?? null,
      thumb: pickThumb(j),
    }));

  return {
    channel,
    videos,
    playlists,
    hasMore: videos.length >= limit,
    videoOffset: offset,
    videoLimit: limit,
    urls: norm,
  };
}

/**
 * Download YouTube video / playlist / channel via yt-dlp.
 */
export async function downloadYoutube({
  url,
  outDir,
  limit,
  skipDownload = false,
  ytDlpPath,
  audioOnly = false,
  withThumb = true,
  withDescription = true,
  maxHeight,
  videoIds,
  onProgress,
  onLog,
  signal,
} = {}) {
  if (!url) throw new Error("url obrigatória");
  const dir = outDir || path.join(DOWNLOADS_DIR, sourceDirName(url));
  fs.mkdirSync(dir, { recursive: true });

  const bin = ytDlpPath || resolveYtDlp();
  const archive = path.join(dir, "archive.txt");
  const outTpl = path.join(
    dir,
    "%(playlist_index|)03d%(playlist_index& - |)s%(title).180B [%(id)s].%(ext)s"
  );

  if (Array.isArray(videoIds) && videoIds.length) {
    for (const id of videoIds) {
      const watch = `https://www.youtube.com/watch?v=${id}`;
      await downloadOne({
        url: watch,
        dir,
        // Per-video archive: each call here handles exactly one id, so a shared
        // archive.txt buys nothing but makes two concurrent downloads write to
        // the same file. Splitting it is what allows parallel downloads at all.
        archive: archiveForVideo(dir, id),
        outTpl,
        bin,
        skipDownload,
        audioOnly,
        withThumb,
        withDescription,
        maxHeight,
        signal,
        onProgress: onProgress && ((p) => onProgress({ ...p, id })),
        onLog: onLog && ((line, stream) => onLog(line, stream, id)),
      });
    }
    const files = listDownloadedMedia(dir);
    return { dir, files, archive };
  }

  await downloadOne({
    url,
    dir,
    archive,
    outTpl,
    bin,
    skipDownload,
    audioOnly,
    withThumb,
    withDescription,
    maxHeight,
    limit,
    signal,
    onProgress,
    onLog,
  });

  const files = listDownloadedMedia(dir);
  console.error(`[ytdlp] ${files.length} mídia(s) em ${dir}`);
  return { dir, files, archive };
}

async function downloadOne({
  url,
  dir,
  archive,
  outTpl,
  bin,
  skipDownload,
  audioOnly,
  withThumb,
  withDescription,
  maxHeight,
  limit,
  signal,
  onProgress,
  onLog,
}) {
  const mergeFmt = audioOnly ? "m4a" : "mp4";
  const args = [
    ...ytNativeLangArgs(),
    url,
    "-f",
    formatSelector({ audioOnly, maxHeight }),
    "--merge-output-format",
    mergeFmt,
    "--newline",
    "--no-color",
    "--progress-template",
    `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
    "--write-info-json",
    "--no-write-playlist-metafiles",
    "--download-archive",
    archive,
    "--no-overwrites",
    "--ignore-errors",
    "--no-abort-on-error",
    "--js-runtimes",
    "node",
    "-o",
    outTpl,
  ];

  if (withThumb && !audioOnly) {
    args.push("--write-thumbnail", "--convert-thumbnails", "jpg");
  }
  if (withDescription) args.push("--write-description");
  if (limit != null && Number(limit) > 0) {
    args.push("--playlist-end", String(Number(limit)));
  }

  if (skipDownload) {
    console.error(`[ytdlp] skip-download — usando arquivos em ${dir}`);
    return;
  }
  console.error(`[ytdlp] ${bin}`);
  console.error(`[ytdlp] → ${dir}`);

  const track = createProgressTracker({ audioOnly });
  const onLine = (onProgress || onLog)
    ? (line, stream) => {
        if (onProgress) {
          const p = track(line);
          if (p) onProgress(p);
        }
        // Progress lines are noise in a log panel — they arrive ~10x/s.
        if (onLog && !line.trimStart().startsWith(PROGRESS_PREFIX)) {
          onLog(line, stream);
        }
      }
    : undefined;

  await run(bin, args, { onLine, signal });
}

export function listDownloadedMp4s(dir) {
  return listDownloadedMedia(dir).filter((f) => f.endsWith(".mp4"));
}

export function listDownloadedMedia(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (f) =>
        (f.endsWith(".mp4") || f.endsWith(".m4a") || f.endsWith(".webm")) &&
        !f.includes(".f") &&
        !f.includes(".temp")
    )
    .sort()
    .map((f) => path.join(dir, f));
}
