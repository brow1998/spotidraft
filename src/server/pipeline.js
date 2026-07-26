import fs from "node:fs";
import path from "node:path";
import {
  claimNextPending,
  getEpisode,
  getJob,
  isCancelRequested,
  jobEpisodeCounts,
  listEpisodes,
  markCancelled,
  markFailed,
  markPublished,
  updateEpisodeFields,
  updateJob,
} from "../db.js";
import { downloadYoutube, sourceDirName } from "../download-ytdlp.js";
import { episodeFromYtdlpMp4 } from "../enqueue-helpers.js";
import {
  classifyCreatorsError,
  openCreatorsSession,
} from "../adapters/creators-session.js";
import { DOWNLOADS_DIR } from "../paths.js";
import { formatBytes, releaseEpisodeMedia } from "../cleanup.js";
import { createThrottle, emitEvent, emitLog } from "./events.js";
import { computeJobProgress, finalJobStatus } from "./job-progress.js";

/**
 * The import pipeline: a download producer and an upload consumer that run
 * concurrently. Episode N uploads while episode N+1 is still downloading.
 *
 * Downloads stay serial *within* a job on purpose: yt-dlp shares one
 * archive.txt per output dir, and concurrent processes writing it race.
 */

/** The single uploader. Non-null means one uploadLoop is live — this is the mutex. */
let uploaderPromise = null;
/** Number of live download loops, across all jobs. */
let producers = 0;
/** Sleepers to wake as soon as work appears (the uploader and any job drain watcher). */
const waiters = new Set();
/** Set when cookies expire: keeps the uploader from burning the rest of a batch. */
let sessionBlocked = false;

const runningImportJobs = new Set();
const downloadState = new Map(); // jobId -> { current }
const uploadState = new Map(); // jobId -> { current }
const progressThrottle = createThrottle(400);
const uploadThrottle = createThrottle(1500);

export function isUploaderRunning() {
  return uploaderPromise !== null;
}

export function isSessionBlocked() {
  return sessionBlocked;
}

/** Called when fresh cookies arrive, so a blocked batch can pick back up. */
export function clearSessionBlock({ headless = true } = {}) {
  if (!sessionBlocked) return false;
  sessionBlocked = false;
  emitLog("info", "server", "sessão renovada — retomando envios");
  ensureUploader({ headless });
  return true;
}

function notifyPendingWork() {
  for (const w of [...waiters]) w();
}

function sleepOrWake(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    waiters.add(done);
    function done() {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    }
  });
}

/**
 * Track the downloads in flight for a job.
 *
 * With concurrent lanes there is no single "current" download any more. The
 * progress card still shows one — the least-advanced, since that's the one the
 * batch is actually waiting on — plus how many are running.
 */
function trackDownload(jobId, id, patch) {
  const active = downloadState.get(jobId)?.active || new Map();
  active.set(id, { id, ...patch });
  downloadState.set(jobId, { active, ...summarizeDownloads(active) });
}

function untrackDownload(jobId, id) {
  const active = downloadState.get(jobId)?.active || new Map();
  active.delete(id);
  downloadState.set(jobId, { active, ...summarizeDownloads(active) });
}

/**
 * Reduce the in-flight downloads to what the progress card shows.
 *
 * Picks the least-advanced one: that's the download the batch is actually
 * waiting on, so it's the honest thing to display. Exported for testing.
 */
/** Upload steps in the order they happen, for ranking concurrent lanes. */
const UPLOAD_STEP_ORDER = [
  "start",
  "dashboard",
  "new-episode",
  "uploading",
  "processing",
  "title",
  "description",
  "thumb",
  "preview",
  "save-draft",
  "publish",
  "done",
];

function trackUpload(jobId, id, patch) {
  const active = uploadState.get(jobId)?.active || new Map();
  active.set(id, { id, ...patch });
  uploadState.set(jobId, { active, ...summarizeUploads(active) });
}

function untrackUpload(jobId, id) {
  const active = uploadState.get(jobId)?.active || new Map();
  active.delete(id);
  uploadState.set(jobId, { active, ...summarizeUploads(active) });
}

/**
 * Same idea as summarizeDownloads: with several lanes there is no single
 * "current" upload, so show the least-advanced one — that's what the batch is
 * waiting on. Exported for testing.
 */
