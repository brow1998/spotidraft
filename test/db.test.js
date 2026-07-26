import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the DB at a scratch dir BEFORE importing db.js — paths.js reads env at load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spotidraft-test-"));
process.env.SPOTIDRAFT_DATA = tmp;

const {
  claimNextPending,
  countFailed,
  getEpisode,
  jobActiveEpisodeCount,
  jobEpisodeCounts,
  markFailed,
  markPublished,
  recoverStaleWork,
  requeueFailed,
  upsertEpisode,
  createJob,
  getJob,
} = await import("../src/db.js");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function seed(id, status, jobId = "job-1") {
  upsertEpisode({
    id,
    title: `t-${id}`,
    description: "",
    video_path: `/tmp/${id}.mp4`,
    status,
    job_id: jobId,
  });
}

test("jobEpisodeCounts agrupa por status", () => {
  seed("a1", "queued");
  seed("a2", "downloading");
  seed("a3", "pending");
  seed("a4", "published");

  const c = jobEpisodeCounts("job-1");
  assert.equal(c.queued, 1);
  assert.equal(c.downloading, 1);
  assert.equal(c.pending, 1);
  assert.equal(c.published, 1);
  assert.equal(jobActiveEpisodeCount("job-1"), 3, "published não conta como ativo");
});

test("jobEpisodeCounts é isolado por job", () => {
  seed("b1", "pending", "job-2");
  assert.equal(jobEpisodeCounts("job-2").pending, 1);
  assert.equal(jobEpisodeCounts("job-2").queued, undefined);
  assert.equal(jobActiveEpisodeCount("job-inexistente"), 0);
});

test("claimNextPending reivindica uma vez e não devolve a mesma linha", () => {
  seed("c1", "pending", "job-3");
  const first = claimNextPending();
  assert.ok(first);
  assert.equal(first.status, "uploading", "a linha já vem reivindicada");

  // A mesma linha não pode ser reivindicada de novo.
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const next = claimNextPending();
    if (!next) break;
    assert.ok(!ids.has(next.id), "nenhuma linha sai duas vezes");
    ids.add(next.id);
  }
  assert.ok(!ids.has(first.id));
});

test("claimNextPending devolve null quando não há nada pendente", () => {
  while (claimNextPending()) {
    /* drena */
  }
  assert.equal(claimNextPending(), null);
});

test("requeueFailed devolve a contagem do que mexeu", () => {
  seed("d1", "pending", "job-4");
  seed("d2", "pending", "job-4");
  markFailed("d1", "boom");
  markFailed("d2", "boom");
  assert.equal(countFailed(), 2);

  assert.equal(requeueFailed("d1").requeued, 1, "requeue individual");
  assert.equal(requeueFailed().requeued, 1, "requeue em massa pega o resto");
  assert.equal(countFailed(), 0);
  assert.equal(requeueFailed().requeued, 0, "nada pra fazer devolve 0");
});

test("requeue de falha no download volta pra 'queued', não pra 'pending'", () => {
  // Sem arquivo em disco não há o que enviar: mandar pra 'pending' faria o
  // uploader falhar de novo na hora com "video_path missing".
  upsertEpisode({
    id: "dl1",
    title: "falhou baixando",
    video_path: "",
    status: "queued",
    job_id: "job-dl",
  });
  markFailed("dl1", "HTTP Error 403: Forbidden");

  const r = requeueFailed("dl1");
  assert.equal(r.requeued, 1);
  assert.equal(getEpisode("dl1").status, "queued", "volta pro início da esteira");
  assert.deepEqual(r.toDownload, ["dl1"]);
  assert.deepEqual(r.jobIds, ["job-dl"], "o job precisa rodar de novo pra baixar");
});

test("requeue de falha no upload volta pra 'pending' e não rebaixa", () => {
  // O arquivo existe (este próprio arquivo de teste serve de stand-in).
  const realFile = new URL(import.meta.url).pathname;
  upsertEpisode({
    id: "up1",
    title: "falhou enviando",
    video_path: realFile,
    status: "pending",
    job_id: "job-up",
  });
  markFailed("up1", "Save draft não apareceu");

  const r = requeueFailed("up1");
  assert.equal(r.requeued, 1);
  assert.equal(getEpisode("up1").status, "pending", "só reenvia");
  assert.deepEqual(r.toDownload, [], "nada pra rebaixar");
  assert.deepEqual(r.jobIds, [], "nenhum job precisa rodar o loop de download");
  assert.deepEqual(
    r.touchedJobs,
    ["job-up"],
    "mas o job precisa voltar a parecer ativo, senão o card de progresso some"
  );
});

test("recoverStaleWork: downloading volta pra fila, uploading vira falha", () => {
  const job = createJob({ type: "import", url: "https://x", options: {} });
  seed("e1", "downloading", job.id);
  seed("e2", "uploading", job.id);
  seed("e3", "published", job.id);

  const r = recoverStaleWork();
  assert.ok(r.stuckDownloads >= 1);
  assert.ok(r.stuckUploads >= 1);

  assert.equal(getEpisode("e1").status, "queued", "download é seguro de repetir");

  const e2 = getEpisode("e2");
  assert.equal(e2.status, "failed", "upload NÃO é auto-reenfileirado");
  assert.match(
    e2.error,
    /reinício/,
    "o motivo precisa dizer pro usuário conferir no Spotify antes"
  );

  assert.equal(getEpisode("e3").status, "published", "terminal não é tocado");
  assert.ok(r.resumable.includes(job.id), "job com episódio vivo é retomável");
});

test("recoverStaleWork separa job órfão de job retomável", () => {
  const orphan = createJob({ type: "import", url: "https://y", options: {} });
  seed("f1", "published", orphan.id);

  const r = recoverStaleWork();
  assert.ok(r.orphaned.includes(orphan.id), "sem episódio vivo → órfão");
  assert.ok(!r.resumable.includes(orphan.id));
  assert.equal(getJob(orphan.id).status, "queued", "recover não finaliza sozinho");
});

test("markPublished/markFailed limpam o erro corretamente", () => {
  seed("g1", "pending", "job-9");
  markFailed("g1", "erro qualquer");
  assert.equal(getEpisode("g1").error, "erro qualquer");
  markPublished("g1");
  assert.equal(getEpisode("g1").status, "published");
  assert.equal(getEpisode("g1").error, null);
});
