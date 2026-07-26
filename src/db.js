import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_PATH } from "./paths.js";
import { randomUUID } from "node:crypto";

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      video_path TEXT NOT NULL,
      image_path TEXT,
      meta_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      draft INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      options_json TEXT,
      progress_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // migrations (best-effort)
  const cols = db.prepare(`PRAGMA table_info(episodes)`).all().map((c) => c.name);
  if (!cols.includes("job_id")) {
    db.exec(`ALTER TABLE episodes ADD COLUMN job_id TEXT`);
  }
  if (!cols.includes("cancel_requested")) {
    db.exec(`ALTER TABLE episodes ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0`);
  }
  // job_id is a hot path now (per-job status counts drive job completion).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_job ON episodes(job_id)`);
  return db;
}

/** Episode statuses that are not terminal — a job with any of these is still working. */
export const ACTIVE_EPISODE_STATUSES = [
  "queued",
  "downloading",
  "pending",
  "uploading",
];

function now() {
  return new Date().toISOString();
}

export function upsertEpisode(row) {
  const d = getDb();
  const ts = now();
  d.prepare(
    `INSERT INTO episodes (
      id, title, description, video_path, image_path, meta_path,
      status, draft, job_id, cancel_requested, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @video_path, @image_path, @meta_path,
      @status, @draft, @job_id, 0, @ts, @ts
    )
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      video_path=excluded.video_path,
      image_path=excluded.image_path,
      meta_path=excluded.meta_path,
      draft=excluded.draft,
      job_id=COALESCE(excluded.job_id, episodes.job_id),
      status=excluded.status,
      error=NULL,
      cancel_requested=0,
      updated_at=excluded.updated_at`
  ).run({
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    video_path: row.video_path ?? "",
    image_path: row.image_path ?? null,
    meta_path: row.meta_path ?? null,
    status: row.status ?? "pending",
    draft: row.draft === false ? 0 : 1,
    job_id: row.job_id ?? null,
    ts,
  });
}

