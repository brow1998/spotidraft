import { useMemo, useState } from "react";
import { api } from "../api";
import { formatDuration as fmtDur } from "../format";
import { isListUrl, isYoutubeUrl, watchUrl, ytThumb } from "../lib/youtube";
import { useToast } from "../toast/ToastProvider.jsx";
import { useImportRunner } from "../hooks/useImportRunner.js";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DownloadOptions,
} from "../components/DownloadOptions.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { Thumb } from "../components/Thumb.jsx";

export default function ImportPage() {
  const toast = useToast();
  const { run: runImport, busy: importing } = useImportRunner();
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState("");
  const [videos, setVideos] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [options, setOptions] = useState(DEFAULT_DOWNLOAD_OPTIONS);
  const [busy, setBusy] = useState(false);
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
    if (!isYoutubeUrl(url)) {
      toast.error("Isso não parece um link do YouTube.");
      return;
    }
    setBusy(true);
    try {
      // The field is free text, so guard against "abc" reaching the API as NaN.
      const parsed = Number(limit);
      const lim =
        showLimit && limit && Number.isFinite(parsed) && parsed > 0
          ? Math.floor(parsed)
          : undefined;
      const data = await api.listYoutube(url.trim(), lim);
      setVideos(data.videos || []);
      setSelected(new Set((data.videos || []).map((v) => v.id)));
      setExpanded(null);
      toast.ok(`${data.count} vídeo(s) encontrados.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startImport = () => {
    const ids = [...selected];
    const titles = {};
    for (const v of videos) {
      if (ids.includes(v.id)) titles[v.id] = v.title;
    }
    return runImport({ url: url.trim(), ids, titles, options });
  };

  const selectedCount = selected.size;

  return (
    <div>
      <h1>Importar</h1>
      <p>
        Cole um link de vídeo, playlist ou canal. Revise a lista antes de enviar
        como draft.
      </p>
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
            type="number"
            min="1"
            step="1"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="ex. 10"
            inputMode="numeric"
          />
        </div>
      )}

      {videos.length > 0 && (
        <>
          <DownloadOptions value={options} onChange={setOptions} />

          <div className="row import-select-row">
            <button type="button" className="btn btn-ghost" onClick={toggleAll}>
              {allSelected ? "Desmarcar todos" : "Selecionar todos"}
            </button>
            <span className="import-select-count">
              {selectedCount} de {videos.length} selecionados
            </span>
          </div>

          <div className="episode-list">
            {videos.map((v) => {
              const open = expanded === v.id;
              const isOn = selected.has(v.id);
              const watch = v.url || watchUrl(v.id);
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
                        <Thumb src={ytThumb(v.id)} fallbackText="▶" />
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
            className="btn btn-primary import-submit"
            disabled={busy || importing || selectedCount === 0}
            onClick={startImport}
          >
            {importing ? "Enviando…" : `Enviar ${selectedCount} como draft`}
          </button>
        </>
      )}

      {busy && videos.length === 0 && (
        <>
          <p className="loading-note" role="status">
            Consultando o YouTube… isso pode levar alguns segundos.
          </p>
          <Skeleton.Group as="row" count={5} label="Carregando vídeos…" />
        </>
      )}
    </div>
  );
}
