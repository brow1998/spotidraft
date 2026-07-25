import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { DEFAULT_CREATORS_URL, PROFILE_DIR } from "../paths.js";
import { loadConfig, loadCookies } from "../session.js";

async function ensureProfile() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

function launchOpts(headless) {
  return {
    headless,
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
}

async function applySavedCookies(context) {
  const cookies = loadCookies();
  if (!cookies?.length) return false;
  await context.addCookies(cookies);
  console.error(`[creators] ${cookies.length} cookies injetados`);
  return true;
}

function episodesUrl() {
  const cfg = loadConfig();
  return (
    cfg?.episodesUrl ||
    process.env.CREATORS_EPISODES_URL ||
    DEFAULT_CREATORS_URL
  );
}

export async function creatorsLogin({ headless = false } = {}) {
  await ensureProfile();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts(headless));
  await applySavedCookies(context);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(episodesUrl(), { waitUntil: "domcontentloaded" });
  console.error(
    "[login] Se pedir login, autentique nesta janela.\n" +
      "[login] Quando a lista de episódios carregar, volte ao terminal e pressione Enter."
  );
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
  await context.close();
  console.error("[login] Perfil salvo em", PROFILE_DIR);
}

async function clickFirst(page, locators, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    for (const loc of locators) {
      try {
        const el = typeof loc === "function" ? loc() : loc;
        if ((await el.count()) > 0) {
          await el.first().click({ timeout: 3000 });
          return true;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    await page.waitForTimeout(250);
  }
  if (lastErr) throw lastErr;
  return false;
}

async function fillFirst(page, locators, value) {
  for (const loc of locators) {
    try {
      const el = typeof loc === "function" ? loc() : loc;
      if (await el.count()) {
        await el.first().fill(value, { timeout: 8000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function waitUntilLoggedIn(page, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/accounts\.spotify\.com|login\.spotify|signup/i.test(url)) {
      await page.waitForTimeout(2000);
      continue;
    }
    if ((await page.getByText(/all the tools to grow your show/i).count()) > 0) {
      await page.waitForTimeout(2000);
      continue;
    }
    const hasNew =
      (await page.getByRole("button", { name: /new episode|novo episódio/i }).count()) >
        0 ||
      (await page.getByRole("link", { name: /new episode|novo episódio/i }).count()) >
        0 ||
      (await page.getByText(/new episode|novo episódio/i).count()) > 0;
    const hasEpisodesNav =
      (await page.getByRole("link", { name: /^episodes$|^episódios$/i }).count()) > 0;
    if (
      /creators\.spotify\.com|podcasters\.spotify\.com/i.test(url) &&
      (hasNew || hasEpisodesNav)
    ) {
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(
    "Timeout esperando UI do Creators (New episode). Cookies podem ter expirado."
  );
}

async function dismissCookies(page) {
  for (const name of [
    /allow all/i,
    /accept all/i,
    /confirm my choices/i,
    /accept|agree|aceitar|concordo|got it/i,
  ]) {
    try {
      const btn = page.getByRole("button", { name });
      if (await btn.count()) await btn.first().click({ timeout: 1500 });
    } catch {
      /* ignore */
    }
  }
}

/** Close Zoom/crop modal after thumbnail upload (Save or Cancel). */
async function dismissZoomModal(page) {
  const dialog = page.getByRole("dialog").filter({ hasText: /zoom/i });
  const hasZoomLabel = (await page.getByText(/^zoom$/i).count()) > 0;
  if ((await dialog.count()) === 0 && !hasZoomLabel) return;

  console.error("[creators] fechando modal Zoom da thumbnail…");
  const root = (await dialog.count()) > 0 ? dialog.first() : page;
  const saved = await clickFirst(
    page,
    [
      () => root.getByRole("button", { name: /^save$|^salvar$/i }),
      () => root.getByRole("button", { name: /done|pronto|apply|aplicar/i }),
    ],
    8000
  );
  if (!saved) {
    await clickFirst(
      page,
      [() => root.getByRole("button", { name: /cancel|cancelar/i })],
      3000
    );
  }
  for (let i = 0; i < 40; i++) {
    const still =
      (await page.getByRole("dialog").filter({ hasText: /zoom/i }).count()) > 0 ||
      (await page.getByText(/^saving\.{0,3}$|^salvando/i).count()) > 0;
    if (!still && (await page.getByText(/^zoom$/i).count()) === 0) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400);
}

/**
 * Upload into the Thumbnails (16:9) section — never Episode art.
 * Episode art is a separate square field lower on the form; leave the show default.
 */
async function uploadThumbnail(page, imagePath) {
  const thumbSection = page
    .locator("section, div, form")
    .filter({
      has: page.getByRole("heading", { name: /^thumbnails?$|^miniaturas?$/i }),
    })
    .first();

  // Fallback: block that contains the 16:9 thumbnail copy
  const byCopy = page
    .locator("section, div")
    .filter({
      hasText: /horizontal image with a 16:9|imagem horizontal.*16:9|thumbnail image for your video/i,
    })
    .first();

  const root =
    (await thumbSection.count()) > 0
      ? thumbSection
      : (await byCopy.count()) > 0
        ? byCopy
        : null;

  if (root) {
    const input = root.locator('input[type="file"]').first();
    if ((await input.count()) > 0) {
      await input.setInputFiles(imagePath);
      console.error("[creators] thumbnail enviada (seção Thumbnails)");
      return true;
    }
    // Click Upload in that section and use filechooser
    const uploadBtn = root.getByRole("button", { name: /^upload$|^enviar$/i });
    if ((await uploadBtn.count()) > 0) {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 8000 }),
        uploadBtn.first().click(),
      ]);
      await chooser.setFiles(imagePath);
      console.error("[creators] thumbnail enviada (filechooser Thumbnails)");
      return true;
    }
  }

  // Last resort: first image file input that is NOT under Episode art
  const allImageInputs = page.locator(
    'input[type="file"][accept*="image"], input[type="file"][accept*="jpeg"], input[type="file"][accept*="png"]'
  );
  const n = await allImageInputs.count();
  for (let i = 0; i < n; i++) {
    const el = allImageInputs.nth(i);
    const inEpisodeArt = await el.evaluate((node) => {
      let cur = node;
      for (let d = 0; d < 12 && cur; d++) {
        const t = (cur.innerText || cur.textContent || "").toLowerCase();
        if (/episode art|arte do episódio|cover art/.test(t) && !/thumbnail|miniatura|16:9/.test(t)) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    });
    if (inEpisodeArt) continue;
    await el.setInputFiles(imagePath);
    console.error("[creators] thumbnail enviada (input #" + i + ", não Episode art)");
    return true;
  }

  console.error("[creators] AVISO: seção Thumbnails não encontrada — imagem não enviada");
  return false;
}

async function goToDashboard(page, baseUrl) {
  const target = baseUrl || episodesUrl();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2000);
  await dismissCookies(page);

  // If cookies worked we should already be on /pod/show/.../episodes
  if (/\/pod\/show\//i.test(page.url()) && !/accounts\.spotify\.com/i.test(page.url())) {
    console.error("[creators] sessão ok →", page.url());
    await waitUntilLoggedIn(page, 60_000);
    await dismissCookies(page);
    return;
  }

  // Marketing landing → Get started / Log in
  const onMarketing =
    (await page.getByText(/all the tools to grow your show/i).count()) > 0 ||
    (await page.getByRole("link", { name: /^get started$/i }).count()) > 0;

  if (onMarketing) {
    const entered = await clickFirst(
      page,
      [
        () => page.getByRole("link", { name: /^get started$/i }),
        () => page.getByRole("button", { name: /^get started$/i }),
        () => page.getByRole("link", { name: /log in|sign in|entrar|login/i }),
      ],
      8000
    );
    if (entered) {
      console.error("[creators] clicou Get started / login");
      await page.waitForTimeout(2000);
    }
  }

  // Prefer configured show episodes URL
  const preferred = episodesUrl();
  if (preferred && preferred !== DEFAULT_CREATORS_URL) {
    await page.goto(preferred, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
  }

  if (/accounts\.spotify\.com|login/i.test(page.url())) {
    console.error(
      "[creators] Sessão inválida/expirada. Atualize cookies com: import-curl"
    );
  }

  await waitUntilLoggedIn(page, 60_000);
  await dismissCookies(page);
}

export async function publishViaCreators(episode, opts = {}) {
  const headless = opts.headless ?? false;
  const baseUrl = opts.baseUrl ?? DEFAULT_CREATORS_URL;
  // Always draft unless explicitly draft=0/false
  const draft = !(episode.draft === 0 || episode.draft === false);

  if (!fs.existsSync(episode.video_path)) {
    throw new Error(`video_path missing: ${episode.video_path}`);
  }

  await ensureProfile();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts(headless));
  await applySavedCookies(context);
  const page = context.pages()[0] || (await context.newPage());
  const shotDir = path.join(path.dirname(episode.video_path), "..", "..", "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });

  const failShot = async (label) => {
    const p = path.join(shotDir, `${episode.id}-${label}-${Date.now()}.png`);
    try {
      await page.screenshot({ path: p, fullPage: true });
      console.error(`[creators] screenshot → ${p}`);
    } catch {
      /* ignore */
    }
  };

  try {
    await goToDashboard(page, opts.baseUrl || episodesUrl());

    // Ensure New episode is visible before clicking
    await page.getByText(/new episode|novo episódio/i).first().waitFor({
      state: "visible",
      timeout: 30_000,
    });

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
      // Direct URL fallback
      const cfg = loadConfig();
      if (cfg?.showId) {
        const newUrl = `https://creators.spotify.com/pod/show/${cfg.showId}/episode/new`;
        console.error("[creators] fallback goto", newUrl);
        await page.goto(newUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
      } else {
        await failShot("no-new-episode");
        throw new Error("Não achei o botão New Episode — UI pode ter mudado.");
      }
    }

    await page.waitForTimeout(1500);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 30_000 });
    await fileInput.setInputFiles(episode.video_path);
    console.error("[creators] upload iniciado:", episode.video_path);

    // Wait until Details step (title field) or Preview ready
    for (let i = 0; i < 180; i++) {
      const details =
        (await page.getByLabel(/title|título/i).count()) > 0 ||
        (await page.getByText(/^details$|^detalhes$/i).count()) > 0 ||
        (await page.getByText(/preview ready|pré-visualização pronta/i).count()) > 0;
      const uploading =
        (await page.getByText(/uploading|enviando|processing|processando/i).count()) >
        0;
      if (details && !uploading) break;
      await page.waitForTimeout(2000);
      if (i % 15 === 0) {
        console.error(`[creators] aguardando upload → Details… (${i * 2}s)`);
      }
    }

    // Dismiss thumbnail Zoom/crop modal if present
    await dismissZoomModal(page);

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
        [
          () => page.locator('input[type="text"]').first(),
        ],
        episode.title.slice(0, 200)
      );
    }

    // Description is REQUIRED on Creators
    await dismissCookies(page);
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
        await failShot("no-description");
        throw new Error("Campo Description obrigatório não encontrado.");
      }
      console.error("[creators] descrição preenchida");
    }

    // Thumbnail (16:9) — never Episode art (square, show default)
    if (episode.image_path && fs.existsSync(episode.image_path)) {
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
      await page.waitForTimeout(2000);
      if (i % 15 === 0) {
        console.error(`[creators] aguardando Preview ready… (${i * 2}s)`);
      }
    }

    if (draft) {
      // Creators: draft via Close (X) → "Save draft" (Review only has Publish)
      const closed = await clickFirst(
        page,
        [
          () => page.getByRole("button", { name: /^close$|^fechar$/i }),
          () => page.locator('button[aria-label="Close"], button[aria-label="Fechar"]'),
          () => page.locator('[aria-label*="close" i]').first(),
        ],
        10_000
      );
      if (!closed) {
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
        await failShot("no-save-draft");
        throw new Error('Botão "Save draft" não apareceu após fechar o editor.');
      }
      console.error("[creators] Save draft clicado");
      for (let i = 0; i < 40; i++) {
        if ((await page.getByText(/new episode|novo episódio/i).count()) > 0) break;
        if (/\/episodes\/?$/i.test(page.url())) break;
        await page.waitForTimeout(500);
      }
    } else {
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
    await failShot("done");
    console.error("[creators] fluxo concluído para", episode.id);
  } catch (err) {
    await failShot("error");
    throw err;
  } finally {
    await context.close();
  }
}