export function summarizeUploads(active) {
  const entries = active instanceof Map ? [...active.values()] : active || [];
  if (!entries.length) return { current: null, activeCount: 0 };
  const rank = (u) => {
    const i = UPLOAD_STEP_ORDER.indexOf(u.step);
    return i === -1 ? UPLOAD_STEP_ORDER.length : i;
  };
  let earliest = entries[0];
  for (const u of entries) if (rank(u) < rank(earliest)) earliest = u;
  return { current: earliest, activeCount: entries.length };
}

export function summarizeDownloads(active) {
  const entries = active instanceof Map ? [...active.values()] : active || [];
  if (!entries.length) return { current: null, activeCount: 0 };
  let slowest = null;
  for (const d of entries) {
    const pct = d.overallPct ?? -1;
    if (!slowest || pct < (slowest.overallPct ?? -1)) slowest = d;
  }
  return { current: slowest, activeCount: entries.length };
}

function publishProgress(jobId, { status } = {}) {
  const counts = jobEpisodeCounts(jobId);
  const progress = computeJobProgress(
    counts,
    downloadState.get(jobId) || {},
    uploadState.get(jobId) || {}
  );
  emitEvent("job.progress", { jobId, status, progress });
  return progress;
}

/**
 * Persist progress. Percentages deliberately do NOT go through here — node:sqlite
 * writes synchronously on the same thread that drives Playwright and yt-dlp, and
 * yt-dlp emits progress ~10x/s. The DB sees transitions; SSE sees percentages.
 */
function persistProgress(jobId, { status, error } = {}) {
  const progress = publishProgress(jobId, { status });
  updateJob(jobId, { status, progress, error });
  return progress;
}

function episodeStatus(id, status, extra = {}) {
  emitEvent("episode.status", { id, status, ...extra });
}

function listJobEpisodes(jobId) {
  return listEpisodes().filter((e) => e.job_id === jobId);
}

// ---------------------------------------------------------------- uploader

const DEFAULT_UPLOAD_LANES = 2;
const MAX_UPLOAD_LANES = 5;

/**
 * How many episodes to upload at once.
 *
 * Each lane is its own Chromium profile sharing the injected cookies. Measured
 * against the real Creators site with 3 lanes: 26s wall clock versus ~76s
 * serial, with per-lane times of 24/26/26s — Spotify does not serialize per
 * account. Capped at 5: that's the highest concurrent-session count actually
 * verified, and each lane costs a full browser in RAM.
 */
export function uploadConcurrency(opts = {}) {
  const raw =
    opts.uploadLanes ?? process.env.SPOTIDRAFT_UPLOAD_LANES ?? DEFAULT_UPLOAD_LANES;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_UPLOAD_LANES);
}

export function ensureUploader({ headless = true } = {}) {
  if (uploaderPromise) return uploaderPromise;

  const lanes = uploadConcurrency();
  uploaderPromise = Promise.all(
    Array.from({ length: lanes }, (_, i) =>
      uploadLoop({ headless, lane: i + 1 }).catch((e) => {
        console.error(`[uploader:${i + 1}]`, e);
        emitLog("error", "server", `faixa de envio ${i + 1} parou: ${e.message || e}`);
      })
    )
  ).finally(() => {
    uploaderPromise = null;
    emitEvent("worker", { running: false });
  });

  emitEvent("worker", { running: true, lanes });
  return uploaderPromise;
}

/** Reopen the browser periodically — the Creators SPA leaks state across episodes. */
const MAX_EPISODES_PER_SESSION = 20;
const MAX_REOPENS = 2;

