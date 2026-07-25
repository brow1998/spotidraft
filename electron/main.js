import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

let mainWindow = null;
let httpServer = null;

function configurePaths() {
  const userData = app.getPath("userData");
  process.env.SPOTIDRAFT_DATA = path.join(userData, "data");
  process.env.SPOTIDRAFT_PROFILE = path.join(userData, "profiles", "creators");
  process.env.SPOTIDRAFT_ROOT = userData;

  if (app.isPackaged) {
    process.env.SPOTIDRAFT_RESOURCES = process.resourcesPath;
    const yt =
      process.platform === "win32"
        ? path.join(process.resourcesPath, "bin", "yt-dlp.exe")
        : path.join(process.resourcesPath, "bin", "yt-dlp");
    if (fs.existsSync(yt)) process.env.YT_DLP = yt;
    const browsers = path.join(process.resourcesPath, "ms-playwright");
    if (fs.existsSync(browsers)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    }
  } else {
    process.env.SPOTIDRAFT_RESOURCES = PKG_ROOT;
    const yt = path.join(PKG_ROOT, "vendor", "yt-dlp", "yt-dlp");
    const ytExe = path.join(PKG_ROOT, "vendor", "yt-dlp", "yt-dlp.exe");
    if (fs.existsSync(yt)) process.env.YT_DLP = yt;
    else if (fs.existsSync(ytExe)) process.env.YT_DLP = ytExe;
    const browsers = path.join(PKG_ROOT, "vendor", "ms-playwright");
    if (fs.existsSync(browsers)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    }
  }

  fs.mkdirSync(process.env.SPOTIDRAFT_DATA, { recursive: true });
  fs.mkdirSync(process.env.SPOTIDRAFT_PROFILE, { recursive: true });
}

async function bootServer() {
  const { startServer } = await import("../src/server/index.js");
  const started = await startServer({ port: 0, host: "127.0.0.1" });
  httpServer = started.server;
  return started;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Spotidraft",
    backgroundColor: "#121212",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      configurePaths();
      const { url } = await bootServer();
      createWindow(url);
    } catch (e) {
      console.error("[spotidraft-electron]", e);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (httpServer) {
      try {
        httpServer.close();
      } catch {
        /* ignore */
      }
    }
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 8787;
      createWindow(`http://127.0.0.1:${port}`);
    }
  });
}
