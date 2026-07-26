import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PROFILE_DIR, SCREENSHOTS_DIR, laneProfileDir } from "../paths.js";
import { loadConfig } from "../session.js";
import { withProfileLease } from "./profile-lease.js";
import {
  applySavedCookies,
  clickFirst,
  dismissCookies,
  dismissZoomModal,
  ensureDashboard,
  episodesUrl,
  fillFirst,
  goToDashboard,
  launchOpts,
  uploadThumbnail,
} from "./creators-dom.js";

/**
 * Classify a Creators failure so the caller knows whether retrying is pointless.
 * Pure — covered by test/creators-errors.test.js.
 *
 * "session" is the one that matters: with expired cookies every remaining
 * episode would burn a 60s login timeout before failing identically, so the
 * uploader stops the batch instead of grinding through it.
 */
export function classifyCreatorsError(err) {
  const msg = String(err?.message || err || "");
  if (!msg) return "unknown";
  if (
    /cookies podem ter expirado|timeout esperando ui do creators|accounts\.spotify\.com|sess(ã|a)o inv(á|a)lida|not logged in/i.test(
      msg
    )
  ) {
    return "session";
  }
  if (
    /target (page|closed)|browser has been closed|context was destroyed|crash/i.test(
      msg
    )
  ) {
    return "crash";
  }
  if (/net::|ERR_|ECONNRESET|ETIMEDOUT|socket hang up|navigation timeout/i.test(msg)) {
    return "network";
  }
  if (/não achei|não apareceu|não encontrado|locator|waiting for selector/i.test(msg)) {
    return "ui";
  }
  return "unknown";
}

const noop = () => {};

export function fileSizeMb(filePath) {
  try {
    return Math.round(fs.statSync(filePath).size / 1024 / 1024);
  } catch {
    return 0;
  }
}

/**
 * How long to let the Creators upload + transcode run before giving up.
 * Pure, so the scaling is testable without a browser.
 *
 * 6 minutes floor (small files still need the SPA to settle), plus roughly a
 * minute per 100 MB, capped at 45 minutes so a stuck upload can't wedge the
 * whole batch forever.
 */
export function uploadWaitMs(sizeMb) {
  const base = 6 * 60_000;
  const perSize = Math.max(0, Number(sizeMb) || 0) * 600; // 60s per 100 MB
  return Math.min(base + perSize, 45 * 60_000);
}

/**
 * Open one persistent browser session that can publish many episodes.
 *
 * The expensive part is `goToDashboard` (up to a 60s login wait). Paying it
 * once per batch instead of once per episode is the point of this module.
 * Callers MUST call `close()`; the profile lease is held until they do.
 */
