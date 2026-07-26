import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { uploadConcurrency, summarizeUploads } from "../src/server/pipeline.js";
import { laneProfileDir, PROFILE_DIR } from "../src/paths.js";

test("faixa 1 reusa o perfil compartilhado", () => {
  // A CLI, o login interativo e o scrape do catálogo também usam esse
  // diretório — manter a faixa 1 nele preserva o comportamento antigo.
  assert.equal(laneProfileDir(1), PROFILE_DIR);
  assert.equal(laneProfileDir(), PROFILE_DIR);
});

test("faixas extras ganham diretórios próprios", () => {
  // O Chromium tranca o perfil, então uploads concorrentes precisam de um cada.
  const dirs = [1, 2, 3, 4, 5].map(laneProfileDir);
  assert.equal(new Set(dirs).size, 5, "todos distintos");
  assert.equal(laneProfileDir(2), `${PROFILE_DIR}-lane2`);
  assert.ok(dirs.every((d) => path.isAbsolute(d) === path.isAbsolute(PROFILE_DIR)));
});

test("laneProfileDir normaliza entrada inválida para a faixa 1", () => {
  for (const bad of [0, -2, null, undefined, NaN, "abc"]) {
    assert.equal(laneProfileDir(bad), PROFILE_DIR, `${bad}`);
  }
});

test("uploadConcurrency: padrão 2", () => {
  delete process.env.SPOTIDRAFT_UPLOAD_LANES;
  assert.equal(uploadConcurrency(), 2);
});

test("uploadConcurrency: teto de 5 — o máximo verificado de fato", () => {
  assert.equal(uploadConcurrency({ uploadLanes: 50 }), 5);
});

test("uploadConcurrency: env e opção", () => {
  process.env.SPOTIDRAFT_UPLOAD_LANES = "4";
  assert.equal(uploadConcurrency(), 4);
  assert.equal(uploadConcurrency({ uploadLanes: 1 }), 1, "opção ganha do env");
  delete process.env.SPOTIDRAFT_UPLOAD_LANES;
});

test("uploadConcurrency: entrada inválida nunca zera as faixas", () => {
  for (const bad of [0, -1, "x", null, NaN]) {
    assert.ok(uploadConcurrency({ uploadLanes: bad }) >= 1, `${bad}`);
  }
});

test("summarizeUploads mostra a faixa menos adiantada", () => {
  const { current, activeCount } = summarizeUploads(
    new Map([
      ["a", { id: "a", step: "save-draft" }],
      ["b", { id: "b", step: "uploading" }],
      ["c", { id: "c", step: "description" }],
    ])
  );
  assert.equal(current.id, "b", "'uploading' vem antes de 'description'");
  assert.equal(activeCount, 3);
});

test("summarizeUploads: passo desconhecido vai para o fim, não para o começo", () => {
  // Um passo novo no adapter não pode sequestrar a exibição.
  const { current } = summarizeUploads(
    new Map([
      ["a", { id: "a", step: "passo-novo" }],
      ["b", { id: "b", step: "preview" }],
    ])
  );
  assert.equal(current.id, "b");
});

test("summarizeUploads: vazio", () => {
  assert.deepEqual(summarizeUploads(new Map()), { current: null, activeCount: 0 });
  assert.deepEqual(summarizeUploads(), { current: null, activeCount: 0 });
});

test("jobsWithActiveEpisodes: só jobs vivos com episódio em voo", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/spd-jobs-`);
  process.env.SPOTIDRAFT_DATA = tmp;
  const db = await import(`../src/db.js?jobs=${Date.now()}`);

  const live = db.createJob({ type: "import", url: "u", options: {} });
  const doneJob = db.createJob({ type: "import", url: "u", options: {} });

  db.upsertEpisode({ id: "j1", title: "a", video_path: "", status: "pending", job_id: live.id });
  db.upsertEpisode({ id: "j2", title: "b", video_path: "", status: "published", job_id: doneJob.id });

  const ids = db.jobsWithActiveEpisodes();
  assert.ok(ids.includes(live.id), "job com episódio pendente entra");
  assert.ok(!ids.includes(doneJob.id), "job só com terminais fica de fora");

  fs.rmSync(tmp, { recursive: true, force: true });
});
