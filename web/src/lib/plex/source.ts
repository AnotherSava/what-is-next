import {
  collectAudioTracks,
  collectLangs,
  EMPTY_SOURCE,
  resolutionRank,
  resolveLanguage,
  type VideoSource,
} from "@/lib/media/source";
import type { PlexMedia } from "./schemas";

// Derive a copy's display source from its Plex Media — resolution + HDR, plus audio-track and subtitle languages
// — for the movie page's Video / Audio / Subtitles spec rows and the show page's per-season media pill. Pure and
// dependency-free (testable). The provider-neutral shape and the display formatters live in lib/media/source.

// A movie can carry multiple Media (a 1080p and a 4K copy, or a 4K DV and a 4K SDR copy). Surface the best one:
// highest pixel height, then resolution token, then HDR — so among equal-resolution copies the Dolby Vision / HDR
// one wins rather than whichever Plex happened to list first. Audio + subtitles come from that same best copy.
export function deriveVideoSource(media: PlexMedia[] | null | undefined): VideoSource {
  if (!media || media.length === 0) return EMPTY_SOURCE;
  const best = [...media].sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      resolutionRank(b.videoResolution) - resolutionRank(a.videoResolution) ||
      hdrRankOf(b) - hdrRankOf(a),
  )[0];
  const streams = (best.Part ?? []).flatMap((p) => p.Stream ?? []);
  return {
    videoResolution: best.videoResolution ?? null,
    hdrFormat: hdrLabel(streams.find((s) => s.streamType === 1)),
    audioTracks: collectAudioTracks(
      streams
        .filter((s) => s.streamType === 2)
        .map((s) => ({
          // Plex embeds its own display name for the language (often in the native script, e.g. "Русский"); keep
          // it, and take only the matchable ISO code from the tag.
          lang: (s.language ?? "").trim(),
          code: resolveLanguage(s.languageTag).code,
          atmos: /atmos/i.test(`${s.title ?? ""} ${s.displayTitle ?? ""} ${s.extendedDisplayTitle ?? ""}`),
        })),
    ),
    subtitleLangs: collectLangs(streams.filter((s) => s.streamType === 3).map((s) => s.language)),
  };
}

type Stream = NonNullable<NonNullable<PlexMedia["Part"]>[number]["Stream"]>[number];

// HDR format of a video stream, as a combined label. Dolby Vision is typically layered over an HDR10 base, so a DV
// title reads "Dolby Vision · HDR10"; the transfer function alone distinguishes plain HDR10 (PQ) from HLG.
function hdrLabel(stream: Stream | undefined): string | null {
  if (!stream) return null;
  const parts: string[] = [];
  if (stream.DOVIPresent) parts.push("Dolby Vision");
  if (stream.colorTrc === "smpte2084") parts.push("HDR10");
  else if (stream.colorTrc === "arib-std-b67") parts.push("HLG");
  return parts.length ? parts.join(" · ") : null;
}

// Rank a Media's HDR-ness (DV > HDR10 > HLG > SDR) for the best-copy tiebreak above.
function hdrRankOf(m: PlexMedia): number {
  const v = (m.Part ?? []).flatMap((p) => p.Stream ?? []).find((s) => s.streamType === 1);
  if (!v) return 0;
  if (v.DOVIPresent) return 3;
  if (v.colorTrc === "smpte2084") return 2;
  if (v.colorTrc === "arib-std-b67") return 1;
  return 0;
}
