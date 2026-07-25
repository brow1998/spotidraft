import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  claimNextPending,
  getEpisode,
  listEpisodes,
  markFailed,
  markPublished,
  requeueFailed,
  upsertEpisode,
} from "./db.js";
import { discoverYtdlpEpisode, packageEpisode } from "./package-episode.js";
import {
  creatorsLogin,
  publishViaCreators,
} from "./adapters/creators-playwright.js";
import { DOWNLOADS_DIR, PACKAGES_DIR } from "./paths.js";
import { importFromCurl } from "./session.js";
import { downloadYoutube, sourceDirName } from "./download-ytdlp.js";
import {
  enqueueMp4Paths,
  episodeFromYtdlpMp4,
} from "./enqueue-helpers.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function drainWorker({ headless = false, once = false } = {}) {
  for (;;) {
    const job = claimNextPending();
    if (!job) {
      console.error("[worker] fila vazia");
      break;
    }
    console.error(`[worker] uploading ${job.id} — ${job.title}`);
    try {
      await publishViaCreators(job, { headless });
      markPublished(job.id);
      console.error(`[worker] ok ${job.id}`);
    } catch (e) {
      markFailed(job.id, e.message || e);
      console.error(`[worker] FAIL ${job.id}:`, e.message || e);
    }
    if (once) break;
  }
}

