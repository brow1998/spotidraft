import fs from "node:fs";
import { getEpisode, upsertEpisode } from "./db.js";
import { discoverYtdlpEpisode } from "./package-episode.js";

/** Build episode row from a yt-dlp .mp4 (uses sidecar info/description/jpg). */
export function episodeFromYtdlpMp4(mp4Path) {
  const discovered = discoverYtdlpEpisode(mp4Path);
  let title = discovered.id;
  let description = "";
  if (fs.existsSync(discovered.infoJsonPath)) {
    const info = JSON.parse(fs.readFileSync(discovered.infoJsonPath, "utf8"));
    title = info.title || info.fulltitle || title;
    description = info.description || "";
  } else if (fs.existsSync(discovered.descriptionPath)) {
    description = fs.readFileSync(discovered.descriptionPath, "utf8");
  }
  return {
    id: discovered.id,
    title,
    description,
    video_path: discovered.videoPath,
    image_path: fs.existsSync(discovered.imagePath)
      ? discovered.imagePath
      : null,
    meta_path: discovered.infoJsonPath,
  };
}

/**
 * Enqueue mp4 paths as draft episodes.
 * @returns {{ queued: string[], skipped: string[] }}
 */
export function enqueueMp4Paths(
  mp4Paths,
  { skipPublished = true, draft = true } = {}
) {
  const queued = [];
  const skipped = [];
  for (const mp4 of mp4Paths) {
    const pkg = episodeFromYtdlpMp4(mp4);
    if (skipPublished) {
      const existing = getEpisode(pkg.id);
      if (existing?.status === "published") {
        skipped.push(pkg.id);
        continue;
      }
    }
    upsertEpisode({ ...pkg, draft });
    queued.push(pkg.id);
  }
  return { queued, skipped };
}