async function uploadLoop({ headless, lane = 1 }) {
  let session = null;
  let reopens = 0;

  const closeSession = async () => {
    if (!session) return;
    const s = session;
    session = null;
    await s.close().catch(() => {});
  };

  try {
    for (;;) {
      if (sessionBlocked) break;

      const ep = claimNextPending();
      if (!ep) {
        // Nothing pending. If no downloader is alive either, we are truly drained.
        if (producers === 0) break;
        await sleepOrWake(1500);
        continue;
      }

      if (isCancelRequested(ep.id)) {
        markCancelled(ep.id, "cancelado pelo usuário");
        episodeStatus(ep.id, "cancelled", { jobId: ep.job_id });
        if (ep.job_id) publishProgress(ep.job_id);
        continue;
      }

      episodeStatus(ep.id, "uploading", { jobId: ep.job_id, title: ep.title });
      trackUpload(ep.job_id, ep.id, { title: ep.title, step: "start", lane });
      if (ep.job_id) publishProgress(ep.job_id);

      try {
        if (session && session.publishedCount() >= MAX_EPISODES_PER_SESSION) {
          emitLog("info", "creators", "reciclando o navegador após 20 episódios");
          await closeSession();
        }
        if (session && !session.isAlive()) await closeSession();
        if (!session) {
          session = await openCreatorsSession({
            headless,
            lane,
            onLog: (level, source, line) =>
              emitLog(level, source, line, { jobId: ep.job_id }),
          });
        }

        await session.publish(ep, {
          onStep: (step, detail = {}) => {
            trackUpload(ep.job_id, ep.id, { title: ep.title, step, lane, ...detail });
            // "processing" and "preview" tick every 2s while waiting; throttle
            // them the same way download progress is throttled.
            const ticking = step === "processing" || step === "preview";
            if (!ticking || uploadThrottle(ep.id)) {
              emitEvent("episode.upload", {
                id: ep.id,
                jobId: ep.job_id,
                step,
                ...detail,
              });
              if (ep.job_id) publishProgress(ep.job_id);
            }
          },
        });

        if (isCancelRequested(ep.id)) {
          markCancelled(ep.id, "cancelado após upload");
          episodeStatus(ep.id, "cancelled", { jobId: ep.job_id });
        } else {
          markPublished(ep.id);
          episodeStatus(ep.id, "published", { jobId: ep.job_id, title: ep.title });
          emitLog("info", "creators", `rascunho criado: ${ep.title}`, {
            jobId: ep.job_id,
            episodeId: ep.id,
          });

          // The draft exists on Spotify now, so the local video is dead weight —
          // and at a few hundred MB to a few GB each it adds up fast.
          const { freedBytes } = releaseEpisodeMedia(ep);
          if (freedBytes > 0) {
            updateEpisodeFields(ep.id, { video_path: "" });
            emitLog(
              "info",
              "server",
              `espaço liberado: ${formatBytes(freedBytes)} (${ep.title})`,
              { jobId: ep.job_id, episodeId: ep.id }
            );
          }
        }
      } catch (e) {
        const kind = classifyCreatorsError(e);
        const msg = e.message || String(e);

        if (isCancelRequested(ep.id)) {
          markCancelled(ep.id, msg);
          episodeStatus(ep.id, "cancelled", { jobId: ep.job_id });
        } else if (kind === "crash" && reopens < MAX_REOPENS) {
          // Put it back and try again with a fresh browser.
          reopens += 1;
          await closeSession();
          updateEpisodeFields(ep.id, { status: "pending", error: null });
          episodeStatus(ep.id, "pending", { jobId: ep.job_id });
          emitLog("warn", "creators", `navegador caiu — reabrindo (${reopens}/${MAX_REOPENS})`, {
            jobId: ep.job_id,
          });
          continue;
        } else if (kind === "session") {
          // Every remaining episode would fail the same way after a 60s wait.
          sessionBlocked = true;
          markFailed(ep.id, msg);
          episodeStatus(ep.id, "failed", { jobId: ep.job_id, error: msg });
          emitEvent("session.expired", {
            message: "Sessão do Spotify expirou — cole um novo cURL para continuar.",
          });
          emitLog("error", "creators", `sessão expirada: ${msg}`, { jobId: ep.job_id });
          await closeSession();
          break;
        } else {
          markFailed(ep.id, msg);
          episodeStatus(ep.id, "failed", { jobId: ep.job_id, error: msg });
          emitLog("error", "creators", `falhou "${ep.title}": ${msg}`, {
            jobId: ep.job_id,
            episodeId: ep.id,
          });
        }
      } finally {
        untrackUpload(ep.job_id, ep.id);
        if (ep.job_id) publishProgress(ep.job_id);
      }
    }
  } finally {
    await closeSession();
  }
}

// ---------------------------------------------------------------- downloader

/** Default lanes. Kept low on purpose — see DOWNLOAD_CONCURRENCY below. */
const DEFAULT_LANES = 2;
const MAX_LANES = 4;

