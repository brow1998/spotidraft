export const EPISODE_STATUS_PT = {
  queued: "Na fila",
  downloading: "Baixando",
  pending: "Aguardando envio",
  uploading: "Enviando",
  published: "Rascunho no Spotify",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export const JOB_STATUS_PT = {
  queued: "Na fila",
  running: "Em andamento",
  uploading: "Enviando",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function episodeStatusPt(s) {
  return EPISODE_STATUS_PT[s] || s;
}

export function jobStatusPt(s) {
  return JOB_STATUS_PT[s] || s;
}
