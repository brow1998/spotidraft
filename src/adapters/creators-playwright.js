import { chromium } from "playwright";
import { PROFILE_DIR } from "../paths.js";
import { openCreatorsSession } from "./creators-session.js";
import { withProfileLease } from "./profile-lease.js";
import {
  applySavedCookies,
  ensureProfile,
  episodesUrl,
  launchOpts,
} from "./creators-dom.js";

/**
 * Public surface kept for the CLI. The batch pipeline uses
 * `openCreatorsSession` directly so it can reuse one browser across episodes.
 */

export async function creatorsLogin({ headless = false } = {}) {
  return withProfileLease(
    async () => {
      await ensureProfile();
      const context = await chromium.launchPersistentContext(
        PROFILE_DIR,
        launchOpts(headless)
      );
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
    },
    { timeoutMs: 0, label: "login interativo" }
  );
}

/** One-shot publish: open a session, use it once, close it. */
export async function publishViaCreators(episode, opts = {}) {
  const session = await openCreatorsSession({
    headless: opts.headless ?? false,
    baseUrl: opts.baseUrl,
  });
  try {
    await session.publish(episode);
  } finally {
    await session.close();
  }
}
