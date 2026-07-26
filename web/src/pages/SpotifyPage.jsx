import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { formatLocalDateTime } from "../format";
import { useToast } from "../toast/ToastProvider.jsx";
import { FilterChips } from "../components/FilterChips.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { Thumb } from "../components/Thumb.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { IconRefresh } from "../icons.jsx";

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
  const toast = useToast();
  const [show, setShow] = useState(null);
  const [session, setSession] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingCache, setLoadingCache] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
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
      toast.ok(
        data.fromCache
          ? `${n} episódio(s) em cache`
          : `${n} episódio(s) atualizados do Creators`
      );
    }
  };

  const refreshRemote = async ({ silent } = {}) => {
    setBusy(true);
    try {
      const data = await api.spotifyEpisodes({ refresh: true });
      applyCatalog({ ...data, fromCache: false }, { silent });
      refreshSession?.();
    } catch (e) {
      toast.error(e.message);
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
        if (!cancelled) toast.error(e.message);
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
    // Mount-only: this is the initial catalog load. Re-running it on every
    // applyCatalog identity change would re-scrape the Creators site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmDelete = async () => {
    const title = pendingDelete;
    setBusy(true);
    try {
      await api.deleteSpotifyEpisode(title);
      setEpisodes((prev) => prev.filter((e) => e.title !== title));
      setPendingDelete(null);
      toast.ok(`Excluído: ${title}`);
    } catch (e) {
      toast.error(e.message);
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

  const showImage =
    typeof show?.imageUrl === "string" && show.imageUrl.startsWith("http")
      ? show.imageUrl
      : null;

  return (
    <div>
      {/* The show itself is the header now, instead of a metadata grid. */}
      <header className="show-header">
        <span className="show-header-art">
          <Thumb
            src={showImage}
            fallbackText={(showName || "?").slice(0, 1).toUpperCase()}
          />
        </span>
        <div className="show-header-meta">
          <h1 className="show-header-name">{showName || "Seu programa"}</h1>
          <div className="show-header-chips">
            {show?.episodesUrl && (
              <a
                className="chip chip-link"
                href={show.episodesUrl}
                target="_blank"
                rel="noreferrer"
              >
                Episódios ↗
              </a>
            )}
            <span className={`chip ${session == null ? "" : session.ok ? "ok" : "bad"}`}>
              {session == null
                ? "Verificando…"
                : session.ok
                  ? `Sessão ok · ${session.cookieCount} cookies`
                  : "Sessão ausente"}
            </span>
            {/* Show ID matters only when something is wrong — keep it reachable
                but out of the way. */}
            <details className="show-id-details">
              <summary className="chip chip-quiet">Detalhes técnicos</summary>
              <div className="show-id-panel">
                <div className="detail-label">Show ID</div>
                <code>{show?.showId || "—"}</code>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="filters-bar">
        {episodes.length > 0 && (
          <FilterChips
            label="Filtrar por status"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            counts={counts}
          />
        )}
        <div className="filters-bar-end">
          {episodes.length > 0 && (
            <input
              type="search"
              className="filter-search"
              aria-label="Buscar episódios pelo título"
              placeholder="Buscar título…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <button
            type="button"
            className={`icon-btn ${busy ? "is-spinning" : ""}`}
            disabled={busy || loadingCache}
            title={
              fetchedAt
                ? `Atualizar — ${fromCache ? "cache" : "ao vivo"} de ${formatLocalDateTime(fetchedAt)}`
                : "Atualizar do Creators"
            }
            aria-label="Atualizar lista do Creators"
            onClick={() => refreshRemote()}
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      <div className="episode-list">
        {filtered.length === 0 ? (
          loadingCache || busy ? (
            <>
              <p className="loading-note" role="status">
                Carregando episódios do Creators…
              </p>
              <Skeleton.Group as="row" count={5} label="Carregando episódios…" />
            </>
          ) : (
            <div className="empty-hint">
              {episodes.length === 0
                ? "Nenhum episódio em cache. Clique em Atualizar."
                : "Nenhum episódio neste filtro."}
            </div>
          )
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
                    <Thumb src={e.thumb} fallbackText="▶" />
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
                    <div className="row episode-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setPendingDelete(e.title)}
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

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir episódio?"
          message={`“${pendingDelete}” será removido do Spotify for Creators. Não dá pra desfazer.`}
          confirmLabel="Excluir"
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
