import test from "node:test";
import assert from "node:assert/strict";
import {
  emitEvent,
  eventsSince,
  serializeSse,
  lastEventId,
  recentLogs,
  emitLog,
  createThrottle,
} from "../src/server/events.js";

test("serializeSse: frame com id, event e data", () => {
  const frame = serializeSse({ id: 7, type: "job.progress", data: { a: 1 } });
  assert.equal(frame, 'id: 7\nevent: job.progress\ndata: {"a":1}\n\n');
});

test("serializeSse: id 0 (ping) sai sem linha de id", () => {
  const frame = serializeSse({ id: 0, type: "ping", data: {} });
  assert.equal(frame, "event: ping\ndata: {}\n\n");
});

test("serializeSse: quebras de linha no payload não quebram o frame", () => {
  const frame = serializeSse({ id: 1, type: "log", data: { line: "a\nb" } });
  assert.ok(!frame.slice(0, -2).includes("\n\n"), "só o terminador tem linha em branco");
  assert.equal(frame.trimEnd().split("\n").length, 3);
  const payload = JSON.parse(frame.match(/^data: (.*)$/m)[1]);
  assert.equal(payload.line, "a\nb");
});

test("serializeSse: data ausente vira objeto vazio", () => {
  assert.equal(serializeSse({ id: 2, type: "ping" }), "id: 2\nevent: ping\ndata: {}\n\n");
});

test("eventsSince: devolve só o que é mais novo", () => {
  const a = emitEvent("job.status", { jobId: "a" });
  const b = emitEvent("job.status", { jobId: "b" });

  const since = eventsSince(a.id);
  assert.ok(since.every((e) => e.id > a.id));
  assert.ok(since.some((e) => e.id === b.id));
  assert.equal(eventsSince(b.id).length, 0);
});

test("eventsSince: entrada inválida devolve lista vazia", () => {
  for (const bad of [undefined, null, "abc", 0, -1, NaN]) {
    assert.deepEqual(eventsSince(bad), []);
  }
});

test("emitEvent: ids são monotônicos e batem com lastEventId", () => {
  const a = emitEvent("worker", { running: true });
  const b = emitEvent("worker", { running: false });
  assert.equal(b.id, a.id + 1);
  assert.equal(lastEventId(), b.id);
});

test("recentLogs: filtra por job e só carrega logs", () => {
  emitEvent("job.status", { jobId: "job-x" });
  emitLog("info", "ytdlp", "baixando…", { jobId: "job-x" });
  emitLog("error", "creators", "falhou", { jobId: "job-y" });

  const doX = recentLogs({ jobId: "job-x" });
  assert.ok(doX.length >= 1);
  assert.ok(doX.every((e) => e.type === "log" && e.data.jobId === "job-x"));
});

test("createThrottle: deixa passar a primeira, segura a seguinte, e force ignora", () => {
  const shouldEmit = createThrottle(10_000);
  assert.equal(shouldEmit("ep1"), true);
  assert.equal(shouldEmit("ep1"), false);
  assert.equal(shouldEmit("ep2"), true, "chaves são independentes");
  assert.equal(shouldEmit("ep1", { force: true }), true);
});
