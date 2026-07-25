import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

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

/** Playlist / canal / lista — não vídeo solto. */
export function isListUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.searchParams.get("list")) return true;
    const p = u.pathname;
    if (p.includes("/playlist")) return true;
    if (p.includes("/channel/")) return true;
    if (p.includes("/c/")) return true;
    if (p.includes("/user/")) return true;
    if (p.startsWith("/@")) return true;
    if (p.includes("/videos")) return true;
    return false;
  } catch {
    return false;
  }
}

export default function ImportPage() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState("");
  const [videos, setVideos] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [audioOnly, setAudioOnly] = useState(false);
  const [withThumb, setWithThumb] = useState(true);
  const [withDescription, setWithDescription] = useState(true);
  const [maxHeight, setMaxHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const showLimit = useMemo(
    () => isListUrl(url) || videos.length > 1,
    [url, videos.length]
  );
  const allSelected = videos.length > 0 && selected.size === videos.length;

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

  const list = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const lim = showLimit && limit ? Number(limit) : undefined;
      const data = await api.listYoutube(url.trim(), lim);
      setVideos(data.videos || []);
      setSelected(new Set((data.videos || []).map((v) => v.id)));
      setExpanded(null);
      setMsg({ type: "ok", text: `${data.count} vídeo(s) encontrados` });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const startImport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ids = [...selected];
      const titles = {};
      for (const v of videos) {
        if (ids.includes(v.id)) titles[v.id] = v.title;
      }
      const data = await api.importVideos({
        url: url.trim(),
        videoIds: ids,
        titles,
        audioOnly,
        withThumb,
        withDescription,
        maxHeight: maxHeight ? Number(maxHeight) : null,
      });
      setMsg({
        type: "ok",
        text: `Job ${data.jobId.slice(0, 8)}… iniciado no servidor. Acompanhe em Progresso.`,
      });
      nav("/progress");
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <div>
      <h1>Importar</h1>
      <p>
        Cole um link de vídeo, playlist ou canal. Revise a lista antes de enviar
        como draft.
      </p>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
      <div className="field">
        <label htmlFor="url">URL do YouTube</label>
        <div className="url-row">
          <input
            id="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setVideos([]);
              setSelected(new Set());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !busy) list();
            }}
            placeholder="https://www.youtube.com/..."
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !url.trim()}
            onClick={list}
          >
            {busy ? "Listando…" : "Listar"}
          </button>
        </div>
      </div>
      {showLimit && (
        <div className="field field-inline">
          <label htmlFor="limit">Limite (opcional)</label>
          <input
            id="limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="ex. 10"
            inputMode="numeric"
          />
        </div>
      )}

      {videos.length > 0 && (
        <>
          <div className="options">
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
            <label>
              Qualidade
              <select
                value={maxHeight}
                onChange={(e) => setMaxHeight(e.target.value)}
                disabled={audioOnly}
                style={{ marginLeft: 8 }}
              >
                <option value="">Melhor</option>
                <option value="1080">≤ 1080p</option>
                <option value="720">≤ 720p</option>
                <option value="480">≤ 480p</option>
              </select>
            </label>
          </div>

          <div className="row" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={toggleAll}>
              {allSelected ? "Desmarcar todos" : "Selecionar todos"}
            </button>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {selectedCount} de {videos.length} selecionados
            </span>
          </div>

          <div className="episode-list">
            {videos.map((v) => {
              const open = expanded === v.id;
              const isOn = selected.has(v.id);
              const watch = v.url || `https://www.youtube.com/watch?v=${v.id}`;
              return (
                <article
                  key={v.id}
                  className={`episode-card ${open ? "open" : ""} ${isOn ? "selected" : ""}`}
                >
                  <div className="episode-card-main import-card-main">
                    <label
                      className="import-check"
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
                      className="import-card-btn"
                      onClick={() => setExpanded(open ? null : v.id)}
                    >
                      <div className="episode-thumb">
                        <img src={ytThumb(v.id)} alt="" loading="lazy" />
                      </div>
                      <div className="episode-body">
                        <div className="episode-title-row">
                          <h2 className="episode-title">{v.title}</h2>
                        </div>
                        <div className="episode-meta">
                          <span>{fmtDur(v.duration)}</span>
                          <span>{v.id}</span>
                        </div>
                        {v.description?.trim() ? (
                          <p className="episode-desc-preview">
                            {v.description.trim().slice(0, 140)}
                            {v.description.trim().length > 140 ? "…" : ""}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </div>

                  {open && (
                    <div className="episode-details">
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
                          <div className="detail-label">ID</div>
                          <code>{v.id}</code>
                        </div>
                        <div>
                          <div className="detail-label">Duração</div>
                          <span>{fmtDur(v.duration)}</span>
                        </div>
                      </div>
                      <div className="episode-desc">
                        <div className="detail-label">Descrição</div>
                        <p>
                          {v.description?.trim()
                            ? v.description
                            : "Sem descrição disponível."}
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: "1rem" }}
            disabled={busy || selectedCount === 0}
            onClick={startImport}
          >
            Enviar {selectedCount} como draft
          </button>
        </>
      )}
    </div>
  );
}
