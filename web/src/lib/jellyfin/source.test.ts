import { describe, expect, it } from "vitest";
import { resolutionToken, resolveLanguage } from "@/lib/media/source";
import type { JellyfinMediaSource } from "./schemas";
import { deriveJellyfinSource } from "./source";

// A Jellyfin MediaSource built from a list of streams.
const source = (...streams: Record<string, unknown>[]): JellyfinMediaSource => ({ MediaStreams: streams as never });
const video = (Width: number, Height: number, VideoRangeType = "SDR") => ({
  Type: "Video",
  Width,
  Height,
  VideoRangeType,
});
const audio = (Language: string, extra: Record<string, unknown> = {}) => ({ Type: "Audio", Language, ...extra });
const subtitle = (Language: string) => ({ Type: "Subtitle", Language });

describe("resolutionToken", () => {
  it("maps standard dimensions to the same tokens Plex reports", () => {
    expect(resolutionToken(3840, 2160)).toBe("4k");
    expect(resolutionToken(1920, 1080)).toBe("1080");
    expect(resolutionToken(1280, 720)).toBe("720");
    expect(resolutionToken(854, 480)).toBe("480");
  });

  it("keeps cropped scope encodes at their nominal resolution", () => {
    // A 2.39:1 UHD film is narrower AND shorter than 3840×2160; a cropped 1080p is only 800 tall. Matching on
    // either dimension is what stops these being demoted a rung (real files from the library).
    expect(resolutionToken(3822, 2066)).toBe("4k");
    expect(resolutionToken(1920, 800)).toBe("1080");
    expect(resolutionToken(1788, 1080)).toBe("1080");
  });

  it("recognises PAL widescreen as 576, not 480 or 720", () => {
    expect(resolutionToken(720, 552)).toBe("576");
  });

  it("returns null when the dimensions are unknown", () => {
    expect(resolutionToken(null, null)).toBeNull();
    expect(resolutionToken(undefined, 0)).toBeNull();
  });
});

describe("resolveLanguage", () => {
  it("turns Jellyfin's ISO 639-2 codes into a display name and an ISO 639-1 code", () => {
    expect(resolveLanguage("eng")).toEqual({ name: "English", code: "en" });
    expect(resolveLanguage("rus")).toEqual({ name: "Russian", code: "ru" });
    expect(resolveLanguage("ukr")).toEqual({ name: "Ukrainian", code: "uk" });
  });

  it("handles both bibliographic and terminological 3-letter variants", () => {
    // "fre"/"fra" and "ger"/"deu" are the same language under two ISO 639-2 forms; both must land on one code so a
    // title's original-language audio check can't miss depending on which form the file was tagged with.
    expect(resolveLanguage("fre").code).toBe("fr");
    expect(resolveLanguage("fra").code).toBe("fr");
    expect(resolveLanguage("ger").code).toBe("de");
    expect(resolveLanguage("deu").code).toBe("de");
  });

  it("keeps only the primary subtag of a Plex-style BCP-47 tag", () => {
    expect(resolveLanguage("en-US").code).toBe("en");
    expect(resolveLanguage("pt-BR").code).toBe("pt");
  });

  it("treats undetermined and blank tags as unknown rather than inventing a name", () => {
    expect(resolveLanguage("und")).toEqual({ name: null, code: null });
    expect(resolveLanguage("")).toEqual({ name: null, code: null });
    expect(resolveLanguage(null)).toEqual({ name: null, code: null });
  });
});

