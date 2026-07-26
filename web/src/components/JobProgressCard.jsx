import { ProgressBar } from "./ProgressBar.jsx";
import { jobStatusPt } from "../statusLabels.js";

export const STEP_LABELS = {
  start: "Preparando envio",
  dashboard: "Abrindo o painel do Creators",
  "new-episode": "Criando o episódio",
  uploading: "Enviando o arquivo",
  processing: "Spotify processando o vídeo",
  details: "Preenchendo detalhes",
  title: "Preenchendo o título",
  description: "Adicionando a descrição",
  thumb: "Enviando a thumbnail",
  preview: "Aguardando a pré-visualização",
  "save-draft": "Salvando como rascunho",
  publish: "Publicando",
  done: "Finalizado",
};

/** The order steps happen in, so the UI can show "3 de 8". */
const STEP_ORDER = [
  "dashboard",
  "new-episode",
  "uploading",
  "processing",
  "title",
  "description",
  "thumb",
  "preview",
  "save-draft",
  "done",
];

function stepPosition(step) {
  const i = STEP_ORDER.indexOf(step);
  return i === -1 ? null : { at: i + 1, of: STEP_ORDER.length };
}

function formatSecs(s) {
  if (s == null || !Number.isFinite(s)) return null;
  const n = Math.max(0, Math.round(s));
  const m = Math.floor(n / 60);
  return m > 0 ? `${m}min ${n % 60}s` : `${n}s`;
}

/** Human detail for the current upload step. */
export function describeUploadStep(cur) {
  if (!cur) return null;
  const label = STEP_LABELS[cur.step] || cur.step || "";
  const bits = [];

  if (cur.step === "uploading" && cur.sizeMb) bits.push(`${cur.sizeMb} MB`);
  if (cur.step === "processing") {
    if (cur.sizeMb) bits.push(`${cur.sizeMb} MB`);
    const el = formatSecs(cur.elapsed);
    if (el) bits.push(`há ${el}`);
  }
  if (cur.step === "preview") {
    const el = formatSecs(cur.elapsed);
    if (el) bits.push(`há ${el}`);
  }

  return { label, detail: bits.join(" · ") };
}

const STAGE_LABELS = {
  video: "vídeo",
  audio: "áudio",
  merge: "juntando áudio e vídeo",
};

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return null;
  const mb = bytesPerSec / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}min ${s % 60}s` : `${s}s`;
}

function trackPct(done, total) {
  if (!total) return 0;
  return (done / total) * 100;
}

export function JobProgressCard({ job, onCancel, cancelling }) {
  const p = job.progress || {};
  const dl = p.download || {};
  const up = p.upload || {};
  const total = p.total || dl.total || up.total || 0;

  const cur = dl.current;
  // Fold the live percentage of the in-flight video into the batch bar, so it
  // advances continuously instead of jumping once per finished video.
  const dlPct =
    cur && cur.overallPct != null && total
      ? trackPct(dl.done + cur.overallPct / 100, total)
      : trackPct(dl.done, total);

  const dlDetail = [
    dl.activeCount > 1 ? `${dl.activeCount} em paralelo` : null,
    cur?.stage ? STAGE_LABELS[cur.stage] : null,
    formatSpeed(cur?.speed),
    formatEta(cur?.eta) && `faltam ${formatEta(cur.eta)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const stepInfo = describeUploadStep(up.current);
  const pos = stepPosition(up.current?.step);

  return (
    <article className="job-card">
      <header className="job-card-head">
        <div>
          <h3 className="job-card-title">{p.message || jobStatusPt(job.status)}</h3>
          <p className="job-card-sub">
            <span className={`pill pill-status ${job.status}`}>
              {jobStatusPt(job.status)}
            </span>
            <span className="job-card-id">#{job.id.slice(0, 8)}</span>
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelando…" : "Cancelar lote"}
          </button>
        )}
      </header>

      <ProgressBar
        label="Baixando"
        value={dlPct}
        detail={dlDetail || `${dl.done || 0}/${total}`}
        valueText={`${dl.done || 0} de ${total} baixados`}
      />

      {cur?.stage === "merge" && (
        <ProgressBar
          label="Processando"
          value={null}
          detail="juntando áudio e vídeo — pode levar um minuto"
          valueText="juntando áudio e vídeo"
        />
      )}

      <ProgressBar
        label="Enviando ao Spotify"
        tone="accent"
        value={trackPct(up.done, total)}
        detail={`${up.done || 0}/${total}`}
        valueText={`${up.done || 0} de ${total} enviados`}
      />

      {/* The upload has no percentage of its own, so spell out which step it's
          on — otherwise several quiet minutes look identical to a hang. */}
      {stepInfo && (
        <div className="upload-step" role="status">
          <span className="upload-step-spinner" aria-hidden="true" />
          <span className="upload-step-text">
            <strong>{stepInfo.label}</strong>
            <span className="upload-step-detail">
              {[
                up.activeCount > 1 ? `${up.activeCount} em paralelo` : null,
                up.current?.title,
                stepInfo.detail,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {pos && (
            <span className="upload-step-count" aria-hidden="true">
              {pos.at}/{pos.of}
            </span>
          )}
        </div>
      )}

      {p.counts && (p.counts.failed > 0 || p.counts.cancelled > 0) && (
        <p className="job-card-note">
          {p.counts.failed > 0 && <span className="note-bad">{p.counts.failed} falhou(ram)</span>}
          {p.counts.cancelled > 0 && (
            <span className="note-muted">{p.counts.cancelled} cancelado(s)</span>
          )}
        </p>
      )}
    </article>
  );
}

export default JobProgressCard;