export function buildCli() {
  const program = new Command();
  program
    .name("spotidraft")
    .description(
      "Spotidraft — YouTube → drafts no Spotify for Creators"
    )
    .option("--headless", "Rodar browser headless", false);

  program
    .command("login")
    .description("Abre Creators para login e salva cookies no perfil local")
    .action(async () => {
      await creatorsLogin({ headless: false });
    });

  program
    .command("import-curl")
    .description(
      "Importa cookies (+ show URL) a partir de um curl colado ou arquivo"
    )
    .argument("<pathOr->", "Arquivo .txt com o curl, ou '-' para stdin")
    .action(async (input) => {
      let text;
      if (input === "-") {
        text = await new Promise((resolve, reject) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (c) => (buf += c));
          process.stdin.on("end", () => resolve(buf));
          process.stdin.on("error", reject);
        });
      } else {
        text = fs.readFileSync(path.resolve(input), "utf8");
      }
      const result = importFromCurl(text);
      console.log(
        JSON.stringify(
          {
            cookieCount: result.cookieCount,
            hasSpDc: result.hasSpDc,
            hasAnchor: result.hasAnchor,
            showId: result.show?.showId ?? null,
            episodesUrl: result.show?.episodesUrl ?? null,
          },
          null,
          2
        )
      );
    });

  program
    .command("ingest")
    .description(
      "YouTube URL (vídeo|playlist|canal) → download → fila draft → upload"
    )
    .argument("<url>", "URL do YouTube")
    .option("--limit <n>", "Máx. de vídeos (playlist/canal)", (v) => Number(v))
    .option("--out <dir>", "Pasta de download (default: data/downloads/...)")
    .option("--skip-download", "Só enfileira mp4s já baixados na pasta", false)
    .option("--no-upload", "Para após enfileirar (não roda o worker)", false)
    .option("--publish", "Publicar de verdade (default: draft)", false)
    .option("--headless", "Worker headless", false)
    .action(async (url, opts, cmd) => {
      const headless = opts.headless || cmd.parent.opts().headless;
      const outDir =
        opts.out || path.join(DOWNLOADS_DIR, sourceDirName(url));

      const { dir, files } = await downloadYoutube({
        url,
        outDir,
        limit: opts.limit,
        skipDownload: opts.skipDownload,
      });

      if (!files.length) {
        throw new Error(`Nenhum mp4 em ${dir}`);
      }

      const { queued, skipped } = enqueueMp4Paths(files, {
        skipPublished: true,
        draft: !opts.publish,
      });
      console.error(
        `[ingest] enfileirados=${queued.length} skipped_published=${skipped.length} dir=${dir}`
      );

      if (opts.noUpload || opts.upload === false) {
        console.error("[ingest] --no-upload: fila pronta, worker não iniciado");
        return;
      }

      console.error("[ingest] iniciando uploads (draft)…");
      await drainWorker({ headless, once: false });
      console.error("[ingest] concluído");
    });

  program
    .command("package")
    .description("Gera pacote mp4+json+jpg a partir de um .mp4 do yt-dlp")
    .argument("<mp4>", "Caminho do .mp4")
    .option("--no-reencode", "Só copia o mp4 (não recomendado)")
    .option("--clip <seconds>", "Corta os primeiros N segundos (piloto)", (v) =>
      Number(v)
    )
    .option("--height <n>", "Altura máx. do encode", (v) => Number(v), 1080)
    .action(async (mp4, opts) => {
      const discovered = discoverYtdlpEpisode(mp4);
      const pkg = await packageEpisode({
        ...discovered,
        reencode: opts.reencode,
        clipSeconds: opts.clip,
        maxHeight: opts.height,
      });
      console.log(JSON.stringify(pkg, null, 2));
    });

  program
    .command("enqueue")
    .description(
      "Enfileira um pacote já gerado (dir com .json) ou gera a partir do mp4"
    )
    .argument("<path>", "Dir do pacote, arquivo .json do pacote, ou .mp4 yt-dlp")
    .option("--publish", "Publicar de verdade (default: draft)", false)
    .option("--clip <seconds>", "Se path for mp4, corta N segundos (piloto)", (v) =>
      Number(v)
    )
    .option("--no-reencode", "Usa o mp4 baixado (sem ffmpeg); default recomendado p/ íntegra")
    .action(async (input, opts) => {
      let pkg;
      const abs = path.resolve(input);
      if (abs.endsWith(".mp4")) {
        const discovered = discoverYtdlpEpisode(abs);
        if (opts.clip) {
          pkg = await packageEpisode({
            ...discovered,
            clipSeconds: opts.clip,
            reencode: true,
          });
        } else {
          pkg = episodeFromYtdlpMp4(abs);
        }
      } else if (abs.endsWith(".json")) {
        const meta = JSON.parse(fs.readFileSync(abs, "utf8"));
        const dir = path.dirname(abs);
        pkg = {
          id: meta.id,
          title: meta.title,
          description: meta.description ?? "",
          video_path: path.join(dir, meta.video),
          image_path: path.join(dir, meta.image),
          meta_path: abs,
        };
      } else {
        const json = fs.readdirSync(abs).find((f) => f.endsWith(".json"));
        if (!json) throw new Error(`Sem .json em ${abs}`);
        const meta = JSON.parse(
          fs.readFileSync(path.join(abs, json), "utf8")
        );
        pkg = {
          id: meta.id,
          title: meta.title,
          description: meta.description ?? "",
          video_path: path.join(abs, meta.video),
          image_path: path.join(abs, meta.image),
          meta_path: path.join(abs, json),
        };
      }

      upsertEpisode({
        ...pkg,
        draft: !opts.publish,
      });
      console.log(`enqueued ${pkg.id} (${opts.publish ? "publish" : "draft"})`);
      console.log(`packages dir: ${PACKAGES_DIR}`);
    });

  program
    .command("enqueue-dir")
    .description("Enfileira todos os .mp4 de uma pasta yt-dlp (íntegra; --clip só p/ piloto)")
    .argument("<dir>", "Pasta com arquivos yt-dlp")
    .option("--clip <seconds>", "Clip piloto por episódio (reencoda)", (v) => Number(v))
    .option("--limit <n>", "Máx. de arquivos", (v) => Number(v))
    .option("--skip-published", "Ignora ids já published na fila", true)
    .action(async (dir, opts) => {
      const files = fs
        .readdirSync(dir)
        .filter(
          (f) =>
            f.endsWith(".mp4") && !f.includes(".f") && !f.includes(".temp")
        )
        .sort()
        .map((f) => path.join(dir, f));
      const slice = opts.limit ? files.slice(0, opts.limit) : files;

      if (opts.clip) {
        for (const mp4 of slice) {
          const discovered = discoverYtdlpEpisode(mp4);
          console.error(`[enqueue-dir] packaging clip ${discovered.id}…`);
          const pkg = await packageEpisode({
            ...discovered,
            clipSeconds: opts.clip,
            reencode: true,
          });
          upsertEpisode({ ...pkg, draft: true });
          console.error(`[enqueue-dir] queued ${pkg.id}`);
        }
        return;
      }

      const { queued, skipped } = enqueueMp4Paths(slice, {
        skipPublished: opts.skipPublished !== false,
        draft: true,
      });
      for (const id of skipped) {
        console.error(`[enqueue-dir] skip published ${id}`);
      }
      for (const id of queued) {
        console.error(`[enqueue-dir] queued ${id}`);
      }
    });

  program
    .command("worker")
    .description("Processa a fila (um a um) via Playwright Creators")
    .option("--once", "Só um job", false)
    .option("--headless", "Headless", false)
    .action(async (opts, cmd) => {
      const headless = opts.headless || cmd.parent.opts().headless;
      if (opts.once) {
        await drainWorker({ headless, once: true });
        return;
      }
      for (;;) {
        await drainWorker({ headless, once: false });
        await sleep(5000);
      }
    });

  program
    .command("publish-one")
    .description("Publica um id já enfileirado imediatamente")
    .argument("<id>")
    .option("--headless", "Headless", false)
    .action(async (id, opts, cmd) => {
      const job = getEpisode(id);
      if (!job) throw new Error(`id não encontrado: ${id}`);
      requeueFailed(id);
      try {
        await publishViaCreators(job, {
          headless: opts.headless || cmd.parent.opts().headless,
        });
        markPublished(id);
        console.error("ok", id);
      } catch (e) {
        markFailed(id, e.message || e);
        throw e;
      }
    });

  program
    .command("status")
    .description("Lista a fila")
    .action(() => {
      const rows = listEpisodes();
      if (!rows.length) {
        console.log("(vazia)");
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.status.padEnd(10)} ${r.id}  ${r.draft ? "draft" : "publish"}  ${r.title.slice(0, 60)}${r.error ? "  ERR:" + r.error.slice(0, 80) : ""}`
        );
      }
    });

  program
    .command("requeue")
    .description("Reenfileira failed")
    .argument("[id]")
    .action((id) => {
      requeueFailed(id);
      console.log("ok");
    });

  return program;
}
