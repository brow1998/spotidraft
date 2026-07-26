import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseEpisodeMedia, formatBytes, downloadsSize } from "../src/cleanup.js";

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spd-cleanup-"));
}

test("apaga o vídeo e os restos .part, preservando os sidecars", () => {
  const dir = scratch();
  const base = path.join(dir, "Meu vídeo [abc123]");
  fs.writeFileSync(`${base}.mp4`, Buffer.alloc(2048));
  fs.writeFileSync(`${base}.f401.mp4.part`, Buffer.alloc(1024));
  // Sidecars ficam: o .info.json alimenta duração/descrição na fila.
  fs.writeFileSync(`${base}.info.json`, "{}");
  fs.writeFileSync(`${base}.jpg`, Buffer.alloc(64));

  const r = releaseEpisodeMedia({ video_path: `${base}.mp4` });

  assert.equal(r.freedBytes, 3072, "vídeo + .part");
  assert.ok(!fs.existsSync(`${base}.mp4`));
  assert.ok(!fs.existsSync(`${base}.f401.mp4.part`));
  assert.ok(fs.existsSync(`${base}.info.json`), "metadados preservados");
  assert.ok(fs.existsSync(`${base}.jpg`), "thumb preservada");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("não explode com caminho ausente, vazio ou nulo", () => {
  for (const ep of [{}, { video_path: "" }, { video_path: "/nao/existe.mp4" }, null]) {
    const r = releaseEpisodeMedia(ep);
    assert.equal(r.freedBytes, 0);
    assert.deepEqual(r.removed, []);
  }
});

test("nunca apaga um diretório", () => {
  const dir = scratch();
  const sub = path.join(dir, "pasta");
  fs.mkdirSync(sub);
  const r = releaseEpisodeMedia({ video_path: sub });
  assert.equal(r.freedBytes, 0);
  assert.ok(fs.existsSync(sub), "diretório intacto");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadsSize soma só mídia, recursivamente", () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "canal"));
  fs.writeFileSync(path.join(dir, "canal", "a.mp4"), Buffer.alloc(1000));
  fs.writeFileSync(path.join(dir, "canal", "b.part"), Buffer.alloc(500));
  fs.writeFileSync(path.join(dir, "canal", "c.info.json"), "{}");

  assert.equal(downloadsSize(dir), 1500, "json não conta");
  assert.equal(downloadsSize("/nao/existe"), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("formatBytes em unidades legíveis", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 ** 2), "5 MB");
  assert.equal(formatBytes(2.5 * 1024 ** 3), "2.5 GB");
});
