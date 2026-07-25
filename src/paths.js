import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const PACKAGES_DIR = path.join(DATA_DIR, "packages");
export const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
export const DB_PATH = path.join(DATA_DIR, "queue.sqlite");
export const PROFILE_DIR = path.join(ROOT, "profiles", "creators");
export const DEFAULT_CREATORS_URL = "https://creators.spotify.com/";
