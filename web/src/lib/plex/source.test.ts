import { describe, expect, it } from "vitest";
import { deriveVideoSource, formatAudio, formatResolution, formatSubtitles } from "./source";

// A Plex Media entry with a single video stream carrying the given colour fields.
const vid = (videoResolution: string, height: number, video: { colorTrc?: string; DOVIPresent?: boolean } = {}) => ({
  videoResolution,
  height,
  Part: [{ Stream: [{ streamType: 1, ...video }] }],
});
const EMPTY = { videoResolution: null, hdrFormat: null, audioTracks: [], subtitleLangs: [] };

describe("deriveVideoSource", () => {
  it("returns empties for no media", () => {
    expect(deriveVideoSource([])).toEqual(EMPTY);
    expect(deriveVideoSource(null)).toEqual(EMPTY);
  });

  it("reads a plain SDR 1080p source", () => {
    expect(deriveVideoSource([vid("1080", 1080, { colorTrc: "bt709" })])).toEqual({
      videoResolution: "1080",
      hdrFormat: null,
      audioTracks: [],
      subtitleLangs: [],
    });
  });

  it("labels HDR10, HLG, and Dolby Vision (over its HDR10 base)", () => {
    expect(deriveVideoSource([vid("4k", 2160, { colorTrc: "smpte2084" })]).hdrFormat).toBe("HDR10");
    expect(deriveVideoSource([vid("4k", 2160, { colorTrc: "arib-std-b67" })]).hdrFormat).toBe("HLG");
    expect(deriveVideoSource([vid("4k", 2160, { colorTrc: "smpte2084", DOVIPresent: true })]).hdrFormat).toBe(
      "Dolby Vision · HDR10",
    );
  });

  it("picks the best of several versions (highest resolution)", () => {
    const s = deriveVideoSource([
      vid("1080", 1080, { colorTrc: "bt709" }),
      vid("4k", 2160, { colorTrc: "smpte2084", DOVIPresent: true }),
    ]);
    expect(s.videoResolution).toBe("4k");
  });

  it("prefers the Dolby Vision copy over an equal-resolution SDR sibling listed first", () => {
    const s = deriveVideoSource([
      vid("4k", 2160, { colorTrc: "bt709" }), // SDR, listed first
      vid("4k", 2160, { colorTrc: "smpte2084", DOVIPresent: true }), // 4K DV
    ]);
    expect(s.hdrFormat).toBe("Dolby Vision · HDR10");
  });

  it("extracts distinct audio languages (flagging Atmos) and subtitle languages from the best copy", () => {
    const s = deriveVideoSource([
      {
        videoResolution: "4k",
        height: 2160,
        Part: [
          {
            Stream: [
              { streamType: 1, colorTrc: "smpte2084", DOVIPresent: true },
              { streamType: 2, language: "English", displayTitle: "English (TrueHD Atmos)" },
              { streamType: 2, language: "English", displayTitle: "English (AC3 5.1)" }, // dup language
              { streamType: 2, language: "French" },
              { streamType: 2 }, // no language → skipped
              { streamType: 3, language: "English" },
              { streamType: 3, language: "Spanish" },
              { streamType: 3, language: "English" }, // dup
            ],
          },
        ],
      },
    ]);
    expect(s.audioTracks).toEqual([
      { lang: "English", atmos: true },
      { lang: "French", atmos: false },
    ]);
    expect(s.subtitleLangs).toEqual(["English", "Spanish"]);
  });
});

describe("formatResolution", () => {
  it("normalizes Plex resolution tokens for display", () => {
    expect(formatResolution("4k")).toBe("4K");
    expect(formatResolution("8k")).toBe("8K");
    expect(formatResolution("1080")).toBe("1080p");
    expect(formatResolution("720")).toBe("720p");
    expect(formatResolution("sd")).toBe("SD");
    expect(formatResolution(null)).toBe("");
    expect(formatResolution("")).toBe("");
  });
});

describe("formatAudio / formatSubtitles", () => {
  it("joins audio languages with Atmos and caps the rest as +N more", () => {
    const tracks = [
      { lang: "English", atmos: true },
      { lang: "French", atmos: false },
      { lang: "Spanish", atmos: false },
      { lang: "German", atmos: false },
      { lang: "Italian", atmos: false },
    ];
    expect(formatAudio(tracks)).toEqual({ text: "English (Atmos) · French · Spanish · German", more: 1 });
  });

  it("joins subtitle languages and caps the rest as +N more", () => {
    expect(formatSubtitles(["English", "Spanish", "French", "German", "Italian"])).toEqual({
      text: "English · Spanish · French",
      more: 2,
    });
    expect(formatSubtitles(["English"])).toEqual({ text: "English", more: 0 });
    expect(formatSubtitles([])).toEqual({ text: "", more: 0 });
  });
});
