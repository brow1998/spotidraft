import test from "node:test";
import assert from "node:assert/strict";
import {
  parseYtDlpProgressLine,
  createProgressTracker,
} from "../src/download-ytdlp.js";

test("parseYtDlpProgressLine: linha de progresso completa", () => {
  const r = parseYtDlpProgressLine("SPDPROG 500 1000 NA 1048576 42");
  assert.equal(r.kind, "progress");
  assert.equal(r.pct, 50);
  assert.equal(r.downloaded, 500);
  assert.equal(r.total, 1000);
  assert.equal(r.speed, 1048576);
  assert.equal(r.eta, 42);
});

test("parseYtDlpProgressLine: cai para total_bytes_estimate quando total é NA", () => {
  const r = parseYtDlpProgressLine("SPDPROG 250 NA 1000 NA NA");
  assert.equal(r.pct, 25);
  assert.equal(r.total, 1000);
  assert.equal(r.speed, null);
  assert.equal(r.eta, null);
});

test("parseYtDlpProgressLine: sem total conhecido, pct é null", () => {
  const r = parseYtDlpProgressLine("SPDPROG 250 NA NA NA NA");
  assert.equal(r.kind, "progress");
  assert.equal(r.pct, null);
});

test("parseYtDlpProgressLine: nunca passa de 100%", () => {
  const r = parseYtDlpProgressLine("SPDPROG 1200 1000 NA NA NA");
  assert.equal(r.pct, 100);
});

test("parseYtDlpProgressLine: Destination devolve a extensão", () => {
  const r = parseYtDlpProgressLine(
    "[download] Destination: /tmp/dl/Meu vídeo [abc123].f137.mp4"
  );
  assert.deepEqual(r, { kind: "destination", ext: "mp4" });
});

test("parseYtDlpProgressLine: Merger", () => {
  assert.deepEqual(parseYtDlpProgressLine('[Merger] Merging formats into "x.mp4"'), {
    kind: "merge",
  });
});

test("parseYtDlpProgressLine: linhas irrelevantes viram null", () => {
  for (const line of [
    "",
    "   ",
    "[youtube] abc123: Downloading webpage",
    "WARNING: alguma coisa",
    null,
    undefined,
    42,
  ]) {
    assert.equal(parseYtDlpProgressLine(line), null);
  }
});

test("tracker: vídeo+áudio dobram em um único percentual monotônico", () => {
  const track = createProgressTracker({ audioOnly: false });

  assert.equal(track("[download] Destination: a.f137.mp4"), null);

  const meioDoVideo = track("SPDPROG 500 1000 NA NA NA");
  assert.equal(meioDoVideo.stage, "video");
  assert.equal(meioDoVideo.pct, 50);
  assert.equal(meioDoVideo.overallPct, 25);

  assert.equal(track("[download] Destination: a.f140.m4a"), null);

  const meioDoAudio = track("SPDPROG 500 1000 NA NA NA");
  assert.equal(meioDoAudio.stage, "audio");
  assert.equal(meioDoAudio.pct, 50, "o percentual cru volta pra 50…");
  assert.equal(meioDoAudio.overallPct, 75, "…mas o geral segue subindo");
});

test("tracker: merge é indeterminado e silencia progresso posterior", () => {
  const track = createProgressTracker({ audioOnly: false });
  track("[download] Destination: a.f137.mp4");
  track("[download] Destination: a.f140.m4a");

  const merge = track('[Merger] Merging formats into "a.mp4"');
  assert.equal(merge.stage, "merge");
  assert.equal(merge.pct, null, "ffmpeg não reporta progresso");
  assert.equal(merge.overallPct, null);

  assert.equal(track("SPDPROG 10 1000 NA NA NA"), null);
});

test("tracker: audioOnly usa uma única trilha", () => {
  const track = createProgressTracker({ audioOnly: true });
  track("[download] Destination: a.m4a");
  const p = track("SPDPROG 500 1000 NA NA NA");
  assert.equal(p.stage, "audio");
  assert.equal(p.overallPct, 50, "sem merge, geral == cru");
});

test("tracker: progresso antes de qualquer Destination não quebra", () => {
  const track = createProgressTracker({ audioOnly: false });
  const p = track("SPDPROG 500 1000 NA NA NA");
  assert.equal(p.stage, "video");
  assert.equal(p.overallPct, 25);
});
