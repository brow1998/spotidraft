import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import {
  clearFavoriteChannel,
  loadFavoriteChannel,
  saveFavoriteChannel,
} from "../favoriteChannel";
import { loadHomeViewMode, saveHomeViewMode } from "../homePrefs";
import {
  IconCheckAll,
  IconChevronLeft,
  IconClearAll,
  IconCog,
  IconExternal,
  IconGrid,
  IconList,
  IconRefresh,
  IconSend,
  IconStarOff,
  IconSwap,
} from "../icons";

const PAGE = 12;

function fmtDur(sec) {
  if (sec == null) return "—";
  const s = Math.round(Number(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

function ytThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export default function HomePage() {
  const nav = useNavigate();
  const [url, setUrl] = useState("https://www.youtube.com/@canalgweek");
  const [channel, setChannel] = useState(null);
  const [recentVideos, setRecentVideos] = useState([]);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [tab, setTab] = useState("recent");
  const [playlistFocus, setPlaylistFocus] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msg, setMsg] = useState(null);
  const [favoritePrompt, setFavoritePrompt] = useState(null);
  const [favorite, setFavorite] = useState(() => loadFavoriteChannel());
  const [audioOnly, setAudioOnly] = useState(false);
  const [withThumb, setWithThumb] = useState(true);
  const [withDescription, setWithDescription] = useState(true);
  const [maxHeight, setMaxHeight] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [descBusy, setDescBusy] = useState(null);
  const [viewMode, setViewMode] = useState(() => loadHomeViewMode());
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);

  const videos = tab === "playlist" ? playlistVideos : recentVideos;
  const allSelected = videos.length > 0 && selected.size === videos.length;

  const patchVideo = useCallback((id, patch) => {
    const apply = (list) =>
      list.map((v) => (v.id === id ? { ...v, ...patch } : v));
    setRecentVideos(apply);
    setPlaylistVideos(apply);
  }, []);

  const openChannel = async (rawUrl, { askFavorite = true } = {}) => {
    setBusy(true);
    setMsg(null);
    setPlaylistFocus(null);
    setPlaylistVideos([]);
    setTab("recent");
    setSelected(new Set());
    setExpanded(null);
    try {
      const data = await api.youtubeChannel(rawUrl.trim(), {
        videoLimit: PAGE,
        videoOffset: 0,
      });
      setChannel(data.channel);
      setRecentVideos(data.videos || []);
      setRecentHasMore(Boolean(data.hasMore));
      setPlaylists(data.playlists || []);
      setSelected(new Set());
      setMsg({
        type: "ok",
        text: `${(data.videos || []).length} recentes · ${(data.playlists || []).length} playlists`,
      });

      const fav = loadFavoriteChannel();
      const same =
        fav &&
        (fav.url === data.channel.url ||
          fav.id === data.channel.id ||
          fav.handle === data.channel.handle);
      if (askFavorite && !same) {
        setFavoritePrompt(data.channel);
      }
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const loadMoreRecent = useCallback(async () => {
    if (!channel?.url || !recentHasMore || loadingMoreRef.current || busy) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const data = await api.youtubeChannel(channel.url, {
        videoLimit: PAGE,
        videoOffset: recentVideos.length,
        videosOnly: true,
      });
      const incoming = data.videos || [];
      setRecentVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        const merged = [...prev];
        for (const v of incoming) {
          if (!seen.has(v.id)) merged.push(v);
        }
        return merged;
      });
      setRecentHasMore(Boolean(data.hasMore) && incoming.length > 0);
    } catch (e) {
      setMsg({ type: "error", text: e.message });
      setRecentHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [channel?.url, recentHasMore, recentVideos.length, busy]);

  useEffect(() => {
    const fav = loadFavoriteChannel();
    setFavorite(fav);
    if (fav?.url) {
      setUrl(fav.url);
      openChannel(fav.url, { askFavorite: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== "recent" || !recentHasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRecent();
      },
      { rootMargin: "240px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [tab, recentHasMore, loadMoreRecent, recentVideos.length]);

  const openPlaylist = async (pl) => {
    setBusy(true);
    setMsg(null);
    setExpanded(null);
    try {
      const data = await api.listYoutube(pl.url, undefined, { flat: true });
      setPlaylistVideos(data.videos || []);
      setSelected(new Set());
      setPlaylistFocus(pl);
      setTab("playlist");
      setMsg({
        type: "ok",
        text: `${(data.videos || []).length} vídeo(s) em “${pl.title}”`,
      });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const backToPlaylists = () => {
    setTab("playlists");
    setPlaylistFocus(null);
    setPlaylistVideos([]);
    setSelected(new Set());
    setExpanded(null);
  };

  const goRecent = () => {
    setTab("recent");
    setPlaylistFocus(null);
    setExpanded(null);
  };

  const goPlaylists = () => {
    setTab("playlists");
    setPlaylistFocus(null);
    setPlaylistVideos([]);
    setSelected(new Set());
    setExpanded(null);
  };

  const toggle = (id) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(videos.map((v) => v.id)));
  };

  const setView = (mode) => {
    setViewMode(saveHomeViewMode(mode));
  };

  const expandVideo = async (v) => {
    const open = expanded === v.id;
    if (open) {
      setExpanded(null);
      return;
    }
    setExpanded(v.id);
    if (v.description) return;
    setDescBusy(v.id);
    try {
      const data = await api.youtubeVideo(v.id);
      if (data.video) {
        patchVideo(v.id, {
          description: data.video.description || "",
          duration: data.video.duration ?? v.duration,
          thumb: data.video.thumb || v.thumb,
        });
      }
    } catch (e) {
      patchVideo(v.id, {
        description: `(Não foi possível carregar a descrição: ${e.message})`,
      });
    } finally {
      setDescBusy(null);
    }
  };

  const startImport = async (idsOverride) => {
    const ids = Array.isArray(idsOverride) ? idsOverride : [...selected];
    if (!channel?.url || ids.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const titles = {};
      for (const v of videos) {
        if (ids.includes(v.id)) titles[v.id] = v.title;
      }
      const sourceUrl =
        playlistFocus?.url ||
        videos.find((v) => ids.includes(v.id))?.url ||
        channel.url;
      const data = await api.importVideos({
        url: sourceUrl,
        videoIds: ids,
        titles,
        audioOnly,
        withThumb,
        withDescription,
        maxHeight: maxHeight ? Number(maxHeight) : null,
      });
      setMsg({
        type: "ok",
        text: `Job ${data.jobId.slice(0, 8)}… — ${ids.length} vídeo(s) a caminho do Spotify. Acompanhe em Progresso.`,
      });
      nav("/progress");
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const sendOne = (v) => {
    if (!selected.has(v.id)) {
      setSelected((prev) => new Set(prev).add(v.id));
    }
    return startImport([v.id]);
  };

  const acceptFavorite = () => {
    if (!favoritePrompt) return;
    const saved = saveFavoriteChannel(favoritePrompt);
    setFavorite(saved);
    setFavoritePrompt(null);
  };

  const declineFavorite = () => setFavoritePrompt(null);

  const removeFavorite = () => {
    clearFavoriteChannel();
    setFavorite(null);
  };

  const selectedCount = selected.size;
  const listTitle = useMemo(() => {
    if (tab === "playlist" && playlistFocus) return playlistFocus.title;
    if (tab === "recent") return "Vídeos recentes";
    return "Playlists";
  }, [tab, playlistFocus]);

  const isFav =
    channel &&
    (favorite?.url === channel.url ||
      favorite?.id === channel.id ||
      favorite?.handle === channel.handle);

  return (
    <div className="home-page">
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      {!channel && (
        <div className="field">
          <label htmlFor="channel-url">Canal do YouTube</label>
          <div className="url-row">
            <input
              id="channel-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !busy) openChannel(url);
              }}
              placeholder="https://www.youtube.com/@canalgweek"
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !url.trim()}
              onClick={() => openChannel(url)}
            >
              {busy ? "Abrindo…" : "Abrir"}
            </button>
          </div>
        </div>
      )}

      {channel && (
        <>
          <div className="channel-header">
            <div className="channel-header-main">
              <div className="channel-avatar">
                {channel.thumb ? (
                  <img src={channel.thumb} alt="" />
                ) : (
                  <span>{(channel.title || "?").slice(0, 1)}</span>
                )}
              </div>
              <div className="channel-meta">
                <div className="channel-title-row">
                  <h1 className="channel-title">{channel.title}</h1>
                  <a
                    className="icon-btn"
                    href={channel.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir no YouTube"
                    aria-label="Abrir no YouTube"
                  >
                    <IconExternal />
                  </a>
                </div>
                <div className="channel-sub">
                  {channel.handle && <span>{channel.handle}</span>}
                  {isFav ? <span className="chip ok">★</span> : null}
                </div>
              </div>
            </div>
            <div className="icon-btn-row">
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                title="Atualizar"
                aria-label="Atualizar canal"
                onClick={() => openChannel(channel.url, { askFavorite: false })}
              >
                <IconRefresh />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Trocar canal"
                aria-label="Trocar canal"
                onClick={() => {
                  setChannel(null);
                  setRecentVideos([]);
                  setPlaylists([]);
                  setPlaylistFocus(null);
                  setPlaylistVideos([]);
                }}
              >
                <IconSwap />
              </button>
              {isFav && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Remover favorito"
                  aria-label="Remover favorito"
                  onClick={removeFavorite}
                >
                  <IconStarOff />
                </button>
              )}
            </div>
          </div>

          <div className="filter-chips" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className={`filter-chip ${tab === "recent" ? "active" : ""}`}
              onClick={goRecent}
            >
              Recentes
            </button>
            <button
              type="button"
              className={`filter-chip ${tab === "playlists" || tab === "playlist" ? "active" : ""}`}
              onClick={goPlaylists}
            >
              Playlists
              <span className="filter-count">{playlists.length}</span>
            </button>
          </div>

          {tab === "playlist" && playlistFocus && (
            <div className="playlist-crumb">
              <button
                type="button"
                className="icon-btn"
                onClick={backToPlaylists}
                title="Voltar às playlists"
                aria-label="Voltar às playlists"
              >
                <IconChevronLeft />
              </button>
              <strong className="playlist-crumb-title">{playlistFocus.title}</strong>
            </div>
          )}

          {tab === "playlists" && (
            <>
              <div className="home-toolbar">
                <strong className="home-toolbar-title">Playlists</strong>
                <div className="toolbar-actions">
                  <div className="view-toggle" role="group" aria-label="Visualização">
                    <button
                      type="button"
                      className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`}
                      onClick={() => setView("list")}
                      title="Lista"
                      aria-label="Lista"
                      aria-pressed={viewMode === "list"}
                    >
                      <IconList size={16} />
                    </button>
                    <button
                      type="button"
                      className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
                      onClick={() => setView("grid")}
                      title="Grade"
                      aria-label="Grade"
                      aria-pressed={viewMode === "grid"}
                    >
                      <IconGrid size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <div
                className={`yt-shelf ${viewMode === "list" ? "yt-shelf-list" : "yt-shelf-grid"}`}
              >
                {playlists.length === 0 ? (
                  <div className="empty-hint">Nenhuma playlist encontrada.</div>
                ) : (
                  playlists.map((pl) => (
                    <article key={pl.id} className="yt-card yt-card-playlist">
                      <button
                        type="button"
                        className="yt-card-hit"
                        onClick={() => openPlaylist(pl)}
                        disabled={busy}
                      >
                        <div className="yt-thumb">
                          {pl.thumb ? (
                            <img src={pl.thumb} alt="" loading="lazy" />
                          ) : (
                            <div className="yt-thumb-fallback" aria-hidden="true">
                              ▤
                            </div>
                          )}
                          <div className="yt-thumb-shade" aria-hidden="true" />
                          <span className="yt-pl-count">
                            {pl.count != null ? `${pl.count}` : "PL"}
                          </span>
                        </div>
                        <div className="yt-info">
                          <h2 className="yt-title">{pl.title}</h2>
                          <div className="yt-sub">Playlist</div>
                        </div>
                      </button>
                    </article>
                  ))
                )}
              </div>
            </>
          )}

          {(tab === "recent" || tab === "playlist") && (
            <>
              <div className="home-toolbar">
                <strong className="home-toolbar-title">{listTitle}</strong>
                <div className="toolbar-actions">
                  <span className="toolbar-count" title="Selecionados">
                    {selectedCount}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={toggleAll}
                    title={allSelected ? "Desmarcar todos" : "Selecionar todos"}
                    aria-label={allSelected ? "Desmarcar todos" : "Selecionar todos"}
                  >
                    {allSelected ? <IconClearAll /> : <IconCheckAll />}
                  </button>
                  <div className="view-toggle" role="group" aria-label="Visualização">
                    <button
                      type="button"
                      className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`}
                      onClick={() => setView("list")}
                      title="Lista"
                      aria-label="Lista"
                      aria-pressed={viewMode === "list"}
                    >
                      <IconList size={16} />
                    </button>
                    <button
                      type="button"
                      className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
                      onClick={() => setView("grid")}
                      title="Grade"
                      aria-label="Grade"
                      aria-pressed={viewMode === "grid"}
                    >
                      <IconGrid size={16} />
                    </button>
                  </div>
                  <details className="icon-menu">
                    <summary
                      className="icon-btn"
                      title="Opções de download"
                      aria-label="Opções de download"
                    >
                      <IconCog />
                    </summary>
                    <div className="icon-menu-panel">
                      <div className="options options-compact">
                        <label>
                          <input
                            type="checkbox"
                            checked={audioOnly}
                            onChange={(e) => setAudioOnly(e.target.checked)}
                          />
                          Só áudio
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={withThumb}
                            onChange={(e) => setWithThumb(e.target.checked)}
                            disabled={audioOnly}
                          />
                          Thumbnail
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={withDescription}
                            onChange={(e) => setWithDescription(e.target.checked)}
                          />
                          Descrição
                        </label>
                        <label className="options-quality">
                          Qualidade
                          <select
                            value={maxHeight}
                            onChange={(e) => setMaxHeight(e.target.value)}
                            disabled={audioOnly}
                          >
                            <option value="">Melhor</option>
                            <option value="1080">≤ 1080p</option>
                            <option value="720">≤ 720p</option>
                            <option value="480">≤ 480p</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              <div
                className={`yt-shelf ${viewMode === "list" ? "yt-shelf-list" : "yt-shelf-grid"}`}
              >
                {videos.length === 0 ? (
                  <div className="empty-hint">
                    {busy ? "Carregando…" : "Nenhum vídeo nesta lista."}
                  </div>
                ) : (
                  videos.map((v) => {
                    const open = expanded === v.id;
                    const isOn = selected.has(v.id);
                    const watch =
                      v.url || `https://www.youtube.com/watch?v=${v.id}`;
                    return (
                      <article
                        key={v.id}
                        className={`yt-card ${open ? "open" : ""} ${isOn ? "selected" : ""}`}
                      >
                        <div className="yt-card-stack">
                          <label
                            className="yt-select"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => toggle(v.id)}
                              aria-label={`Selecionar ${v.title}`}
                            />
                          </label>
                          <button
                            type="button"
                            className="yt-card-hit"
                            onClick={() => expandVideo(v)}
                          >
                            <div className="yt-thumb">
                              <img
                                src={v.thumb || ytThumb(v.id)}
                                alt=""
                                loading="lazy"
                              />
                              {v.duration != null && (
                                <span className="yt-duration">{fmtDur(v.duration)}</span>
                              )}
                            </div>
                            <div className="yt-info">
                              <h2 className="yt-title">{v.title}</h2>
                              <div className="yt-sub">
                                {fmtDur(v.duration)}
                                {channel?.title ? ` · ${channel.title}` : ""}
                              </div>
                            </div>
                          </button>
                        </div>
                        {open && (
                          <div className="yt-details episode-details">
                            <div className="episode-detail-grid">
                              <div>
                                <div className="detail-label">YouTube</div>
                                <a
                                  href={watch}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="detail-link"
                                >
                                  {watch}
                                </a>
                              </div>
                              <div>
                                <div className="detail-label">Duração</div>
                                <span>{fmtDur(v.duration)}</span>
                              </div>
                            </div>
                            <div className="episode-desc">
                              <div className="detail-label">Descrição</div>
                              {descBusy === v.id ? (
                                <p>Carregando descrição…</p>
                              ) : (
                                <p>{v.description || "Sem descrição."}</p>
                              )}
                            </div>
                            <div className="yt-detail-actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-with-icon"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sendOne(v);
                                }}
                              >
                                <IconSend size={16} />
                                Enviar pro Spotify
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(v.id);
                                }}
                              >
                                {isOn ? "Remover da fila" : "Adicionar à fila"}
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              {tab === "recent" && (
                <div ref={sentinelRef} className="infinite-sentinel">
                  {loadingMore
                    ? "Carregando mais…"
                    : recentHasMore
                      ? ""
                      : videos.length > 0
                        ? "Fim dos recentes"
                        : null}
                </div>
              )}

              {selectedCount > 0 && (
                <div className="queue-bar" role="region" aria-label="Fila de envio">
                  <div className="queue-bar-copy">
                    <strong>{selectedCount}</strong>
                    <span>
                      {selectedCount === 1
                        ? "vídeo na fila"
                        : "vídeos na fila"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-with-icon"
                    disabled={busy}
                    onClick={() => startImport()}
                  >
                    <IconSend size={16} />
                    Enviar pro Spotify
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {favoritePrompt && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-labelledby="fav-title">
            <h2 id="fav-title">Salvar como favorito?</h2>
            <p>
              Quer lembrar <strong>{favoritePrompt.title}</strong> na Home nas
              próximas vezes?
            </p>
            <div className="row" style={{ gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={acceptFavorite}
              >
                Salvar
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={declineFavorite}
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
