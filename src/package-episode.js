import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PACKAGES_DIR } from "./paths.js";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function slugify(id) {
  return String(id).replace(/[^\w.-]+/g, "_").slice(0, 80);
}

/**
 * Build a Creators-ready package from yt-dlp outputs (or any mp4 + info).
 */
export async function packageEpisode(opts) {
  const {
    id,
    videoPath,
    infoJsonPath,
    descriptionPath,
    imagePath,
    reencode = true,
    maxHeight = 1080,
    clipSeconds,
  } = opts;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Vídeo não encontrado: ${videoPath}`);
  }

  let title = opts.title ?? "";
  let description = opts.description ?? "";

  let duration = opts.duration ?? null;
  if (infoJsonPath && fs.existsSync(infoJsonPath)) {
    const info = JSON.parse(fs.readFileSync(infoJsonPath, "utf8"));
    title = title || info.title || info.fulltitle || id;
    description = description || info.description || "";
    if (duration == null && info.duration != null) {
      duration = Number(info.duration);
    }
  }
  if (!description && descriptionPath && fs.existsSync(descriptionPath)) {
    description = fs.readFileSync(descriptionPath, "utf8");
  }
  if (!title) title = id;

  const dir = path.join(PACKAGES_DIR, slugify(id));
  fs.mkdirSync(dir, { recursive: true });

  const outVideo = path.join(dir, `${slugify(id)}.mp4`);
  // Creators video thumbnail (16:9) — not square episode art
  const outImage = path.join(dir, `${slugify(id)}.jpg`);
  const outMeta = path.join(dir, `${slugify(id)}.json`);

  if (reencode) {
    const vf = `scale=-2:'min(${maxHeight},ih)'`;
    const args = [
      "-y",
      "-i",
      videoPath,
      ...(clipSeconds ? ["-t", String(clipSeconds)] : []),
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outVideo,
    ];
    console.error(`[package] ffmpeg encode → ${outVideo}`);
    await run("ffmpeg", args);
  } else {
    fs.copyFileSync(videoPath, outVideo);
  }

  if (imagePath && fs.existsSync(imagePath)) {
    await run("ffmpeg", [
      "-y",
      "-i",
      imagePath,
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
      "-q:v",
      "2",
      outImage,
    ]);
  } else {
    await run("ffmpeg", [
      "-y",
      "-ss",
      "5",
      "-i",
      outVideo,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outImage,
    ]);
  }

  const meta = {
    id,
    title,
    description,
    video: path.basename(outVideo),
    image: path.basename(outImage),
    createdAt: new Date().toISOString(),
    sourceVideo: videoPath,
    clipSeconds: clipSeconds ?? null,
    duration: clipSeconds ?? duration ?? null,
  };
  fs.writeFileSync(outMeta, JSON.stringify(meta, null, 2));

  return {
    id,
    title,
    description,
    video_path: outVideo,
    image_path: outImage,
    meta_path: outMeta,
    dir,
  };
}

export function discoverYtdlpEpisode(mp4Path) {
  const abs = path.resolve(mp4Path);
  const base = abs.replace(/\.(mp4|m4a|webm)$/i, "");
  const m = path
    .basename(abs)
    .match(/\[([A-Za-z0-9_-]{6,})\]\.(mp4|m4a|webm)$/i);
  const id = m ? m[1] : path.basename(base);
  return {
    id,
    videoPath: abs,
    infoJsonPath: `${base}.info.json`,
    descriptionPath: `${base}.description`,
    imagePath: `${base}.jpg`,
  };
}
