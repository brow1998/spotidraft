import fs from "node:fs";
import { DEFAULT_CREATORS_URL, PROFILE_DIR } from "../paths.js";
import { loadConfig, loadCookies } from "../session.js";

/**
 * DOM-level helpers for driving creators.spotify.com. No browser lifecycle
 * here — callers own the context (see creators-session.js).
 */

export async function ensureProfile() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

export function launchOpts(headless) {
  return {
    headless,
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
}

export async function applySavedCookies(context) {
  const cookies = loadCookies();
  if (!cookies?.length) return false;
  await context.addCookies(cookies);
  console.error(`[creators] ${cookies.length} cookies injetados`);
  return true;
}

export function episodesUrl() {
  const cfg = loadConfig();
  return (
    cfg?.episodesUrl ||
    process.env.CREATORS_EPISODES_URL ||
    DEFAULT_CREATORS_URL
  );
}

export async function clickFirst(page, locators, timeout = 8000) {
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

export async function fillFirst(page, locators, value) {
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

export async function waitUntilLoggedIn(page, timeoutMs = 180_000) {
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

/**
 * Union of the two consent-banner handlers that used to live separately in the
 * upload and catalog adapters: the name patterns from one, the OneTrust close
 * button and settle delay from the other. Strictly more capable than either.
 */
export async function dismissCookies(page) {
  for (const name of [
    /allow all/i,
    /accept all/i,
    /aceitar todos|permitir todos/i,
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
  // Some OneTrust variants only offer an X, not an accept button.
  try {
    const close = page.locator(
      '#onetrust-close-btn-container button, .onetrust-close-btn-handler'
    );
    if (await close.count()) await close.first().click({ timeout: 1500 });
  } catch {
    /* ignore */
  }
  await page.waitForTimeout(400);
}

/** Close Zoom/crop modal after thumbnail upload (Save or Cancel). */
export async function dismissZoomModal(page) {
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
export async function uploadThumbnail(page, imagePath) {
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

export async function goToDashboard(page, baseUrl) {
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

/**
 * Cheap check that we are still parked on a usable dashboard, for reuse between
 * episodes. Falls back to the full goToDashboard only when this fails, which is
 * what lets episodes 2..N skip the 60s login wait.
 */
export async function ensureDashboard(page, timeoutMs = 10_000) {
  if (!/\/pod\/show\//i.test(page.url())) return false;
  if (/accounts\.spotify\.com|login/i.test(page.url())) return false;
  try {
    await page
      .getByText(/new episode|novo episódio/i)
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
