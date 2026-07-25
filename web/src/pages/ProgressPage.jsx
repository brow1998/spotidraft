import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { episodeStatusPt, jobStatusPt } from "../statusLabels";
import { formatLocalDateTime } from "../format";

const ACTIVE = new Set(["queued", "downloading", "pending", "uploading"]);

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
  const [episodes, setEpisodes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = () =>
    api
      .queue()
      .then((d) => {
        setEpisodes(d.episodes || []);
        setJobs(d.jobs || []);
        setWorkerRunning(Boolean(d.workerRunning));
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const requeue = async (id) => {
    await api.requeue(id);
    load();
  };

  const cancelEp = async (id) => {
    await api.cancelEpisode(id);
    load();
  };

  const cancelJ = async (id) => {
    await api.cancelJob(id);
    load();
  };

  const activeJobs = jobs.filter((j) =>
    ["queued", "running", "uploading"].includes(j.status)
  );

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
    const c = {
      all: episodes.length,
      active: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
    };
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
      <p>
        Tudo roda no servidor — pode trocar de aba.{" "}
        {workerRunning ? "Worker ativo." : "Worker ocioso."}
      </p>
      {err && <div className="msg error">{err}</div>}

      {activeJobs.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: "1.25rem" }}>
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Fase</th>
                <th>Progresso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activeJobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <code>{j.id.slice(0, 8)}</code>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                      {(j.url || "").slice(0, 48)}
                    </div>
                  </td>
                  <td>
                    <StatusPill status={j.status} label={jobStatusPt(j.status)} />
                  </td>
                  <td>
                    {j.progress?.message || "—"}
                    {j.progress?.total
                      ? ` (${j.progress.current}/${j.progress.total})`
                      : ""}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => cancelJ(j.id)}
                    >
                      Cancelar lote
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => api.startWorker().then(load)}
        >
          Retomar envio
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => requeue()}>
          Reenfileirar falhas
        </button>
      </div>

      <div className="filters-bar">
        <div className="filter-chips" role="tablist" aria-label="Filtrar por status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`filter-chip ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="filter-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="filter-search"
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
            return (
              <article key={e.id} className={`episode-card ${open ? "open" : ""}`}>
                <button
                  type="button"
                  className="episode-card-main"
                  onClick={() => setExpanded(open ? null : e.id)}
                >
                  <div className="episode-thumb">
                    {e.thumb_url ? (
                      <img src={e.thumb_url} alt="" loading="lazy" />
                    ) : (
                      <div className="episode-thumb-fallback" aria-hidden="true">
                        ▶
                      </div>
                    )}
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
                        <div className="detail-label">Vídeo / thumb</div>
                        <span>
                          {e.has_video ? "vídeo ok" : "sem vídeo"}
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
                    <div className="row" style={{ gap: "0.35rem", marginTop: "0.75rem" }}>
                      {ACTIVE.has(e.status) || e.status === "failed" ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => cancelEp(e.id)}
                        >
                          Cancelar
                        </button>
                      ) : null}
                      {e.status === "failed" || e.status === "cancelled" ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => requeue(e.id)}
                        >
                          Requeue
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
    </div>
  );
}
