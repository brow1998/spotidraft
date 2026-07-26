import fs from "node:fs";
import { chromium } from "playwright";
import { PROFILE_DIR } from "../paths.js";
import { loadConfig, loadCookies } from "../session.js";
import { withProfileLease } from "./profile-lease.js";
import {
  dismissCookies,
  episodesUrl,
  launchOpts,
} from "./creators-dom.js";

async function withCreatorsPage(fn, { headless = true } = {}) {
  // Chromium locks the profile dir exclusively, and the upload pipeline can
  // hold it for a whole batch — queue behind it instead of failing to launch.
  return withProfileLease(
    async () => {
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
    },
    { label: "catálogo do Creators" }
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
  // Creators UI chrome and stray a11y strings that a DOM scan can pick up.
  if (
    /^(checkbox|button|label|link|menu|dialog|image|avatar|loading|notifications?|home|episodes?|analytics|comments|monetize|settings|create|wizard|olá.*)$/i.test(
      t
    )
  ) {
    return false;
  }
  // "checkbox label", "button close" — two generic UI words in a row.
  if (/\b(checkbox|button|label|aria|role|tooltip|placeholder)\b/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Read the show name out of the sidebar, anchored to the cover image.
 *
 * The Creators nav lives in shadow DOM, which `page.evaluate` +
 * `querySelectorAll` cannot see — the old scan only reached the light DOM and
 * came back with things like "checkbox label". Playwright locators pierce
 * shadow roots, so we find the cover with one and walk up from there: the name
 * is the nearest ancestor that actually has text.
 */
async function scrapeShowNameFromNav(page) {
  const cover = page
    .locator(
      'img[src*="podcast_uploaded"], img[src*="anchor-generated-image-bank"]'
    )
    .first();

  try {
    await cover.waitFor({ state: "attached", timeout: 8000 });
  } catch {
    return null;
  }

  const found = await cover
    .evaluate((img) => {
      let cur = img;
      for (let d = 0; d < 6 && cur.parentElement; d++) {
        cur = cur.parentElement;
        const t = (cur.innerText || "").trim().replace(/\s+/g, " ");
        // First ancestor with short, single-line text is the show title.
        if (t && t.length <= 60 && !t.includes("\n")) return t;
      }
      return null;
    })
    .catch(() => null);

  return isValidShowName(found) ? found.trim() : null;
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

  const name = await scrapeShowNameFromNav(page);

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

/**
 * Park the page on the episodes list and wait for the table to hydrate.
 *
 * Callers arrive here from the show home (scrapeShowMeta navigates there for
 * the name and cover), so we cannot assume the episodes table is on screen.
 */
async function ensureEpisodesPage(page) {
  const target = episodesUrl();
  if (!target) throw new Error("episodesUrl não configurada — importe o cURL de novo.");

  if (!/\/episodes\/?$/i.test(page.url())) {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);
    await dismissCookies(page);
  }

  if (/accounts\.spotify\.com|login/i.test(page.url())) {
    throw new Error(
      "Sessão do Creators expirada — cole um novo cURL na aba Sessão."
    );
  }

  // The list is an SPA table; give it a chance to render before scraping.
  try {
    await page.locator("table tbody tr").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
  } catch {
    // An empty show has no rows at all — that is a valid, non-error state.
    const emptyState =
      (await page.getByText(/no episodes|nenhum episódio/i).count()) > 0;
    if (!emptyState) {
      throw new Error(
        "A lista de episódios não carregou — o Creators pode ter mudado a página."
      );
    }
  }
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
