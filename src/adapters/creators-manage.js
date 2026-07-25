import fs from "node:fs";
import { chromium } from "playwright";
import { DEFAULT_CREATORS_URL, PROFILE_DIR } from "../paths.js";
import { loadConfig, loadCookies } from "../session.js";

function launchOpts(headless) {
  return {
    headless,
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
}

async function withCreatorsPage(fn, { headless = true } = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    launchOpts(headless)
  );
  const cookies = loadCookies();
  if (cookies?.length) await context.addCookies(cookies);
  const page = context.pages()[0] || (await context.newPage());
  try {
    return await fn(page, context);
  } finally {
    await context.close();
  }
}

function episodesUrl() {
  const cfg = loadConfig();
  return (
    cfg?.episodesUrl ||
    process.env.CREATORS_EPISODES_URL ||
    DEFAULT_CREATORS_URL
  );
}

function homeUrl() {
  const cfg = loadConfig();
  if (cfg?.homeUrl) return cfg.homeUrl;
  const showId = cfg?.showId;
  if (showId) return `https://creators.spotify.com/home/show/${showId}`;
  return null;
}

/** Reject CTA labels / junk scraped from SPA shells. */
export function isValidShowName(name) {
  if (!name || typeof name !== "string") return false;
  const t = name.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/^new episode$|^novo episódio$/i.test(t)) return false;
  if (/^[{}\[\]"'0-9.\s]+$/.test(t)) return false;
  if (t === "{}" || t === "[]" || /^\[object /i.test(t)) return false;
  // Cookie / privacy / OneTrust copy
  if (
    /store and access|cookie|privacy|consent|allow all|accept all|preference|onetrust|informação|dispositivo/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

async function dismissCookies(page) {
  try {
    const allow = page.getByRole("button", {
      name: /allow all|accept all|aceitar todos|permitir todos/i,
    });
    if (await allow.count()) await allow.first().click({ timeout: 2000 });
  } catch {
    /* ignore */
  }
  try {
    const close = page.locator(
      '#onetrust-close-btn-container button, button[aria-label*="Close" i], .onetrust-close-btn-handler'
    );
    if (await close.count()) await close.first().click({ timeout: 1500 });
  } catch {
    /* ignore */
  }
  await page.waitForTimeout(400);
}

/**
 * Show name lives on the home page ("Gweek"), not on the episodes list
 * (which starts with the "New episode" CTA).
 */
async function scrapeShowName(page) {
  const meta = await scrapeShowMeta(page);
  return meta?.name || null;
}

async function scrapeShowMeta(page) {
  const cfg = loadConfig() || {};
  const home = homeUrl();
  const episodes = episodesUrl();
  // Cover is in the logged-in nav header (shadow DOM) — Playwright pierces it.
  // Prefer home/episodes; no need for Show settings.
  const startUrl = home || episodes;
  if (!startUrl) return null;

  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissCookies(page);
  await page.waitForTimeout(400);

  let imageUrl = null;
  try {
    const cover = page.locator(
      'nav img[src*="anchor-generated-image-bank"], nav img[src*="podcast_uploaded"], nav header img, nav img'
    );
    await cover.first().waitFor({ state: "visible", timeout: 10_000 });
    const count = await cover.count();
    for (let i = 0; i < count; i++) {
      const src = await cover.nth(i).getAttribute("src");
      if (
        src &&
        src.startsWith("http") &&
        !/onetrust|cookielaw|braze|pixel/i.test(src)
      ) {
        imageUrl = src;
        break;
      }
    }
  } catch {
    /* no nav cover yet */
  }

  const name = await page.evaluate(() => {
    const skip =
      /customize|publish|launch|setup|email|episode|spotify|home|analytics|comments|monetize|settings|privacy|cookie|store and access|consent|allow all|new episode|novo episódio|create|your shows/i;
    const bad = (t) =>
      !t ||
      t.length < 2 ||
      t.length > 40 ||
      t.split(/\s+/).length > 4 ||
      skip.test(t);

    // Prefer text next to the show avatar in the sidebar/nav
    const nodes = [...document.querySelectorAll("nav span, nav div, h1, h2, span")];
    const candidates = [];
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (bad(t)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.top > 220) continue;
      if (rect.left > 320) continue;
      candidates.push({ t, top: rect.top, left: rect.left });
    }
    candidates.sort((a, b) => a.top - b.top || a.left - b.left);
    return candidates[0]?.t || null;
  });

  return {
    name: isValidShowName(name) ? name.trim() : null,
    imageUrl:
      typeof imageUrl === "string" && imageUrl.startsWith("http")
        ? imageUrl
        : null,
  };
}

async function scrapeEpisodesOnPage(page) {
  return page.evaluate(() => {
    const rows = [];
    const trs = Array.from(document.querySelectorAll("table tbody tr"));
    for (const tr of trs) {
      const cells = Array.from(tr.querySelectorAll("td"));
      if (cells.length < 2) continue;

      const titleLink =
        cells[0]?.querySelector("a[href*='/episode/']") ||
        tr.querySelector("a[href*='/episode/']");
      const title = (
        titleLink?.textContent ||
        cells[0]?.innerText ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ");
      if (!title || title.length < 2 || title === "0") continue;
      if (/^new episode$|^novo episódio$/i.test(title)) continue;

      const cellText = (i) => (cells[i]?.innerText || "").trim();
      rows.push({
        title,
        status: cellText(1) || null,
        date: cellText(2) || null,
        format: cellText(3) || null,
        length: cellText(4) || null,
        href: titleLink?.getAttribute("href") || null,
        thumb:
          tr.querySelector("img")?.getAttribute("src") ||
          tr.querySelector("img")?.src ||
          null,
      });
    }
    return rows;
  });
}

async function scrapeAllEpisodes(page) {
  const all = [];
  const seen = new Set();
  const maxPages = 30;

  // Retry first page if SPA still hydrating
  let first = await scrapeEpisodesOnPage(page);
  for (let attempt = 0; attempt < 5 && first.length === 0; attempt++) {
    await page.waitForTimeout(800);
    first = await scrapeEpisodesOnPage(page);
  }

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const batch = pageIdx === 0 ? first : await scrapeEpisodesOnPage(page);
    for (const row of batch) {
      const key = row.href || row.title;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }

    const next = page.getByRole("button", {
      name: /load the next page of episodes|next page/i,
    });
    if ((await next.count()) === 0) break;
    const disabled =
      (await next.first().getAttribute("aria-disabled")) === "true" ||
      (await next.first().isDisabled().catch(() => false));
    if (disabled) break;

    const before = await page
      .locator("table tbody tr")
      .first()
      .innerText()
      .catch(() => "");
    await next.first().click();
    await page.waitForTimeout(900);
    try {
      await page.waitForFunction(
        (prev) => {
          const t =
            document.querySelector("table tbody tr")?.innerText || "";
          return t && t !== prev;
        },
        before,
        { timeout: 8000 }
      );
      await page
        .waitForFunction(
          () => {
            const link = document.querySelector(
              "table tbody tr td a[href*='/episode/']"
            );
            return ((link?.textContent || "").trim().length > 2);
          },
          { timeout: 8000 }
        )
        .catch(() => {});
    } catch {
      break;
    }
  }

  return all;
}

/**
 * Scrape show metadata + episode rows from Creators Episodes page.
 */
export async function fetchCreatorsCatalog({ headless = true } = {}) {
  return withCreatorsPage(async (page) => {
    const cfg = loadConfig() || {};
    let showName = isValidShowName(cfg.showName) ? cfg.showName.trim() : null;
    let showImage = cfg.showImage || null;

    try {
      const scraped = await scrapeShowMeta(page);
      if (isValidShowName(scraped?.name)) showName = scraped.name.trim();
      if (scraped?.imageUrl) showImage = scraped.imageUrl;
    } catch {
      /* keep previous */
    }

    await ensureEpisodesPage(page);
    const episodes = await scrapeAllEpisodes(page);
    if (!showImage) {
      showImage = episodes.find((e) => e.thumb)?.thumb || null;
    }

    return {
      show: {
        name: showName || null,
        imageUrl: showImage || null,
        showId: cfg.showId || null,
        episodesUrl: cfg.episodesUrl || episodesUrl(),
        homeUrl: cfg.homeUrl || homeUrl(),
      },
      episodes,
      fetchedAt: new Date().toISOString(),
    };
  }, { headless });
}

/**
 * Delete episode by exact/partial title match on Creators UI.
 */
export async function deleteCreatorsEpisode({ title, headless = true } = {}) {
  if (!title) throw new Error("title obrigatório");
  return withCreatorsPage(async (page) => {
    await ensureEpisodesPage(page);

    for (let i = 0; i < 30; i++) {
      const row = page
        .locator("table tbody tr")
        .filter({ hasText: title })
        .first();
      if ((await row.count()) > 0) {
        const menuBtn = row.locator(
          'button[aria-label*="more" i], button[aria-label*="menu" i], button[aria-label*="ações" i], button:has-text("…"), button:has-text("...")'
        );
        if ((await menuBtn.count()) > 0) {
          await menuBtn.first().click();
        } else {
          await row.click({ button: "right" });
        }
        await page.waitForTimeout(500);

        const deleted = await (async () => {
          const candidates = [
            () => page.getByRole("menuitem", { name: /delete|excluir|remover/i }),
            () => page.getByRole("button", { name: /delete|excluir|remover/i }),
            () => page.getByText(/^delete$|^excluir$|^remover$/i),
          ];
          for (const c of candidates) {
            try {
              const el = c();
              if ((await el.count()) > 0) {
                await el.first().click({ timeout: 3000 });
                return true;
              }
            } catch {
              /* next */
            }
          }
          return false;
        })();

        if (!deleted) {
          throw new Error("Não achei ação Delete/Excluir no menu do episódio.");
        }

        await page.waitForTimeout(600);
        const confirm = page.getByRole("button", {
          name: /delete|excluir|confirm|confirmar|yes|sim/i,
        });
        if ((await confirm.count()) > 0) {
          await confirm.last().click();
        }
        await page.waitForTimeout(1500);
        return { ok: true, title };
      }

      const next = page.getByRole("button", {
        name: /load the next page of episodes|next page/i,
      });
      if ((await next.count()) === 0) break;
      const disabled =
        (await next.first().getAttribute("aria-disabled")) === "true" ||
        (await next.first().isDisabled().catch(() => false));
      if (disabled) break;
      await next.first().click();
      await page.waitForTimeout(900);
    }

    throw new Error(`Episódio não encontrado: ${title}`);
  }, { headless });
}
