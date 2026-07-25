import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeChannelInput,
  normalizeYtLang,
  sourceDirName,
} from "../src/download-ytdlp.js";

describe("normalizeYtLang", () => {
  it("defaults to pt", () => {
    assert.equal(normalizeYtLang(), "pt");
    assert.equal(normalizeYtLang(""), "pt");
  });

  it("maps pt-BR variants to pt (yt-dlp code)", () => {
    assert.equal(normalizeYtLang("pt-BR"), "pt");
    assert.equal(normalizeYtLang("pt_br"), "pt");
    assert.equal(normalizeYtLang("PT"), "pt");
  });

  it("maps en locale variants to en", () => {
    assert.equal(normalizeYtLang("en-US"), "en");
    assert.equal(normalizeYtLang("en_GB"), "en");
  });
});

describe("normalizeChannelInput", () => {
  it("accepts @handle", () => {
    const n = normalizeChannelInput("@Canalgweek");
    assert.equal(n.handle, "@Canalgweek");
    assert.match(n.canonicalUrl, /youtube\.com\/@Canalgweek$/);
    assert.match(n.videosUrl, /\/videos$/);
    assert.match(n.playlistsUrl, /\/playlists$/);
  });

  it("accepts full channel URL", () => {
    const n = normalizeChannelInput("https://www.youtube.com/@canalgweek");
    assert.ok(n.canonicalUrl.includes("youtube.com"));
  });

  it("rejects non-youtube", () => {
    assert.throws(() => normalizeChannelInput("https://example.com/x"), /YouTube/i);
  });
});

describe("sourceDirName", () => {
  it("uses video id from watch URL", () => {
    assert.equal(
      sourceDirName("https://www.youtube.com/watch?v=abc123XYZ"),
      "video-abc123XYZ"
    );
  });

  it("uses playlist id", () => {
    assert.equal(
      sourceDirName("https://www.youtube.com/playlist?list=PLabc"),
      "playlist-PLabc"
    );
  });
});
