import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

/**
 * In-process event bus. The HTTP layer turns these into SSE frames; the
 * pipeline emits them. Nothing here touches the database.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(64);

/** Identifies this server run. A changed bootId tells the client to refetch. */
export const BOOT_ID = randomUUID();

const EVENT_RING_CAP = 500;
const LOG_RING_CAP = 1000;

const eventRing = [];
const logRing = [];
let seq = 0;

/** Pure: everything in the ring newer than `lastId`. */
export function eventsSince(lastId) {
  const n = Number(lastId);
  if (!Number.isFinite(n) || n <= 0) return [];
  return eventRing.filter((e) => e.id > n);
}

/** Pure: one SSE frame. Newlines in the payload are handled by JSON escaping. */
export function serializeSse(evt) {
  const data = JSON.stringify(evt.data ?? {});
  let frame = "";
  if (evt.id) frame += `id: ${evt.id}\n`;
  frame += `event: ${evt.type}\n`;
  frame += `data: ${data}\n\n`;
  return frame;
}

export function emitEvent(type, data = {}) {
  seq += 1;
  const evt = { id: seq, type, ts: new Date().toISOString(), data };
  eventRing.push(evt);
  if (eventRing.length > EVENT_RING_CAP) eventRing.shift();
  if (type === "log") {
    logRing.push(evt);
    if (logRing.length > LOG_RING_CAP) logRing.shift();
  }
  bus.emit("event", evt);
  return evt;
}

export function lastEventId() {
  return seq;
}

/** Backfill for the log panel, so opening it doesn't replay job events. */
export function recentLogs({ limit = 300, jobId } = {}) {
  const rows = jobId ? logRing.filter((e) => e.data?.jobId === jobId) : logRing;
  return rows.slice(-limit);
}

export function emitLog(level, source, line, extra = {}) {
  return emitEvent("log", { level, source, line: String(line), ...extra });
}

/**
 * Rate limiter for high-frequency per-key events. yt-dlp emits progress ~10x/s;
 * unthrottled that is 10 SSE frames and 10 ring pushes per second per episode.
 */
export function createThrottle(intervalMs = 400) {
  const last = new Map();
  return function shouldEmit(key, { force = false } = {}) {
    const now = Date.now();
    const prev = last.get(key) || 0;
    if (!force && now - prev < intervalMs) return false;
    last.set(key, now);
    return true;
  };
}
