#!/usr/bin/env node
/** Install Playwright Chromium into vendor/ms-playwright for packaging. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(ROOT, "vendor", "ms-playwright");

const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: dest,
};

console.error(`Installing Chromium → ${dest}`);

const isWin = process.platform === "win32";
const r = spawnSync(
  isWin ? "npx.cmd" : "npx",
  ["playwright", "install", "chromium"],
  {
    cwd: ROOT,
    env,
    stdio: "inherit",
    // Node 22 refuses to spawn .cmd/.bat directly (CVE-2024-27980), failing
    // with EINVAL. Without this the Windows build dies here every time.
    shell: isWin,
  }
);

if (r.error) {
  console.error(`[browsers] falhou ao executar npx: ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`[browsers] npx playwright install saiu com código ${r.status}`);
}
process.exit(r.status ?? 1);
