const TERMINAL = ["published", "failed", "cancelled"];

/**
 * Build a job's progress object from its episode status histogram plus the
 * live in-memory state of each track.
 *
 * Download and upload now run concurrently, so a single {phase, current, total}
 * can no longer describe the job. This returns two tracks, and keeps the old
 * three keys as aliases so any consumer that hasn't been updated still renders.
 *
 * Pure — covered by test/job-progress.test.js.
 */
export function computeJobProgress(counts = {}, download = {}, upload = {}) {
  const n = (k) => counts[k] || 0;
  const total =
    download.total ||
    TERMINAL.concat(["queued", "downloading", "pending", "uploading"]).reduce(
      (acc, k) => acc + n(k),
      0
    );

  const terminalCount = TERMINAL.reduce((acc, k) => acc + n(k), 0);
  // An episode has finished downloading once it is past the download stage.
  const downloaded = total - n("queued") - n("downloading");
  const uploaded = terminalCount;

  const downloadsLeft = n("queued") + n("downloading");
  const uploadsLeft = n("pending") + n("uploading");

  let phase;
  if (downloadsLeft > 0 && uploadsLeft > 0) phase = "running";
  else if (downloadsLeft > 0) phase = "downloading";
  else if (uploadsLeft > 0) phase = "uploading";
  else if (total > 0 && n("failed") === total) phase = "failed";
  else if (total > 0 && n("cancelled") === total) phase = "cancelled";
  else phase = "done";

  const parts = [];
  if (downloadsLeft > 0) parts.push(`baixando ${downloaded}/${total}`);
  if (uploadsLeft > 0) parts.push(`enviando ${uploaded}/${total}`);
  if (!parts.length) {
    if (phase === "done") parts.push(`concluído — ${n("published")}/${total} no Spotify`);
    else if (phase === "failed") parts.push("todos falharam");
    else if (phase === "cancelled") parts.push("cancelado");
  }

  return {
    phase,
    total,
    download: {
      done: Math.max(0, Math.min(downloaded, total)),
      total,
      current: download.current || null,
      activeCount: download.activeCount || 0,
    },
    upload: {
      done: Math.max(0, Math.min(uploaded, total)),
      total,
      current: upload.current || null,
      activeCount: upload.activeCount || 0,
    },
    counts: {
      queued: n("queued"),
      downloading: n("downloading"),
      pending: n("pending"),
      uploading: n("uploading"),
      published: n("published"),
      failed: n("failed"),
      cancelled: n("cancelled"),
    },
    message: parts.join(" · "),
    // Legacy aliases — keep old consumers rendering something sane.
    current: terminalCount,
  };
}

/** Terminal status for a job, given its final episode counts. */
export function finalJobStatus(counts = {}, { cancelled = false } = {}) {
  if (cancelled) return "cancelled";
  const n = (k) => counts[k] || 0;
  const total = TERMINAL.reduce((acc, k) => acc + n(k), 0);
  if (total > 0 && n("failed") === total) return "failed";
  return "completed";
}