describe("deriveJellyfinSource", () => {
  it("returns the empty source when the item has no media", () => {
    expect(deriveJellyfinSource(null)).toEqual({
      videoResolution: null,
      hdrFormat: null,
      audioTracks: [],
      subtitleLangs: [],
    });
    expect(deriveJellyfinSource([])).toMatchObject({ videoResolution: null });
  });

  it("derives resolution, audio and subtitle languages from the streams", () => {
    const s = deriveJellyfinSource([source(video(1920, 1080), audio("eng"), subtitle("eng"), subtitle("rus"))]);
    expect(s.videoResolution).toBe("1080");
    expect(s.hdrFormat).toBeNull(); // SDR
    expect(s.audioTracks).toEqual([{ lang: "English", code: "en", atmos: false }]);
    expect(s.subtitleLangs).toEqual(["English", "Russian"]);
  });

  it("maps every VideoRangeType to the app's combined HDR label", () => {
    const hdr = (range: string) => deriveJellyfinSource([source(video(3840, 2160, range))]).hdrFormat;
    expect(hdr("SDR")).toBeNull();
    expect(hdr("Unknown")).toBeNull();
    expect(hdr("HDR10")).toBe("HDR10");
    expect(hdr("HDR10Plus")).toBe("HDR10+");
    expect(hdr("HLG")).toBe("HLG");
    expect(hdr("DOVI")).toBe("Dolby Vision");
    expect(hdr("DOVIWithHDR10")).toBe("Dolby Vision · HDR10");
    // The real 4K library file: Dolby Vision profile 8.1 over an HDR10+ base.
    expect(hdr("DOVIWithHDR10Plus")).toBe("Dolby Vision · HDR10+");
    // Profile 7 dual-layer forms and the malformed-metadata case are still DV files — reporting them as SDR
    // (the fallback for an unknown value) would understate a title's quality.
    expect(hdr("DOVIWithEL")).toBe("Dolby Vision");
    expect(hdr("DOVIWithELHDR10Plus")).toBe("Dolby Vision · HDR10+");
    expect(hdr("DOVIInvalid")).toBe("Dolby Vision");
  });

  it("collapses several dubs of one language into a single track, flagging Atmos from any of them", () => {
    // Real shape from the library: four Russian studio dubs plus an English Atmos track.
    const s = deriveJellyfinSource([
      source(
        video(1920, 1080),
        audio("rus", { DisplayTitle: "HDRezka Studio - Russian - Dolby Digital - Stereo" }),
        audio("rus", { DisplayTitle: "LostFilm - Russian - Dolby Digital+ - 5.1" }),
        audio("eng", { Profile: "Dolby Digital Plus + Dolby Atmos" }),
      ),
    ]);
    expect(s.audioTracks).toEqual([
      { lang: "Russian", code: "ru", atmos: false },
      { lang: "English", code: "en", atmos: true },
    ]);
  });

  it("skips untagged tracks rather than rendering a blank language chip", () => {
    const s = deriveJellyfinSource([source(video(1920, 1080), audio("und"), audio("eng"), subtitle("und"))]);
    expect(s.audioTracks).toEqual([{ lang: "English", code: "en", atmos: false }]);
    expect(s.subtitleLangs).toEqual([]);
  });

  it("ignores non-audio/subtitle streams such as embedded cover art", () => {
    const s = deriveJellyfinSource([
      source(video(1920, 1080), { Type: "EmbeddedImage", Height: 5000, Width: 3375 }, audio("eng")),
    ]);
    expect(s.videoResolution).toBe("1080"); // the cover art's 5000px height must not win the video stream
    expect(s.audioTracks).toHaveLength(1);
  });

  it("surfaces the best copy when an item has several files", () => {
    const s = deriveJellyfinSource([
      source(video(1920, 1080), audio("eng")),
      source(video(3840, 2160, "DOVI"), audio("rus")),
    ]);
    expect(s.videoResolution).toBe("4k");
    expect(s.hdrFormat).toBe("Dolby Vision");
    expect(s.audioTracks).toEqual([{ lang: "Russian", code: "ru", atmos: false }]); // audio follows the chosen copy
  });

  it("ranks by resolution tier, not raw pixel height, so a PAL copy can't beat a 720p scope encode", () => {
    // 720×576 is TALLER than 1280×536, but it's a DVD rip and the other is 720p. Sorting on height first would
    // pick the DVD and show "576p" plus its audio/subtitle tracks on the card.
    const s = deriveJellyfinSource([
      source(video(720, 576), audio("rus"), subtitle("rus")),
      source(video(1280, 536), audio("eng"), subtitle("eng")),
    ]);
    expect(s.videoResolution).toBe("720");
    expect(s.audioTracks).toEqual([{ lang: "English", code: "en", atmos: false }]);
    expect(s.subtitleLangs).toEqual(["English"]);
  });

  it("still prefers the taller copy within one resolution tier", () => {
    const s = deriveJellyfinSource([source(video(1920, 800), audio("rus")), source(video(1920, 1080), audio("eng"))]);
    expect(s.audioTracks).toEqual([{ lang: "English", code: "en", atmos: false }]);
  });

  it("prefers the HDR copy when two files share a resolution", () => {
    const s = deriveJellyfinSource([source(video(3840, 2160, "SDR")), source(video(3840, 2160, "DOVIWithHDR10"))]);
    expect(s.hdrFormat).toBe("Dolby Vision · HDR10");
  });
});