/**
 * How many videos to download at once.
 *
 * Not unbounded: hammering YouTube from one IP is how you earn the HTTP 403 the
 * extractor returns under load, and every lane also means another ffmpeg merge
 * competing for CPU at the end. Two is a safe default; SPOTIDRAFT_DOWNLOAD_LANES
 * raises it for people on fat pipes.
 */
export function downloadConcurrency(opts = {}) {
  const raw =
    opts.downloadLanes ?? process.env.SPOTIDRAFT_DOWNLOAD_LANES ?? DEFAULT_LANES;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_LANES);
}

async function downloadEpisode({ id, jobId, job, opts, outDir, useHeadless }) {
  if (isCancelRequested(id)) {
    markCancelled(id, "cancelado pelo usuário");
    episodeStatus(id, "cancelled", { jobId });
    publishProgress(jobId);
    return;
  }

  // A job can be re-run to retry one failed episode (see requeue). Don't drag
  // the ones that already finished back through the pipeline.
  const existing = getEpisode(id);
  if (existing && ["published", "cancelled"].includes(existing.status)) return;
  if (
    existing &&
    ["pending", "uploading"].includes(existing.status) &&
    existing.video_path &&
    fs.existsSync(existing.video_path)
  ) {
    // Already downloaded and waiting on (or in) upload.
    notifyPendingWork();
    return;
  }

  updateEpisodeFields(id, { status: "downloading" });
  episodeStatus(id, "downloading", { jobId });
  trackDownload(jobId, id, { stage: "video", pct: null });
  publishProgress(jobId);

  // Cancel has to reach the yt-dlp process itself, not just the loop: a large
  // download would otherwise keep running for minutes after the click.
  const ac = new AbortController();
  const watchdog = setInterval(() => {
    if (isCancelRequested(id) || getJob(jobId)?.status === "cancelled") {
      ac.abort();
    }
  }, 1000);
  watchdog.unref?.();

  try {
    const { files } = await downloadYoutube({
      url: job.url,
      outDir,
      videoIds: [id],
      audioOnly: Boolean(opts.audioOnly),
      withThumb: opts.withThumb !== false,
      withDescription: opts.withDescription !== false,
      maxHeight: opts.maxHeight || null,
      signal: ac.signal,
      onProgress: (p) => {
        trackDownload(jobId, id, p);
        const isMilestone = p.stage === "merge" || p.pct === 100;
        if (!progressThrottle(id, { force: isMilestone })) return;
        emitEvent("episode.download", { id, jobId, ...p });
        publishProgress(jobId);
      },
      onLog: (line) => emitLog("info", "ytdlp", line, { jobId, episodeId: id }),
    });

    if (isCancelRequested(id) || getJob(jobId)?.status === "cancelled") {
      markCancelled(id, "cancelado pelo usuário");
      episodeStatus(id, "cancelled", { jobId });
      return;
    }

    const match = files.find((f) => f.includes(`[${id}]`));
    if (!match) {
      // With concurrent lanes we can no longer fall back to "the last file in
      // the directory" — that could be another lane's video.
      markFailed(id, "arquivo não encontrado após download");
      episodeStatus(id, "failed", { jobId, error: "arquivo não encontrado" });
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
      episodeStatus(id, "pending", { jobId, title: pkg.title });
      // Hand off immediately — the uploader may be idle waiting on exactly this.
      notifyPendingWork();
      ensureUploader({ headless: useHeadless });
    }
  } catch (e) {
    if (e.name === "AbortError" || isCancelRequested(id)) {
      markCancelled(id, "cancelado pelo usuário");
      episodeStatus(id, "cancelled", { jobId });
    } else {
      const msg = e.message || String(e);
      markFailed(id, msg);
      episodeStatus(id, "failed", { jobId, error: msg });
      emitLog("error", "ytdlp", msg, { jobId, episodeId: id });
    }
  } finally {
    clearInterval(watchdog);
    untrackDownload(jobId, id);
    publishProgress(jobId);
  }
}

