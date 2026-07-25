import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { formatLocalDateTime } from "../format";

function statusPt(s) {
  if (!s) return "—";
  const map = {
    Draft: "Rascunho",
    Published: "Publicado",
    Scheduled: "Agendado",
    Rascunho: "Rascunho",
    Publicado: "Publicado",
    Agendado: "Agendado",
  };
  return map[s] || s;
}

const STATUS_ICON = {
  Draft: "✎",
  Rascunho: "✎",
  Published: "✓",
  Publicado: "✓",
  Scheduled: "◷",
  Agendado: "◷",
};

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "Draft", label: "Rascunho" },
  { id: "Published", label: "Publicado" },
  { id: "Scheduled", label: "Agendado" },
];

function creatorsHref(href) {
  if (!href) return null;
  return href.startsWith("http") ? href : `https://creators.spotify.com${href}`;
}

export default function SpotifyPage() {
  const { refreshSession } = useOutletContext() || {};
  const [show, setShow] = useState(null);
  const [session, setSession] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingCache, setLoadingCache] = useState(true);
  const [msg, setMsg] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  const applyCatalog = (data, { silent } = {}) => {
    setEpisodes(data.episodes || []);
    const incoming = data.show || {};
    const safeName =
      typeof incoming.name === "string" &&
      incoming.name !== "{}" &&
      !/store and access|cookie|privacy|consent/i.test(incoming.name)
        ? incoming.name
        : null;
    setShow((prev) => ({
      ...(prev || {}),
      ...incoming,
      name:
        safeName ||
        (prev && !/store and access/i.test(prev.name || "") ? prev.name : null),
    }));
    const when = data.fetchedAt || data.cachedAt || new Date().toISOString();
    setFetchedAt(when);
    setFromCache(Boolean(data.fromCache));
    if (!silent) {
      const n = (data.episodes || []).length;
      setMsg({
        type: "ok",
        text: data.fromCache
          ? `${n} episódio(s) em cache`
          : `${n} episódio(s) atualizados do Creators`,
      });
    }
  };

  const refreshRemote = async ({ silent } = {}) => {
    setBusy(true);
    if (!silent) setMsg(null);
    try {
      const data = await api.spotifyEpisodes({ refresh: true });
      applyCatalog({ ...data, fromCache: false }, { silent });
      refreshSession?.();
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await api.show();
        if (cancelled) return;
        setShow(local.show);
        setSession(local.session);

        const cached = await api.spotifyEpisodes({ refresh: false });
        if (cancelled) return;
        if (cached?.episodes?.length) {
          applyCatalog(cached, { silent: true });
        } else {
          // Primeira vez: busca ao vivo
          setBusy(true);
          const live = await api.spotifyEpisodes({ refresh: true });
          if (!cancelled) applyCatalog(live);
        }
      } catch (e) {
        if (!cancelled) setMsg({ type: "error", text: e.message });
      } finally {
        if (!cancelled) {
          setLoadingCache(false);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const del = async (title) => {
    if (!confirm(`Excluir "${title}" no Spotify for Creators?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.deleteSpotifyEpisode(title);
      setEpisodes((prev) => prev.filter((e) => e.title !== title));
      setMsg({ type: "ok", text: `Excluído: ${title}` });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return episodes.filter((e) => {
      if (filter !== "all") {
        const st = (e.status || "").toLowerCase();
        if (st !== filter.toLowerCase()) return false;
      }
      if (!q) return true;
      return (e.title || "").toLowerCase().includes(q);
    });
  }, [episodes, filter, query]);

  const counts = useMemo(() => {
    const c = { all: episodes.length, Draft: 0, Published: 0, Scheduled: 0 };
    for (const e of episodes) {
      const key = e.status;
      if (key && c[key] != null) c[key] += 1;
    }
    return c;
  }, [episodes]);

  const showName =
    typeof show?.name === "string" &&
    show.name !== "{}" &&
    !/store and access|cookie|privacy|consent/i.test(show.name)
      ? show.name
      : null;

  return (
    <div>
      <h1>Spotify</h1>
      <p>Dados do programa e episódios que já estão no Creators.</p>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="options" style={{ marginBottom: "1.25rem" }}>
        <div>
          <div className="detail-label">Programa</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.25rem",
              marginTop: 4,
            }}
          >
            {showName || "—"}
          </div>
        </div>
        <div>
          <div className="detail-label">Show ID</div>
          <code>{show?.showId || "—"}</code>
        </div>
        <div>
          <div className="detail-label">Sessão</div>
          <span
            className={`chip ${session?.ok ? "ok" : "bad"}`}
            style={{ marginTop: 6 }}
          >
            {session?.ok
              ? `Ok · ${session.cookieCount} cookies`
              : "Ausente / incompleta"}
          </span>
        </div>
        <div>
          <div className="detail-label">Link</div>
          {show?.episodesUrl ? (
            <a
              href={show.episodesUrl}
              target="_blank"
              rel="noreferrer"
              className="detail-link"
            >
              Abrir episódios
            </a>
          ) : (
            "—"
          )}
        </div>
      </div>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || loadingCache}
          onClick={() => refreshRemote()}
        >
          {busy ? "Atualizando…" : "Atualizar"}
        </button>
        {(fetchedAt || loadingCache) && (
          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
            {loadingCache && episodes.length === 0
              ? "Carregando…"
              : `${fromCache ? "Cache" : "Ao vivo"} · ${formatLocalDateTime(fetchedAt)}`}
          </span>
        )}
      </div>

      {episodes.length > 0 && (
        <div className="filters-bar">
          <div className="filter-chips" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
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
            placeholder="Buscar título…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="episode-list">
        {filtered.length === 0 ? (
          <div className="empty-hint">
            {loadingCache || busy
              ? "Carregando episódios do Creators…"
              : episodes.length === 0
                ? "Nenhum episódio em cache. Clique em Atualizar."
                : "Nenhum episódio neste filtro."}
          </div>
        ) : (
          filtered.map((e) => {
            const key = (e.href || e.title) + (e.date || "");
            const open = expanded === key;
            const href = creatorsHref(e.href);
            return (
              <article key={key} className={`episode-card ${open ? "open" : ""}`}>
                <button
                  type="button"
                  className="episode-card-main"
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <div className="episode-thumb">
                    {e.thumb ? (
                      <img src={e.thumb} alt="" loading="lazy" />
                    ) : (
                      <div className="episode-thumb-fallback" aria-hidden="true">
                        ▶
                      </div>
                    )}
                  </div>
                  <div className="episode-body">
                    <div className="episode-title-row">
                      <h2 className="episode-title">{e.title}</h2>
                      <span className="pill pill-status">
                        <span className="pill-icon" aria-hidden="true">
                          {STATUS_ICON[e.status] || "·"}
                        </span>
                        <span className="pill-label">{statusPt(e.status)}</span>
                      </span>
                    </div>
                    <div className="episode-meta">
                      {e.format && <span>{e.format}</span>}
                      {e.length && <span>{e.length}</span>}
                      {e.date && <span>{e.date}</span>}
                    </div>
                  </div>
                </button>

                {open && (
                  <div className="episode-details">
                    <div className="episode-detail-grid">
                      <div>
                        <div className="detail-label">Status</div>
                        <span>{statusPt(e.status)}</span>
                      </div>
                      <div>
                        <div className="detail-label">Formato</div>
                        <span>{e.format || "—"}</span>
                      </div>
                      <div>
                        <div className="detail-label">Duração</div>
                        <span>{e.length || "—"}</span>
                      </div>
                      <div>
                        <div className="detail-label">Data</div>
                        <span>{e.date || "—"}</span>
                      </div>
                      {href && (
                        <div>
                          <div className="detail-label">No Creators</div>
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="detail-link"
                          >
                            Abrir episódio
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ gap: "0.35rem", marginTop: "0.75rem" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => del(e.title)}
                      >
                        Excluir
                      </button>
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
