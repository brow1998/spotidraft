import test from "node:test";
import assert from "node:assert/strict";
import { computeJobProgress, finalJobStatus } from "../src/server/job-progress.js";

test("fase 'running' quando as duas trilhas estão ativas ao mesmo tempo", () => {
  // O ponto do refactor: baixando o 3º enquanto o 1º sobe.
  const p = computeJobProgress({
    queued: 1,
    downloading: 1,
    pending: 1,
    uploading: 1,
    published: 1,
  });
  assert.equal(p.phase, "running");
  assert.equal(p.total, 5);
  assert.equal(p.download.done, 3, "pending/uploading/published já baixaram");
  assert.equal(p.upload.done, 1);
  assert.equal(p.message, "baixando 3/5 · enviando 1/5");
});

test("fase 'downloading' quando ainda não há nada pra subir", () => {
  const p = computeJobProgress({ queued: 2, downloading: 1 });
  assert.equal(p.phase, "downloading");
  assert.equal(p.download.done, 0);
});

test("fase 'uploading' quando os downloads acabaram", () => {
  const p = computeJobProgress({ pending: 2, published: 1 });
  assert.equal(p.phase, "uploading");
  assert.equal(p.download.done, 3, "todos já baixaram");
  assert.equal(p.upload.done, 1);
});

test("fase 'done' com tudo terminal", () => {
  const p = computeJobProgress({ published: 3 });
  assert.equal(p.phase, "done");
  assert.equal(p.upload.done, 3);
  assert.match(p.message, /concluído/);
});

test("tudo falhou vira fase 'failed'", () => {
  const p = computeJobProgress({ failed: 3 });
  assert.equal(p.phase, "failed");
  assert.equal(finalJobStatus({ failed: 3 }), "failed");
});

test("sucesso parcial ainda é 'completed'", () => {
  assert.equal(finalJobStatus({ published: 2, failed: 1 }), "completed");
});

test("cancelamento explícito ganha do resto", () => {
  assert.equal(
    finalJobStatus({ published: 3 }, { cancelled: true }),
    "cancelled"
  );
});

test("aliases legados continuam preenchidos", () => {
  const p = computeJobProgress({ published: 2, failed: 1, pending: 1 });
  assert.equal(p.current, 3, "current = terminais");
  assert.equal(p.total, 4);
  assert.equal(typeof p.message, "string");
  assert.equal(typeof p.phase, "string");
});

test("carrega o item atual de cada trilha", () => {
  const p = computeJobProgress(
    { downloading: 1, uploading: 1 },
    { current: { id: "a", stage: "video", pct: 40 } },
    { current: { id: "b", step: "details" } }
  );
  assert.equal(p.download.current.pct, 40);
  assert.equal(p.upload.current.step, "details");
});

test("job vazio não quebra nem divide por zero", () => {
  const p = computeJobProgress({});
  assert.equal(p.total, 0);
  assert.equal(p.phase, "done");
  assert.equal(p.download.done, 0);
  assert.equal(p.upload.done, 0);
});

test("done nunca passa do total nem fica negativo", () => {
  const p = computeJobProgress({ published: 2 }, { total: 2 });
  assert.ok(p.download.done >= 0 && p.download.done <= p.total);
  assert.ok(p.upload.done >= 0 && p.upload.done <= p.total);
});