export async function runImportJob(jobId, { headless } = {}) {
  if (runningImportJobs.has(jobId)) return;
  runningImportJobs.add(jobId);
  producers += 1;

  try {
    const job = getJob(jobId);
    if (!job || job.status === "cancelled") return;
    const opts = job.options || {};
    const videoIds = opts.videoIds || [];
    const useHeadless = headless ?? opts.headless !== false;

    persistProgress(jobId, { status: "running" });

    // Open the browser and log in NOW, concurrently with the first download.
    // By the time video 1 is on disk the session is already parked and ready.
    ensureUploader({ headless: useHeadless });

    const outDir = path.join(DOWNLOADS_DIR, sourceDirName(job.url));

    // Downloads run concurrently now that each one owns its archive file.
    // The win is mostly latency, not bandwidth: every yt-dlp invocation spends
    // ~10-15s extracting metadata before a single byte moves, and that part
    // overlaps perfectly.
    const lanes = downloadConcurrency(opts);
    const pending = [...videoIds];

    const worker = async () => {
      for (;;) {
        const id = pending.shift();
        if (id === undefined) return;
        const live = getJob(jobId);
        if (!live || live.status === "cancelled") return;
        await downloadEpisode({ id, jobId, job, opts, outDir, useHeadless });
      }
    };

    await Promise.all(Array.from({ length: lanes }, worker));
  } catch (e) {
    console.error("[import-job]", e);
    updateJob(jobId, {
      status: "failed",
      error: e.message || String(e),
      progress: { phase: "failed", message: e.message || String(e) },
    });
    emitEvent("job.status", { jobId, status: "failed", error: e.message });
    return;
  } finally {
    producers -= 1;
    runningImportJobs.delete(jobId);
    downloadState.delete(jobId);
    // The uploader may be parked waiting on `producers` hitting zero.
    notifyPendingWork();
  }

  await waitForJobDrain(jobId);
  finalizeJob(jobId);
}

/**
 * A job is done when none of ITS episodes are still in flight — independent of
 * what any other job is doing. Two concurrent imports each wait on their own
 * counts, so neither can declare itself finished on the other's behalf.
 */
async function waitForJobDrain(jobId, { headless = true } = {}) {
  for (;;) {
    const job = getJob(jobId);
    if (!job || job.status === "cancelled") return;

    const c = jobEpisodeCounts(jobId);
    const inFlight =
      (c.queued || 0) + (c.downloading || 0) + (c.pending || 0) + (c.uploading || 0);
    if (inFlight === 0) return;

    if (!isUploaderRunning() && !sessionBlocked) {
      // An 'uploading' row only exists while the uploader holds it. If the
      // uploader is gone, nothing will ever move it — reclaim it.
      if ((c.uploading || 0) > 0) {
        for (const ep of listJobEpisodes(jobId)) {
          if (ep.status === "uploading") {
            updateEpisodeFields(ep.id, { status: "pending" });
            episodeStatus(ep.id, "pending", { jobId });
          }
        }
      }
      // Self-heal: work is waiting but nobody is draining it.
      if ((c.pending || 0) + (c.uploading || 0) > 0) ensureUploader({ headless });
    }
    // A blocked session will never drain on its own — stop waiting.
    if (sessionBlocked && (c.pending || 0) + (c.uploading || 0) === inFlight) return;

    await sleepOrWake(1000);
  }
}

function finalizeJob(jobId) {
  const job = getJob(jobId);
  if (!job || job.status === "cancelled") return;
  const counts = jobEpisodeCounts(jobId);
  const status = finalJobStatus(counts);
  const progress = persistProgress(jobId, { status });
  emitEvent("job.status", { jobId, status });
  emitEvent("queue.invalidate", {});
  return progress;
}

const watchedJobs = new Set();

/**
 * Close a job out once its episodes settle.
 *
 * runImportJob normally does this at the end of its download loop, but an
 * upload-only retry has no download loop — without a watcher the job would sit
 * at "running" forever after the last episode finishes.
 */
export function watchJobToCompletion(jobId, { headless = true } = {}) {
  if (watchedJobs.has(jobId) || runningImportJobs.has(jobId)) return;
  watchedJobs.add(jobId);
  (async () => {
    try {
      await waitForJobDrain(jobId, { headless });
      finalizeJob(jobId);
    } catch (e) {
      console.error("[job-watch]", jobId, e);
    } finally {
      watchedJobs.delete(jobId);
    }
  })();
}

/** Resume work interrupted by a crash or restart. */
export function resumeJobs(jobIds, { headless = true } = {}) {
  for (const id of jobIds) {
    setImmediate(() => {
      runImportJob(id, { headless }).catch((e) =>
        console.error("[resume]", id, e)
      );
    });
  }
}

export function finalizeOrphanedJobs(jobIds) {
  for (const id of jobIds) finalizeJob(id);
}
