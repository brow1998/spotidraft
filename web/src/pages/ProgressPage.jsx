import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { episodeStatusPt } from "../statusLabels";
import { formatLocalDateTime } from "../format";
import { useEventStream } from "../hooks/useEventStream.js";
import { useToast } from "../toast/ToastProvider.jsx";
import {
  JobProgressCard,
  describeUploadStep,
} from "../components/JobProgressCard.jsx";
import { LogPanel } from "../components/LogPanel.jsx";
import { FilterChips } from "../components/FilterChips.jsx";
import { ProgressBar } from "../components/ProgressBar.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { Thumb } from "../components/Thumb.jsx";

const ACTIVE = new Set(["queued", "downloading", "pending", "uploading"]);
const ACTIVE_JOB = new Set(["queued", "running", "uploading"]);
const MAX_LOG_LINES = 300;

const STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Em andamento" },
  { id: "published", label: "No Spotify" },
  { id: "failed", label: "Falhas" },
  { id: "cancelled", label: "Cancelados" },
];

const STATUS_ICON = {
  queued: "◷",
  downloading: "↓",
  pending: "◎",
  uploading: "↑",
  published: "✓",
  failed: "!",
  cancelled: "×",
  running: "▸",
  completed: "✓",
};

function StatusPill({ status, label }) {
  return (
    <span className={`pill pill-status ${status || ""}`}>
      <span className="pill-icon" aria-hidden="true">
        {STATUS_ICON[status] || "·"}
      </span>
      <span className="pill-label">{label}</span>
    </span>
  );
}

function matchesFilter(ep, filter) {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE.has(ep.status);
  return ep.status === filter;
}

