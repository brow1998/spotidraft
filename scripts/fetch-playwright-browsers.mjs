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
const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "install", "chromium"],
  { cwd: ROOT, env, stdio: "inherit" }
);
process.exit(r.status ?? 1);
