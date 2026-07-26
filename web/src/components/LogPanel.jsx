import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const MAX_LINES = 300;
const LEVELS = [
  { key: "all", label: "Tudo" },
  { key: "warn", label: "Avisos" },
  { key: "error", label: "Erros" },
];

/**
 * Live output from yt-dlp and the Creators automation. Until now this only went
 * to the server's stderr, so a stalled batch looked identical to a working one.
 *
 * @param {object} props
 * @param {Array} props.lines appended live by the parent from `log` events
 * @param {string} [props.jobId] scopes the backfill fetch
 */
export function LogPanel({ lines = [], jobId }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("all");
  const [backfill, setBackfill] = useState([]);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .logs(jobId)
      .then((d) => !cancelled && setBackfill(d.logs || []))
      .catch(() => !cancelled && setBackfill([]));
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  const all = [...backfill.map((e) => e.data || e), ...lines].slice(-MAX_LINES);
  const shown =
    level === "all"
      ? all
      : all.filter((l) =>
          level === "error" ? l.level === "error" : l.level !== "info"
        );

  // Follow the tail, but stop fighting the user the moment they scroll up.
  useEffect(() => {
    const el = bodyRef.current;
    if (!open || !el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [shown.length, open]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const copy = async () => {
    const text = shown.map((l) => `[${l.source}] ${l.line}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="log-panel">
      <div className="log-panel-head">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="log-panel-body"
        >
          {open ? "Ocultar log" : "Ver log técnico"}
          {all.length > 0 && !open ? ` (${all.length})` : ""}
        </button>

        {open && (
          <div className="log-panel-tools">
            <div className="filter-chips" role="group" aria-label="Filtrar log">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`chip-btn ${level === l.key ? "active" : ""}`}
                  aria-pressed={level === l.key}
                  onClick={() => setLevel(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div
          id="log-panel-body"
          className="log-body"
          ref={bodyRef}
          onScroll={onScroll}
          tabIndex={0}
          role="log"
          aria-label="Saída técnica"
        >
          {shown.length === 0 ? (
            <p className="log-empty">Nada por aqui ainda.</p>
          ) : (
            shown.map((l, i) => (
              <div key={i} className={`log-line log-${l.level || "info"}`}>
                <span className="log-source">{l.source}</span>
                <span className="log-text">{l.line}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

export default LogPanel;
