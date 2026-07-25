#!/usr/bin/env node
/**
 * Download platform yt-dlp into vendor/yt-dlp for Electron packaging.
 * Playwright Chromium: npm run electron:browsers
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "vendor", "yt-dlp");

const ASSETS = {
  linux: {
    url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
    name: "yt-dlp",
  },
  darwin: {
    url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    name: "yt-dlp",
  },
  win32: {
    url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    name: "yt-dlp.exe",
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const go = (u) => {
      https
        .get(u, (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            return go(res.headers.location);
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
        })
        .on("error", reject);
    };
    go(url);
  });
}

const plat = process.platform;
const spec = ASSETS[plat];
if (!spec) {
  console.error(`Unsupported platform: ${plat}`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const dest = path.join(OUT, spec.name);
console.error(`Downloading ${spec.url}`);
await download(spec.url, dest);
if (plat !== "win32") fs.chmodSync(dest, 0o755);
console.error(`Saved ${dest}`);

try {
  execFileSync(dest, ["--version"], { stdio: "inherit" });
} catch {
  console.error(
    "yt-dlp downloaded but --version failed (ok if no python on path for zip builds)"
  );
}
