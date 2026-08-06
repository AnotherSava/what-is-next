import {
  collectAudioTracks,
  collectLangs,
  EMPTY_SOURCE,
  resolutionRank,
  resolutionToken,
  resolveLanguage,
  type VideoSource,
} from "@/lib/media/source";
import type { JellyfinMediaSource, JellyfinStream } from "./schemas";

// Derive a copy's display source from its Jellyfin MediaSources — resolution + HDR, plus audio-track and subtitle
// languages — into the same provider-neutral shape Plex produces, so the movie page's spec rows and the show
// page's season pill render identically whichever server the copy came from. Pure and dependency-free (testable).

// Jellyfin's VideoRangeType → the combined HDR label used across the app. Dolby Vision is layered over a base
// layer, so its combined forms read "Dolby Vision · <base>". "SDR"/"Unknown"/absent all mean no HDR badge.
const HDR_LABEL: Record<string, string> = {
  hdr10: "HDR10",
  hdr10plus: "HDR10+",
  hlg: "HLG",
  dovi: "Dolby Vision",
  doviwithhdr10: "Dolby Vision · HDR10",
  doviwithhdr10plus: "Dolby Vision · HDR10+",
  doviwithhlg: "Dolby Vision · HLG",
  doviwithsdr: "Dolby Vision",
  doviwithel: "Dolby Vision", // profile 7 dual-layer over an HDR10 base
  doviwithelhdr10plus: "Dolby Vision · HDR10+", // profile 7 dual-layer over an HDR10+ base
  doviinvalid: "Dolby Vision", // malformed DV metadata — still a DV file, so don't report it as SDR
};

function hdrLabel(stream: JellyfinStream | undefined): string | null {
  const raw = (stream?.VideoRangeType ?? "").toLowerCase();
  return HDR_LABEL[raw] ?? null;
}

// Rank a source's HDR-ness (DV > HDR10(+) > HLG > SDR) for the best-copy tiebreak below.
function hdrRankOf(source: JellyfinMediaSource): number {
  const raw = (videoStream(source)?.VideoRangeType ?? "").toLowerCase();
  if (raw.startsWith("dovi")) return 3;
  if (raw.startsWith("hdr10")) return 2;
  if (raw === "hlg") return 1;
  return 0;
}

function streamsOf(source: JellyfinMediaSource): JellyfinStream[] {
  return source.MediaStreams ?? [];
}

function videoStream(source: JellyfinMediaSource): JellyfinStream | undefined {
  return streamsOf(source).find((s) => s.Type === "Video");
}

// An item can carry several MediaSources (a 1080p and a 4K file). Surface the best one: resolution tier first,
// then pixel height, then HDR. The tier has to lead — raw height alone inverts the ladder for scope encodes, where
// a 720×576 PAL copy is TALLER than a 1280×536 720p one but is plainly the worse file. (Plex can sort on height
// first because it reports a resolution token per copy rather than raw dimensions.)
// Audio + subtitles come from that same best copy.
export function deriveJellyfinSource(sources: JellyfinMediaSource[] | null | undefined): VideoSource {
  if (!sources || sources.length === 0) return EMPTY_SOURCE;
  const best = [...sources].sort(
    (a, b) =>
      resolutionRank(tokenOf(b)) - resolutionRank(tokenOf(a)) ||
      (videoStream(b)?.Height ?? 0) - (videoStream(a)?.Height ?? 0) ||
      hdrRankOf(b) - hdrRankOf(a),
  )[0];
  const streams = streamsOf(best);
  return {
    videoResolution: tokenOf(best),
    hdrFormat: hdrLabel(videoStream(best)),
    audioTracks: collectAudioTracks(
      streams
        .filter((s) => s.Type === "Audio")
        .map((s) => {
          // Jellyfin reports a bare ISO 639-2 code with no display name, so the name is resolved from the code.
          const { name, code } = resolveLanguage(s.Language);
          return {
            lang: name ?? "",
            code,
            atmos: /atmos/i.test(`${s.Profile ?? ""} ${s.Title ?? ""} ${s.DisplayTitle ?? ""}`),
          };
        }),
    ),
    subtitleLangs: collectLangs(
      streams.filter((s) => s.Type === "Subtitle").map((s) => resolveLanguage(s.Language).name),
    ),
  };
}

// Jellyfin reports pixel dimensions rather than a resolution token, so the token is derived from them.
function tokenOf(source: JellyfinMediaSource): string | null {
  const video = videoStream(source);
  return resolutionToken(video?.Width, video?.Height);
}
