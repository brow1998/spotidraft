/**
 * Render the app icon from the SVG source into the PNG electron-builder wants.
 *
 * We already ship Chromium for the Creators automation, so we reuse it rather
 * than adding an image-processing dependency just for this.
 *
 * Usage: node scripts/make-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "web", "public", "favicon.svg");
const OUT_DIR = path.join(ROOT, "electron", "assets");
const SIZE = 1024;

if (!fs.existsSync(SVG)) {
  console.error(`[icons] fonte não encontrada: ${SVG}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const svg = fs.readFileSync(SVG, "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});

// Transparent background so the rounded corners stay rounded on every platform.
await page.setContent(
  `<html><body style="margin:0;background:transparent">
     <div style="width:${SIZE}px;height:${SIZE}px">${svg
       .replace(/width="\d+"/, `width="${SIZE}"`)
       .replace(/height="\d+"/, `height="${SIZE}"`)}</div>
   </body></html>`,
  { waitUntil: "load" }
);

const out = path.join(OUT_DIR, "icon.png");
await page.screenshot({ path: out, omitBackground: true });
await browser.close();

console.error(`[icons] ${out} (${SIZE}x${SIZE})`);