export function claimNextPending() {
  const d = getDb();
  const skip = new Set();
  // Read-then-write is not atomic, so verify the UPDATE actually claimed the row
  // and move on to the next candidate if someone else got there first.
  for (let attempt = 0; attempt < 5; attempt++) {
    const params = [...skip];
    const notIn = params.length
      ? `AND id NOT IN (${params.map(() => "?").join(",")})`
      : "";
    const row = d
      .prepare(
        `SELECT * FROM episodes
         WHERE status = 'pending' AND cancel_requested = 0 ${notIn}
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(...params);
    if (!row) return null;
    const res = d
      .prepare(
        `UPDATE episodes SET status='uploading', error=NULL, updated_at=? WHERE id=? AND status='pending'`
      )
      .run(now(), row.id);
    if (res.changes === 1) {
      return d.prepare(`SELECT * FROM episodes WHERE id=?`).get(row.id);
    }
    skip.add(row.id);
  }
  return null;
}

/** Status histogram for a job's episodes, e.g. { queued: 2, published: 3 }. */
export function jobEpisodeCounts(jobId) {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM episodes WHERE job_id=? GROUP BY status`
    )
    .all(jobId);
  const out = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Number of a job's episodes still in a non-terminal state. */
export function jobActiveEpisodeCount(jobId) {
  const counts = jobEpisodeCounts(jobId);
  let n = 0;
  for (const s of ACTIVE_EPISODE_STATUSES) n += counts[s] || 0;
  return n;
}

export function markPublished(id) {
  getDb()
    .prepare(
      `UPDATE episodes SET status='published', published_at=?, updated_at=?, error=NULL WHERE id=?`
    )
    .run(now(), now(), id);
}

export function markFailed(id, error) {
  getDb()
    .prepare(
      `UPDATE episodes SET status='failed', error=?, updated_at=? WHERE id=?`
    )
    .run(String(error).slice(0, 2000), now(), id);
}

export function markCancelled(id, reason = null) {
  getDb()
    .prepare(
      `UPDATE episodes SET status='cancelled', cancel_requested=0, error=?, updated_at=? WHERE id=?`
    )
    .run(reason, now(), id);
}

export function requestCancelEpisode(id) {
  const d = getDb();
  const ep = d.prepare(`SELECT * FROM episodes WHERE id=?`).get(id);
  if (!ep) return { ok: false, reason: "not_found" };
  if (["published", "cancelled"].includes(ep.status)) {
    return { ok: false, reason: "terminal", status: ep.status };
  }
  if (["queued", "downloading", "pending", "failed"].includes(ep.status)) {
    markCancelled(id, "cancelado pelo usuário");
    return { ok: true, status: "cancelled" };
  }
  // uploading: flag and hope worker notices before publish
  d.prepare(
    `UPDATE episodes SET cancel_requested=1, updated_at=? WHERE id=?`
  ).run(now(), id);
  return { ok: true, status: "cancel_requested" };
}

export function isCancelRequested(id) {
  const ep = getDb().prepare(`SELECT cancel_requested, status FROM episodes WHERE id=?`).get(id);
  return Boolean(ep?.cancel_requested) || ep?.status === "cancelled";
}

/**
 * Put failed/cancelled episodes back in the pipeline.
 *
 * Where they re-enter depends on how far they got: an episode that never
 * downloaded has no file to upload, so sending it to 'pending' (= ready to
 * upload) just makes the uploader fail again with "video_path missing". Those
 * go back to 'queued' so the download runs again.
 *
 * @returns {{ requeued: number, toDownload: string[], jobIds: string[] }}
 */
export function requeueFailed(id) {
  const d = getDb();
  const rows = id
    ? d
        .prepare(
          `SELECT * FROM episodes WHERE id=? AND status IN ('failed','cancelled')`
        )
        .all(id)
    : d.prepare(`SELECT * FROM episodes WHERE status='failed'`).all();

  const toDownload = [];
  const jobIds = new Set();
  const touchedJobs = new Set();
  const ts = now();

  for (const ep of rows) {
    const hasVideo = Boolean(ep.video_path) && fs.existsSync(ep.video_path);
    const status = hasVideo ? "pending" : "queued";
    d.prepare(
      `UPDATE episodes SET status=?, error=NULL, cancel_requested=0, updated_at=? WHERE id=?`
    ).run(status, ts, ep.id);
    if (ep.job_id) touchedJobs.add(ep.job_id);
    if (!hasVideo) {
      toDownload.push(ep.id);
      if (ep.job_id) jobIds.add(ep.job_id);
    }
  }

  return {
    requeued: rows.length,
    toDownload,
    // Jobs that must re-run the download loop…
    jobIds: [...jobIds],
    // …versus every job with work back in flight, which must look active again
    // so the progress card reappears.
    touchedJobs: [...touchedJobs],
  };
}

/**
 * Non-terminal jobs that still have episodes in flight.
 *
 * Anything that drains the queue outside runImportJob needs these so the jobs
 * get closed out — otherwise they sit at "queued" forever after their last
 * episode finishes.
 */
export function jobsWithActiveEpisodes() {
  return getDb()
    .prepare(
      `SELECT DISTINCT j.id FROM jobs j
       JOIN episodes e ON e.job_id = j.id
       WHERE j.status NOT IN ('completed','cancelled','failed')
         AND e.status IN ('queued','downloading','pending','uploading')`
    )
    .all()
    .map((r) => r.id);
}

/** Published episodes that still hold a local video file. */
export function publishedWithMedia() {
  return getDb()
    .prepare(
      `SELECT * FROM episodes WHERE status='published' AND video_path IS NOT NULL AND video_path <> ''`
    )
    .all();
}

/** How many failed episodes a bulk requeue would affect. */
export function countFailed() {
  return (
    getDb().prepare(`SELECT COUNT(*) AS n FROM episodes WHERE status='failed'`).get()
      ?.n || 0
  );
}

export function listEpisodes() {
  return getDb()
    .prepare(`SELECT * FROM episodes ORDER BY created_at ASC`)
    .all();
}

export function getEpisode(id) {
  return getDb().prepare(`SELECT * FROM episodes WHERE id=?`).get(id);
}

export function updateEpisodeFields(id, fields) {
  const allowed = [
    "title",
    "description",
    "video_path",
    "image_path",
    "meta_path",
    "status",
    "error",
    "job_id",
  ];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k}=?`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push("updated_at=?");
  vals.push(now());
  vals.push(id);
  getDb()
    .prepare(`UPDATE episodes SET ${sets.join(", ")} WHERE id=?`)
    .run(...vals);
}

export function createJob({ type, url, options }) {
  const d = getDb();
  const id = randomUUID();
  const ts = now();
  d.prepare(
    `INSERT INTO jobs (id, type, status, url, options_json, progress_json, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`
  ).run(
    id,
    type,
    url ?? null,
    JSON.stringify(options ?? {}),
    JSON.stringify({ phase: "queued", current: 0, total: 0, message: "" }),
    ts,
    ts
  );
  return getJob(id);
}

export function getJob(id) {
  const row = getDb().prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
  if (!row) return null;
  return hydrateJob(row);
}

export function listJobs(limit = 30) {
  return getDb()
    .prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map(hydrateJob);
}

function hydrateJob(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    url: row.url,
    options: safeJson(row.options_json, {}),
    progress: safeJson(row.progress_json, {}),
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function updateJob(id, { status, progress, error } = {}) {
  const d = getDb();
  const cur = d.prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
  if (!cur) return null;
  d.prepare(
    `UPDATE jobs SET status=?, progress_json=?, error=?, updated_at=? WHERE id=?`
  ).run(
    status ?? cur.status,
    progress ? JSON.stringify(progress) : cur.progress_json,
    error === undefined ? cur.error : error,
    now(),
    id
  );
  return getJob(id);
}

const RESTART_UPLOAD_MSG =
  "interrompido pelo reinício do app — confira no Spotify antes de reenviar";

/**
 * Reconcile rows left mid-flight by a crash or restart. Must run before the
 * server accepts requests.
 *
 * `downloading` → `queued`: safe to retry, yt-dlp's --download-archive makes a
 * completed download a no-op and --no-overwrites resumes .part files.
 *
 * `uploading` → `failed`: NOT auto-requeued. The draft may already exist on
 * Creators and re-running would silently duplicate it, so the user requeues
 * explicitly after checking.
 */
export function recoverStaleWork() {
  const d = getDb();
  const ts = now();

  const stuckDownloads = d
    .prepare(`UPDATE episodes SET status='queued', updated_at=? WHERE status='downloading'`)
    .run(ts).changes;

  const stuckUploads = d
    .prepare(
      `UPDATE episodes SET status='failed', error=?, updated_at=? WHERE status='uploading'`
    )
    .run(RESTART_UPLOAD_MSG, ts).changes;

  const openJobs = d
    .prepare(
      `SELECT id FROM jobs WHERE status IN ('queued','running','uploading') ORDER BY created_at ASC`
    )
    .all()
    .map((r) => r.id);

  const resumable = [];
  const orphaned = [];
  for (const id of openJobs) {
    if (jobActiveEpisodeCount(id) > 0) resumable.push(id);
    else orphaned.push(id);
  }

  return { stuckDownloads, stuckUploads, resumable, orphaned };
}

export function cancelJob(id) {
  const d = getDb();
  const job = getJob(id);
  if (!job) return { ok: false, reason: "not_found" };
  if (["completed", "cancelled"].includes(job.status)) {
    return { ok: false, reason: "terminal", status: job.status };
  }
  updateJob(id, {
    status: "cancelled",
    progress: { ...job.progress, message: "cancelado" },
  });
  const eps = d
    .prepare(`SELECT id, status FROM episodes WHERE job_id=?`)
    .all(id);
  for (const ep of eps) {
    requestCancelEpisode(ep.id);
  }
  return { ok: true };
}
