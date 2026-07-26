import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const EVENT_TYPES = [
  "hello",
  "ping",
  "job.progress",
  "job.status",
  "episode.status",
  "episode.download",
  "episode.upload",
  "log",
  "worker",
  "session.expired",
  "queue.invalidate",
];

/** No frame for this long means the stream is dead even if no error fired. */
const LIVENESS_MS = 35_000;
const POLL_MS = 3_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 30_000;

/**
 * Subscribe to server events, falling back to polling when SSE can't get through.
 *
 * @param {(type: string, data: object) => void} onEvent
 * @param {() => void} [onPoll] called on each fallback tick, and after a
 *   server restart, so the caller can refetch full state.
 */
export function useEventStream(onEvent, onPoll) {
  const [mode, setMode] = useState("connecting");
  const handlers = useRef({ onEvent, onPoll });
  handlers.current = { onEvent, onPoll };

  useEffect(() => {
    let stopped = false;
    let es = null;
    let livenessTimer = null;
    let pollTimer = null;
    let retryTimer = null;
    let retryDelay = RETRY_MIN_MS;
    let lastId = 0;
    let bootId = null;

    const clearTimers = () => {
      clearTimeout(livenessTimer);
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
      pollTimer = null;
    };

    const startPolling = () => {
      if (stopped || pollTimer) return;
      setMode("poll");
      pollTimer = setInterval(() => handlers.current.onPoll?.(), POLL_MS);
      // Retry SSE with backoff — the fallback should not be permanent.
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    const dropToPolling = () => {
      es?.close();
      es = null;
      clearTimeout(livenessTimer);
      startPolling();
    };

    // A buffering proxy produces silence, not an error, so onerror alone is not
    // enough to detect a dead stream. Every frame (including ping) resets this.
    const bumpLiveness = () => {
      clearTimeout(livenessTimer);
      livenessTimer = setTimeout(dropToPolling, LIVENESS_MS);
    };

    const connect = () => {
      if (stopped) return;
      clearTimers();
      try {
        es = new EventSource(api.eventsUrl(lastId || undefined));
      } catch {
        return startPolling();
      }

      es.onopen = () => {
        if (stopped) return;
        setMode("sse");
        retryDelay = RETRY_MIN_MS;
        bumpLiveness();
      };

      es.onerror = () => {
        if (stopped) return;
        // EventSource reconnects on its own while readyState is CONNECTING;
        // only give up once it has actually closed.
        if (es?.readyState === EventSource.CLOSED) dropToPolling();
      };

      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (ev) => {
          if (stopped) return;
          bumpLiveness();
          if (ev.lastEventId) lastId = Number(ev.lastEventId) || lastId;

          let data = {};
          try {
            data = JSON.parse(ev.data);
          } catch {
            /* ignore malformed frame */
          }

          if (type === "ping") return;
          if (type === "hello") {
            // A different bootId means the server restarted and its in-memory
            // state is gone — our incremental view can't be trusted.
            if (bootId && data.bootId !== bootId) {
              lastId = 0;
              handlers.current.onPoll?.();
            }
            bootId = data.bootId;
            return;
          }
          handlers.current.onEvent?.(type, data);
        });
      }
    };

    connect();
    return () => {
      stopped = true;
      clearTimers();
      es?.close();
    };
  }, []);

  return { mode, connected: mode === "sse" };
}