export async function openCreatorsSession({
  headless = true,
  onLog = noop,
  baseUrl,
  lane = 1,
} = {}) {
  const profileDir = laneProfileDir(lane);
  const isSharedProfile = profileDir === PROFILE_DIR;
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  let releaseLease = () => {};

  // Only the shared profile needs the lease — that's the one the CLI, the
  // interactive login and the catalog scrape also use. Extra lanes have their
  // own directory and contend with nobody, which is what makes concurrent
  // uploads possible at all. (Measured: 3 lanes, 26s vs ~76s serial.)
  if (isSharedProfile) {
    const leaseHeld = new Promise((resolve) => {
      releaseLease = resolve;
    });
    // Acquire with no timeout: the uploader is the legitimate long holder, and
    // a batch must never be denied its own browser.
    await new Promise((resolve, reject) => {
      withProfileLease(
        async () => {
          resolve();
          await leaseHeld;
        },
        { timeoutMs: 0, label: "upload em lote" }
      ).catch(reject);
    });
  }

  let context = null;
  let page = null;
  let alive = false;
  let closed = false;
  let published = 0;

  async function boot() {
    context = await chromium.launchPersistentContext(
      profileDir,
      launchOpts(headless)
    );
    await applySavedCookies(context);
    page = context.pages()[0] || (await context.newPage());
    context.on("close", () => {
      alive = false;
    });
    page.on("crash", () => {
      alive = false;
      onLog("error", "creators", "a página do Creators travou");
    });
    onLog("info", "creators", "abrindo painel do Creators…");
    await goToDashboard(page, baseUrl || episodesUrl());
    alive = true;
    onLog("info", "creators", "painel pronto — sessão reutilizável aberta");
  }

  await boot();

  async function shot(episodeId, label) {
    const p = path.join(
      SCREENSHOTS_DIR,
      `${episodeId}-${label}-${Date.now()}.png`
    );
    try {
      await page.screenshot({ path: p, fullPage: true });
      console.error(`[creators] screenshot → ${p}`);
    } catch {
      /* ignore */
    }
  }

  /** Park back on the episodes list so the next episode starts from a known state. */
  async function resetToDashboard() {
    if (await ensureDashboard(page)) return;
    onLog("info", "creators", "revalidando painel entre episódios…");
    await page.goto(episodesUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);
    await dismissCookies(page);
    if (!(await ensureDashboard(page))) {
      await goToDashboard(page, baseUrl || episodesUrl());
    }
  }

  async function publish(episode, { onStep = noop } = {}) {
    if (closed) throw new Error("sessão do Creators já foi fechada");
    if (!fs.existsSync(episode.video_path)) {
      throw new Error(`video_path missing: ${episode.video_path}`);
    }
    const draft = !(episode.draft === 0 || episode.draft === false);

    try {
      if (published > 0) {
        onStep("dashboard");
        await resetToDashboard();
      }

      onStep("new-episode");
      await page
        .getByText(/new episode|novo episódio/i)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });

      const opened = await clickFirst(
        page,
        [
          () =>
            page.getByRole("button", {
              name: /new episode|novo episódio|create episode|criar episódio/i,
            }),
          () => page.getByRole("link", { name: /new episode|novo episódio/i }),
          () =>
            page
              .locator('a[href*="episode"]')
              .filter({ hasText: /new|novo|create|criar/i }),
          () => page.getByText(/new episode|novo episódio/i),
        ],
        15_000
      );

      if (!opened) {
        const cfg = loadConfig();
        if (cfg?.showId) {
          const newUrl = `https://creators.spotify.com/pod/show/${cfg.showId}/episode/new`;
          console.error("[creators] fallback goto", newUrl);
          await page.goto(newUrl, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2000);
        } else {
          await shot(episode.id, "no-new-episode");
          throw new Error("Não achei o botão New Episode — UI pode ter mudado.");
        }
      }

      await page.waitForTimeout(1500);

      onStep("uploading");
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: "attached", timeout: 30_000 });
      const sizeMb = fileSizeMb(episode.video_path);
      onStep("uploading", { sizeMb });
      await fileInput.setInputFiles(episode.video_path);
      onLog(
        "info",
        "creators",
        `upload iniciado: ${path.basename(episode.video_path)} (${sizeMb} MB)`
      );

      // Scale the wait to the file: a flat 6-minute ceiling is fine for a
      // 200 MB clip and nowhere near enough for a 2 GB 4K export, which is what
      // the default "best quality" produces for a long video.
      const waitMs = uploadWaitMs(sizeMb);
      const deadline = Date.now() + waitMs;
      let ready = false;
      let lastLog = 0;

      while (Date.now() < deadline) {
        const details =
          (await page.getByLabel(/title|título/i).count()) > 0 ||
          (await page.getByText(/^details$|^detalhes$/i).count()) > 0 ||
          (await page.getByText(/preview ready|pré-visualização pronta/i).count()) > 0;
        const uploading =
          (await page.getByText(/uploading|enviando|processing|processando/i).count()) >
          0;
        if (details && !uploading) {
          ready = true;
          break;
        }
        await page.waitForTimeout(2000);

        // This is the longest, quietest stretch of the whole flow — the file is
        // in flight and Creators is transcoding, with no percentage available.
        // Report elapsed time so it doesn't look frozen.
        const elapsed = Math.round((waitMs - (deadline - Date.now())) / 1000);
        onStep("processing", {
          sizeMb,
          elapsed,
          expected: Math.round(waitMs / 1000),
        });
        if (elapsed - lastLog >= 30) {
          lastLog = elapsed;
          onLog(
            "info",
            "creators",
            `aguardando o Creators processar o arquivo… (${elapsed}s de até ${Math.round(waitMs / 1000)}s)`
          );
        }
      }

      if (!ready) {
        // Falling through here used to surface later as a confusing
        // "Campo Description não encontrado". Say what actually happened.
        await shot(episode.id, "upload-timeout");
        throw new Error(
          `O Creators não terminou de processar o arquivo (${sizeMb} MB) em ${Math.round(
            waitMs / 60000
          )} min. Tente uma qualidade menor nas opções de download.`
        );
      }

      await dismissZoomModal(page);

      onStep("title");
      // Title — clear then fill (avoid truncated leftover)
      const titleBox = page
        .getByLabel(/title|título/i)
        .or(page.locator('input[name*="title" i]'))
        .first();
      if (await titleBox.count()) {
        await titleBox.click({ clickCount: 3 });
        await titleBox.fill(episode.title.slice(0, 200));
        console.error("[creators] título preenchido");
      } else {
        await fillFirst(
          page,
          [() => page.locator('input[type="text"]').first()],
          episode.title.slice(0, 200)
        );
      }

      // Description is REQUIRED on Creators
      await dismissCookies(page);
      onStep("description");
      {
        const desc = (episode.description || episode.title || "—").slice(0, 3900);
        let descOk = await fillFirst(
          page,
          [
            () => page.getByLabel(/description|descrição/i),
            () => page.getByPlaceholder(/what else do you want/i),
            () => page.locator('[contenteditable="true"]').first(),
            () => page.locator("textarea").first(),
          ],
          desc
        );
        if (!descOk) {
          const editable = page.locator('[contenteditable="true"]').first();
          if (await editable.count()) {
            await editable.click();
            await page.keyboard.press("Control+A");
            await page.keyboard.insertText(desc.slice(0, 2000));
            descOk = true;
          }
        }
        if (!descOk) {
          await shot(episode.id, "no-description");
          throw new Error("Campo Description obrigatório não encontrado.");
        }
        console.error("[creators] descrição preenchida");
      }

      // Thumbnail (16:9) — never Episode art (square, show default)
      if (episode.image_path && fs.existsSync(episode.image_path)) {
        onStep("thumb");
        const ok = await uploadThumbnail(page, episode.image_path);
        if (ok) {
          await page.waitForTimeout(1500);
          await dismissZoomModal(page);
        }
      }

      await dismissCookies(page);

      for (let i = 0; i < 90; i++) {
        if ((await page.getByText(/preview ready|pré-visualização pronta/i).count()) > 0)
          break;
        onStep("preview", { elapsed: i * 2, expected: 180 });
        await page.waitForTimeout(2000);
        if (i % 15 === 0 && i > 0) {
          onLog("info", "creators", `aguardando Preview ready… (${i * 2}s)`);
        }
      }

      if (draft) {
        onStep("save-draft");
        // Creators: draft via Close (X) → "Save draft" (Review only has Publish)
        const closedEditor = await clickFirst(
          page,
          [
            () => page.getByRole("button", { name: /^close$|^fechar$/i }),
            () => page.locator('button[aria-label="Close"], button[aria-label="Fechar"]'),
            () => page.locator('[aria-label*="close" i]').first(),
          ],
          10_000
        );
        if (!closedEditor) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(800);
        }
        console.error("[creators] fechando editor → diálogo Save draft");

        const saved = await clickFirst(
          page,
          [
            () =>
              page.getByRole("button", {
                name: /^save draft$|^salvar rascunho$|save as draft/i,
              }),
            () => page.getByText(/^save draft$|^salvar rascunho$/i),
          ],
          12_000
        );
        if (!saved) {
          await shot(episode.id, "no-save-draft");
          throw new Error('Botão "Save draft" não apareceu após fechar o editor.');
        }
        console.error("[creators] Save draft clicado");
        for (let i = 0; i < 40; i++) {
          if ((await page.getByText(/new episode|novo episódio/i).count()) > 0) break;
          if (/\/episodes\/?$/i.test(page.url())) break;
          await page.waitForTimeout(500);
        }
      } else {
        onStep("publish");
        await clickFirst(
          page,
          [
            () => page.getByRole("button", { name: /^next$|^próximo$|^continuar$/i }),
            () => page.getByText(/^next$/i),
          ],
          15_000
        );
        console.error("[creators] Next → Review");
        await page.waitForTimeout(2000);
        await dismissZoomModal(page);
        await dismissCookies(page);
        await clickFirst(
          page,
          [() => page.getByRole("button", { name: /^publish$|^publicar$/i })],
          15_000
        );
        console.error("[creators] Publish clicado");
      }

      await page.waitForTimeout(2000);
      await shot(episode.id, "done");
      published += 1;
      onStep("done");
      console.error("[creators] fluxo concluído para", episode.id);
    } catch (err) {
      await shot(episode.id, "error");
      throw err;
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    alive = false;
    try {
      await context?.close();
    } catch {
      /* ignore */
    } finally {
      releaseLease();
      untrack(handle);
    }
  }

  /** Force any in-flight Playwright call to reject, so cancel is not cooperative. */
  async function abortCurrent() {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    alive = false;
  }

  const handle = {
    publish,
    close,
    abortCurrent,
    isAlive: () => alive && !closed,
    publishedCount: () => published,
  };
  track(handle);
  return handle;
}

const open = new Set();
function track(h) {
  open.add(h);
}
function untrack(h) {
  open.delete(h);
}

/** Shut every live session down — used on SIGINT and Electron quit. */
export async function closeAllCreatorsSessions() {
  await Promise.all([...open].map((h) => h.close().catch(() => {})));
}
