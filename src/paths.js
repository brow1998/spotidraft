import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

/** Read-only app / resources root (bundled assets in Electron). */
export const RESOURCES =
  process.env.SPOTIDRAFT_RESOURCES || PKG_ROOT;

/** Project / legacy root (config fallback). */
export const ROOT = process.env.SPOTIDRAFT_ROOT || PKG_ROOT;

/** Writable data (queue, downloads, config). */
export const DATA_DIR =
  process.env.SPOTIDRAFT_DATA || path.join(ROOT, "data");

export const PACKAGES_DIR = path.join(DATA_DIR, "packages");
export const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
export const DB_PATH = path.join(DATA_DIR, "queue.sqlite");

/** Playwright persistent profile + cookies. */
export const PROFILE_DIR =
  process.env.SPOTIDRAFT_PROFILE ||
  path.join(ROOT, "profiles", "creators");

export const WEB_DIST = path.join(RESOURCES, "web", "dist");

export const DEFAULT_CREATORS_URL = "https://creators.spotify.com/";
