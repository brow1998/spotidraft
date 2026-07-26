import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  downloadConcurrency,
  summarizeDownloads,
} from "../src/server/pipeline.js";
import { archiveForVideo } from "../src/download-ytdlp.js";

test("archiveForVideo dá um arquivo por vídeo", () => {
  // Duas faixas de download escrevendo no mesmo archive.txt se atropelam —
  // yt-dlp faz append sem trava. Um arquivo por id remove a disputa.
  const a = archiveForVideo("/tmp/dl", "abc123");
  const b = archiveForVideo("/tmp/dl", "xyz789");
  assert.notEqual(a, b);
  assert.equal(path.dirname(a), "/tmp/dl");
  assert.match(path.basename(a), /^\.archive-abc123\.txt$/);
});

test("archiveForVideo sanitiza o id", () => {
  // Um id vindo de fora nunca pode escapar do diretório.
  const p = archiveForVideo("/tmp/dl", "../../etc/passwd");
  assert.equal(path.dirname(p), "/tmp/dl");
  assert.ok(!p.includes(".."));
});

test("downloadConcurrency: padrão conservador", () => {
  delete process.env.SPOTIDRAFT_DOWNLOAD_LANES;
  assert.equal(downloadConcurrency(), 2);
  assert.equal(downloadConcurrency({}), 2);
});

test("downloadConcurrency: opção do job ganha do env", () => {
  process.env.SPOTIDRAFT_DOWNLOAD_LANES = "3";
  assert.equal(downloadConcurrency({ downloadLanes: 1 }), 1);
  assert.equal(downloadConcurrency(), 3);
  delete process.env.SPOTIDRAFT_DOWNLOAD_LANES;
});

test("downloadConcurrency: limitado — mais faixas atraem 403 do YouTube", () => {
  assert.equal(downloadConcurrency({ downloadLanes: 99 }), 4);
});

test("downloadConcurrency: entrada inválida nunca zera as faixas", () => {
  for (const bad of [0, -3, "abc", null, NaN]) {
    const n = downloadConcurrency({ downloadLanes: bad });
    assert.ok(n >= 1, `${bad} → ${n}`);
  }
});

test("summarizeDownloads mostra o download menos adiantado", () => {
  // Com faixas concorrentes não existe mais "o download atual". Mostrar o mais
  // atrasado é honesto: é ele que o lote está esperando.
  const { current, activeCount } = summarizeDownloads(
    new Map([
      ["a", { id: "a", overallPct: 80 }],
      ["b", { id: "b", overallPct: 12 }],
      ["c", { id: "c", overallPct: 47 }],
    ])
  );
  assert.equal(current.id, "b");
  assert.equal(activeCount, 3);
});

test("summarizeDownloads: sem progresso conhecido ainda", () => {
  // overallPct null é o estado logo após iniciar — não pode virar 'o mais rápido'.
  const { current } = summarizeDownloads(
    new Map([
      ["a", { id: "a", overallPct: 50 }],
      ["b", { id: "b", overallPct: null }],
    ])
  );
  assert.equal(current.id, "b", "quem nem começou está mais atrasado");
});

test("summarizeDownloads: vazio", () => {
  assert.deepEqual(summarizeDownloads(new Map()), { current: null, activeCount: 0 });
  assert.deepEqual(summarizeDownloads(), { current: null, activeCount: 0 });
});