export default function ProgressPage() {
  const toast = useToast();
  const [episodes, setEpisodes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [logLines, setLogLines] = useState([]);
  /** Live per-episode download/upload state, keyed by episode id. */
  const [liveById, setLiveById] = useState({});
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(() => {
    return api
      .queue()
      .then((d) => {
        setEpisodes(d.episodes || []);
        setJobs(d.jobs || []);
        setWorkerRunning(Boolean(d.workerRunning));
      })
      .catch((e) => toastRef.current.error(`Não consegui carregar a fila: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Events replace the old 2s poll. Each one patches a single row instead of
  // refetching (and re-stat'ing) the whole queue.
  const onEvent = useCallback(
    (type, data) => {
      if (type === "episode.status") {
        setEpisodes((list) =>
          list.map((e) =>
            e.id === data.id
              ? { ...e, status: data.status, error: data.error ?? null, title: data.title ?? e.title }
              : e
          )
        );
        if (["published", "failed", "cancelled"].includes(data.status)) {
          setLiveById((m) => {
            const { [data.id]: _drop, ...rest } = m;
            return rest;
          });
        }
        return;
      }

      if (type === "episode.download") {
        setLiveById((m) => ({ ...m, [data.id]: { kind: "download", ...data } }));
        return;
      }

      if (type === "episode.upload") {
        setLiveById((m) => ({ ...m, [data.id]: { kind: "upload", ...data } }));
        return;
      }

      if (type === "job.progress" || type === "job.status") {
        setJobs((list) => {
          const idx = list.findIndex((j) => j.id === data.jobId);
          if (idx === -1) {
            // A job we haven't seen yet (started from another tab) — refetch.
            load();
            return list;
          }
          const next = [...list];
          next[idx] = {
            ...next[idx],
            ...(data.status ? { status: data.status } : {}),
            ...(data.progress ? { progress: data.progress } : {}),
          };
          return next;
        });
        return;
      }

      if (type === "worker") {
        setWorkerRunning(Boolean(data.running));
        return;
      }

      if (type === "log") {
        setLogLines((l) => [...l, data].slice(-MAX_LOG_LINES));
        return;
      }

      if (type === "session.expired") {
        toastRef.current.error(data.message || "Sessão do Spotify expirou.");
        return;
      }

      if (type === "queue.invalidate") load();
    },
    [load]
  );

  const { mode } = useEventStream(onEvent, load);

  const guard = async (key, fn, okMsg) => {
    setBusyAction(key);
    try {
      const result = await fn();
      if (okMsg) toast.ok(typeof okMsg === "function" ? okMsg(result) : okMsg);
      await load();
      return result;
    } catch (e) {
      // These used to be bare awaits: a failed cancel changed nothing on screen
      // and the user had no idea why.
      toast.error(e.message || "Não deu certo.");
    } finally {
      setBusyAction(null);
    }
  };

  const requeueOne = (id) =>
    guard(`requeue-${id}`, () => api.requeue(id), "Reenfileirado.");

  const requeueAllFailed = () => {
    const failed = episodes.filter((e) => e.status === "failed").length;
    if (!failed) return toast.info("Nenhuma falha pra reenfileirar.");
    if (!window.confirm(`Reenfileirar ${failed} episódio(s) que falharam?`)) return;
    return guard(
      "requeue-all",
      () => api.requeue(),
      (r) => `${r?.requeued ?? failed} episódio(s) de volta na fila.`
    );
  };

  const cancelEp = (id) =>
    guard(`cancel-${id}`, () => api.cancelEpisode(id), "Cancelamento solicitado.");

  const cancelJ = (id) =>
    guard(`cancel-job-${id}`, () => api.cancelJob(id), "Lote cancelado.");

  const startWorker = () =>
    guard("start-worker", () => api.startWorker(), (r) =>
      r?.started ? "Envio retomado." : "O envio já estava rodando."
    );

  const activeJobs = jobs.filter((j) => ACTIVE_JOB.has(j.status));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...episodes]
      .reverse()
      .filter((e) => matchesFilter(e, filter))
      .filter((e) => {
        if (!q) return true;
        return (
          e.title?.toLowerCase().includes(q) ||
          e.id?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
        );
      });
  }, [episodes, filter, query]);

  const counts = useMemo(() => {
    const c = { all: episodes.length, active: 0, published: 0, failed: 0, cancelled: 0 };
    for (const e of episodes) {
      if (ACTIVE.has(e.status)) c.active += 1;
      if (e.status === "published") c.published += 1;
      if (e.status === "failed") c.failed += 1;
      if (e.status === "cancelled") c.cancelled += 1;
    }
    return c;
  }, [episodes]);

  return (
    <div>
      <h1>Progresso</h1>
      <p className="page-lede">
        Tudo roda no servidor — pode trocar de aba.{" "}
        {workerRunning ? "Enviando agora." : "Nenhum envio em andamento."}
        {mode === "poll" && (
          <span className="conn-note" title="Sem conexão ao vivo; atualizando periodicamente">
            {" "}
            · modo lento
          </span>
        )}
      </p>

      {loading ? (
        <Skeleton.Group as="row" count={4} label="Carregando a fila…" />
      ) : (
        <>
          {activeJobs.length > 0 && (
            <div className="job-cards">
              {activeJobs.map((j) => (
                <JobProgressCard
                  key={j.id}
                  job={j}
                  onCancel={() => cancelJ(j.id)}
                  cancelling={busyAction === `cancel-job-${j.id}`}
                />
              ))}
            </div>
          )}

          <div className="row page-actions-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={startWorker}
              disabled={busyAction === "start-worker"}
            >
              Retomar envio
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={requeueAllFailed}
              disabled={busyAction === "requeue-all" || counts.failed === 0}
            >
              Reenfileirar falhas
              {counts.failed > 0 ? ` (${counts.failed})` : ""}
            </button>
          </div>

          <div className="filters-bar">
            <FilterChips
              label="Filtrar por status"
              options={STATUS_FILTERS}
              value={filter}
              onChange={setFilter}
              counts={counts}
            />
            <input
              type="search"
              className="filter-search"
              aria-label="Buscar episódios"
              placeholder="Buscar título, id ou descrição…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="episode-list">
            {filtered.length === 0 ? (
              <div className="empty-hint">Nenhum episódio neste filtro.</div>
            ) : (
              filtered.map((e) => {
                const open = expanded === e.id;
                const live = liveById[e.id];
                return (
                  <article key={e.id} className={`episode-card ${open ? "open" : ""}`}>
                    <button
                      type="button"
                      className="episode-card-main"
                      onClick={() => setExpanded(open ? null : e.id)}
                      aria-expanded={open}
                    >
                      <div className="episode-thumb">
                        <Thumb src={e.thumb_url} fallbackText="▶" />
                      </div>
                      <div className="episode-body">
                        <div className="episode-title-row">
                          <h2 className="episode-title">{e.title}</h2>
                          <StatusPill status={e.status} label={episodeStatusPt(e.status)} />
                        </div>
                        <div className="episode-meta">
                          {e.format && <span>{e.format}</span>}
                          {e.duration && <span>{e.duration}</span>}
                          {e.clip_seconds != null && <span>clip {e.clip_seconds}s</span>}
                          <span>{formatLocalDateTime(e.updated_at)}</span>
                        </div>
                        {live?.kind === "download" && (
                          <ProgressBar
                            value={live.overallPct}
                            detail={live.stage === "merge" ? "juntando áudio e vídeo" : null}
                            valueText={`baixando ${Math.round(live.overallPct || 0)}%`}
                          />
                        )}
                        {live?.kind === "upload" &&
                          (() => {
                            const s = describeUploadStep(live);
                            return s ? (
                              <div className="episode-step">
                                <span className="upload-step-spinner" aria-hidden="true" />
                                {s.label}
                                {s.detail ? ` · ${s.detail}` : ""}
                              </div>
                            ) : null;
                          })()}
                        {e.error ? <div className="episode-error">{e.error}</div> : null}
                      </div>
                    </button>

                    {open && (
                      <div className="episode-details">
                        <div className="episode-detail-grid">
                          <div>
                            <div className="detail-label">YouTube</div>
                            <a
                              href={e.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="detail-link"
                            >
                              {e.source_url}
                            </a>
                          </div>
                          <div>
                            <div className="detail-label">ID</div>
                            <code>{e.id}</code>
                          </div>
                          <div>
                            <div className="detail-label">Formato</div>
                            <span>{e.format || "—"}</span>
                          </div>
                          <div>
                            <div className="detail-label">Duração</div>
                            <span>
                              {e.duration ||
                                (e.clip_seconds != null ? `${e.clip_seconds}s (clip)` : "—")}
                            </span>
                          </div>
                          <div>
                            <div className="detail-label">Arquivo local</div>
                            <span>
                              {e.media_released
                                ? "liberado após o envio"
                                : e.has_video
                                  ? "em disco"
                                  : "sem vídeo"}
                              {" · "}
                              {e.has_thumb ? "thumb ok" : "sem thumb"}
                            </span>
                          </div>
                          {e.published_at && (
                            <div>
                              <div className="detail-label">Enviado em</div>
                              <span>{formatLocalDateTime(e.published_at)}</span>
                            </div>
                          )}
                        </div>
                        {e.description ? (
                          <div className="episode-desc">
                            <div className="detail-label">Descrição</div>
                            <p>{e.description}</p>
                          </div>
                        ) : null}
                        <div className="row episode-actions">
                          {ACTIVE.has(e.status) || e.status === "failed" ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => cancelEp(e.id)}
                              disabled={busyAction === `cancel-${e.id}`}
                            >
                              Cancelar
                            </button>
                          ) : null}
                          {e.status === "failed" || e.status === "cancelled" ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => requeueOne(e.id)}
                              disabled={busyAction === `requeue-${e.id}`}
                            >
                              Reenfileirar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <LogPanel lines={logLines} jobId={activeJobs[0]?.id} />
        </>
      )}
    </div>
  );
}
