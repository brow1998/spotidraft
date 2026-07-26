import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  forgetChannel,
  isSameChannel,
  lastChannel,
  loadChannels,
  rememberChannel,
  setLastChannel,
} from "../channels";
import { loadHomeViewMode, saveHomeViewMode } from "../homePrefs";
import { formatDuration as fmtDur } from "../format";
import { isChannelQuery, ytThumb } from "../lib/youtube";
import { ChannelSwitcher } from "../components/ChannelSwitcher.jsx";
import { useToast } from "../toast/ToastProvider.jsx";
import { useImportRunner } from "../hooks/useImportRunner.js";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DownloadOptions,
} from "../components/DownloadOptions.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { Thumb } from "../components/Thumb.jsx";
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
  IconStar,
} from "../icons";

const PAGE = 12;

export default function HomePage() {
  const toast = useToast();
  const { run: runImport, busy: importing } = useImportRunner();
  const [url, setUrl] = useState("");
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
  const [channels, setChannels] = useState(() => loadChannels());
  const [options, setOptions] = useState(DEFAULT_DOWNLOAD_OPTIONS);
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

  const openChannel = async (rawUrl, { refresh = false } = {}) => {
    // Fail fast on a typo instead of spending half a minute in yt-dlp first.
    // Accepts "@handle" and a bare name too — the server normalizes those.
    if (!isChannelQuery(rawUrl)) {
      toast.error("Digite um @handle ou o link de um canal do YouTube.");
      return;
    }
    setBusy(true);
    setPlaylistFocus(null);
    setPlaylistVideos([]);
    setTab("recent");
    setSelected(new Set());
    setExpanded(null);
    try {
      const data = await api.youtubeChannel(rawUrl.trim(), {
        videoLimit: PAGE,
        videoOffset: 0,
        refresh,
      });
      setChannel(data.channel);
      setRecentVideos(data.videos || []);
      setRecentHasMore(Boolean(data.hasMore));
      setPlaylists(data.playlists || []);
      setSelected(new Set());

      // Opening a channel is intent enough — remember it silently and let the
      // star be the way out, instead of interrupting with a dialog every time.
      setChannels(rememberChannel(data.channel));
      setLastChannel(data.channel);
    } catch (e) {
      toast.error(e.message);
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
      toast.error(e.message);
      setRecentHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [channel?.url, recentHasMore, recentVideos.length, busy, toast]);

  useEffect(() => {
    const last = lastChannel();
    if (last?.url) {
      setUrl(last.url);
      openChannel(last.url);
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
    setExpanded(null);
    try {
      const data = await api.listYoutube(pl.url, undefined, { flat: true });
      setPlaylistVideos(data.videos || []);
      setSelected(new Set());
      setPlaylistFocus(pl);
      setTab("playlist");
    } catch (e) {
      toast.error(e.message);
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
      // Writing the error into `description` made a failure look like content.
      toast.error(`Não consegui carregar a descrição: ${e.message}`);
    } finally {
      setDescBusy(null);
    }
  };

  const startImport = (idsOverride) => {
    const ids = Array.isArray(idsOverride) ? idsOverride : [...selected];
    if (!channel?.url || ids.length === 0) return;
    const titles = {};
    for (const v of videos) {
      if (ids.includes(v.id)) titles[v.id] = v.title;
    }
    // This cascade is Home-specific — a playlist import must be attributed to
    // the playlist, not the channel — so it stays here rather than in the hook.
    const sourceUrl =
      playlistFocus?.url ||
      videos.find((v) => ids.includes(v.id))?.url ||
      channel.url;
    return runImport({ url: sourceUrl, ids, titles, options });
  };

  const sendOne = (v) => {
    if (!selected.has(v.id)) {
      setSelected((prev) => new Set(prev).add(v.id));
    }
    return startImport([v.id]);
  };

  const toggleFavorite = () => {
    if (!channel) return;
    if (isFav) {
      setChannels(forgetChannel(channel));
      toast.info(`${channel.title} não será mais lembrado.`);
    } else {
      setChannels(rememberChannel(channel));
      toast.ok(`${channel.title} salvo nos canais.`);
    }
  };

  const clearChannel = () => {
    setChannel(null);
    setRecentVideos([]);
    setPlaylists([]);
    setPlaylistFocus(null);
    setPlaylistVideos([]);
    setSelected(new Set());
    setUrl("");
  };

  const pickChannel = (c) => {
    setUrl(c.url);
    setLastChannel(c);
    openChannel(c.url);
  };

  const forgetOne = (c) => {
    setChannels(forgetChannel(c));
    toast.info(`${c.title} removido.`);
  };

  const selectedCount = selected.size;
  const listTitle = useMemo(() => {
    if (tab === "playlist" && playlistFocus) return playlistFocus.title;
    if (tab === "recent") return "Vídeos recentes";
    return "Playlists";
  }, [tab, playlistFocus]);

  const isFav = Boolean(
    channel && channels.some((c) => isSameChannel(c, channel))
  );

  return (
    <div className="home-page">
      {!channel && (
        <>
          {/* The page had no h1 at all until a channel loaded. */}
          <h1>Escolha um canal</h1>
          <p>
            Cole o link de um canal do YouTube para ver os vídeos e mandar pro
            Spotify como rascunho.
          </p>
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
                placeholder="@canalgweek ou youtube.com/@canalgweek"
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
            <p className="field-hint">
              Aceita @handle, nome do canal ou link completo.
            </p>
          </div>

          {channels.length > 0 && !busy && (
            <section className="saved-channels">
              <h2 className="saved-channels-title">Seus canais</h2>
              <div className="saved-channels-grid">
                {channels.map((c) => (
                  <div className="saved-channel" key={c.url}>
                    <button
                      type="button"
                      className="saved-channel-hit"
                      onClick={() => pickChannel(c)}
                    >
                      <span className="saved-channel-avatar">
                        <Thumb
                          src={c.thumb}
                          fallbackText={(c.title || "?").slice(0, 1).toUpperCase()}
                        />
                      </span>
                      <span className="saved-channel-meta">
                        <span className="saved-channel-name">{c.title}</span>
                        {c.handle && (
                          <span className="saved-channel-handle">{c.handle}</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm saved-channel-forget"
                      title={`Esquecer ${c.title}`}
                      aria-label={`Esquecer ${c.title}`}
                      onClick={() => forgetOne(c)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {busy && (
            <>
              {/* Resolving a channel runs three yt-dlp processes and can take
                  half a minute — show the shape of what's coming. */}
              <p className="loading-note" role="status">
                Consultando o YouTube… isso pode levar alguns segundos.
              </p>
              <Skeleton.Group count={6} label="Carregando vídeos do canal…" />
            </>
          )}
        </>
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
                </div>
              </div>
            </div>
            <div className="icon-btn-row">
              <ChannelSwitcher
                channels={channels}
                current={channel}
                onPick={pickChannel}
                onForget={forgetOne}
                onSearchNew={clearChannel}
              />
              {/* One control for the remembered state instead of a chip plus a
                  separate remove button taking two slots. */}
              <button
                type="button"
                className={`icon-btn icon-btn-star ${isFav ? "is-fav" : ""}`}
                title={isFav ? "Esquecer este canal" : "Lembrar este canal"}
                aria-label={isFav ? "Esquecer este canal" : "Lembrar este canal"}
                aria-pressed={isFav}
                onClick={toggleFavorite}
              >
                <IconStar filled={isFav} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                title="Atualizar"
                aria-label="Atualizar canal"
                onClick={() => openChannel(channel.url, { refresh: true })}
              >
                <IconRefresh />
              </button>
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
                          <Thumb src={pl.thumb} fallbackText="▤" />
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
                      <DownloadOptions value={options} onChange={setOptions} compact />
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
                            aria-expanded={open}
                          >
                            <div className="yt-thumb">
                              <Thumb
                                src={v.thumb || ytThumb(v.id)}
                                fallbackText="▶"
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

                          {/* Actions live over the thumb on hover; the rest of
                              the card stays a plain click-to-expand target. */}
                          <div className="yt-hover-actions">
                            <button
                              type="button"
                              className="yt-hover-btn"
                              disabled={busy || importing}
                              title="Enviar direto pro Spotify"
                              aria-label={`Enviar ${v.title} pro Spotify`}
                              onClick={(e) => {
                                e.stopPropagation();
                                sendOne(v);
                              }}
                            >
                              <IconSend size={15} />
                              Enviar
                            </button>
                            <button
                              type="button"
                              className={`yt-hover-btn ghost ${isOn ? "on" : ""}`}
                              title={isOn ? "Remover da fila" : "Adicionar à fila"}
                              aria-label={
                                isOn
                                  ? `Remover ${v.title} da fila`
                                  : `Adicionar ${v.title} à fila`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(v.id);
                              }}
                            >
                              {isOn ? "✓ Na fila" : "+ Fila"}
                            </button>
                          </div>
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
                <div className="queue-bar" role="region" aria-label="Seleção">
                  <div className="queue-bar-left">
                    <span className="queue-bar-count" aria-hidden="true">
                      {selectedCount}
                    </span>
                    <span className="queue-bar-copy">
                      <strong>
                        {selectedCount === 1
                          ? "1 vídeo selecionado"
                          : `${selectedCount} vídeos selecionados`}
                      </strong>
                      <span className="queue-bar-hint">
                        vão pro Spotify como rascunho
                      </span>
                    </span>
                  </div>
                  <div className="queue-bar-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelected(new Set())}
                    >
                      Limpar
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-with-icon"
                      disabled={busy || importing}
                      onClick={() => startImport()}
                    >
                      <IconSend size={16} />
                      {importing ? "Enviando…" : "Enviar pro Spotify"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

    </div>
  );
}
