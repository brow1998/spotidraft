import fs from "node:fs";
import path from "node:path";
import { PROFILE_DIR, DATA_DIR } from "./paths.js";

export const COOKIES_PATH = path.join(PROFILE_DIR, "cookies.json");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");

/** Parse a curl -b / Cookie header into Playwright cookie objects. */
export function parseCookieHeader(header) {
  const out = [];
  for (const part of header.split(";")) {
    const raw = part.trim();
    if (!raw) continue;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const name = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      value,
      domain: ".spotify.com",
      path: "/",
    });
  }
  return out;
}

/** Extract Cookie string from a full curl command text. */
export function extractCookieFromCurl(curlText) {
  const m =
    curlText.match(/-b\s+'([^']+)'/) ||
    curlText.match(/-b\s+"([^"]+)"/) ||
    curlText.match(/--cookie\s+'([^']+)'/) ||
    curlText.match(/Cookie:\s*'([^']+)'/i) ||
    curlText.match(/Cookie:\s*"([^"]+)"/i);
  if (m) return m[1];
  if (!curlText.includes("curl ") && curlText.includes("=") && curlText.includes(";")) {
    return curlText.trim();
  }
  throw new Error("Não achei -b / Cookie no texto do curl");
}

export function extractShowUrlFromCurl(curlText) {
  const m =
    curlText.match(/curl\s+'([^']+)'/) ||
    curlText.match(/curl\s+"([^"]+)"/) ||
    curlText.match(
      /https:\/\/creators\.spotify\.com\/pod\/show\/[A-Za-z0-9]+(?:\/[^\s'"]*)?/
    );
  if (!m) return null;
  const url = m[1] || m[0];
  const show = url.match(
    /https:\/\/creators\.spotify\.com\/pod\/show\/([A-Za-z0-9]+)/
  );
  if (!show) return url;
  return {
    showId: show[1],
    episodesUrl: `https://creators.spotify.com/pod/show/${show[1]}/episodes`,
    homeUrl: `https://creators.spotify.com/home/show/${show[1]}`,
  };
}

export function saveCookies(cookies) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

export function loadCookies() {
  if (!fs.existsSync(COOKIES_PATH)) return null;
  return JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
}

export function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const prev = loadConfig() || {};
  const next = { ...prev, ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

export function importFromCurl(curlText) {
  const header = extractCookieFromCurl(curlText);
  const cookies = parseCookieHeader(header);
  saveCookies(cookies);
  const show = extractShowUrlFromCurl(curlText);
  if (show && typeof show === "object") {
    saveConfig({
      showId: show.showId,
      episodesUrl: show.episodesUrl,
      homeUrl: show.homeUrl,
    });
  }
  return {
    cookieCount: cookies.length,
    hasSpDc: cookies.some((c) => c.name === "sp_dc"),
    hasAnchor: cookies.some((c) => c.name === "anchorpw_s"),
    show,
  };
}
