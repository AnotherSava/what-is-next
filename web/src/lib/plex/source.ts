import type { PlexMedia } from "./schemas";

// Derive a movie's display "source" from its Plex Media — resolution + HDR, plus audio-track and subtitle
// languages — for the movie page's Video / Audio / Subtitles spec rows. Pure and dependency-free (testable).

export interface AudioTrack {
  lang: string; // human language name (Plex-embedded, may be native script e.g. "Русский") — for display
  code: string | null; // primary ISO 639-1 subtag ("en"|"ru"|…), normalized from Plex's tag (e.g. "en-US" → "en"); null when untagged
  atmos: boolean; // Dolby Atmos present on any track of this language
}
export interface VideoSource {
  videoResolution: string | null; // raw Plex token: "4k" | "1080" | …; null = unknown
  hdrFormat: string | null; // combined label: "Dolby Vision · HDR10" | "HDR10" | "HLG"; null = SDR / unknown
  audioTracks: AudioTrack[]; // distinct audio languages, in track order
  subtitleLangs: string[]; // distinct subtitle languages, in track order
}

const EMPTY: VideoSource = { videoResolution: null, hdrFormat: null, audioTracks: [], subtitleLangs: [] };

const RES_RANK: Record<string, number> = { "8k": 5, "4k": 4, "1080": 3, "720": 2, "480": 1, sd: 0 };

// A movie can carry multiple Media (a 1080p and a 4K copy, or a 4K DV and a 4K SDR copy). Surface the best one:
// highest pixel height, then resolution token, then HDR — so among equal-resolution copies the Dolby Vision / HDR
// one wins rather than whichever Plex happened to list first. Audio + subtitles come from that same best copy.
export function deriveVideoSource(media: PlexMedia[] | null | undefined): VideoSource {
  if (!media || media.length === 0) return EMPTY;
  const best = [...media].sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      rankOf(b.videoResolution) - rankOf(a.videoResolution) ||
      hdrRankOf(b) - hdrRankOf(a),
  )[0];
  const streams = (best.Part ?? []).flatMap((p) => p.Stream ?? []);
  return {
    videoResolution: best.videoResolution ?? null,
    hdrFormat: hdrLabel(streams.find((s) => s.streamType === 1)),
    audioTracks: audioTracksFrom(streams.filter((s) => s.streamType === 2)),
    subtitleLangs: langsFrom(streams.filter((s) => s.streamType === 3)),
  };
}

function rankOf(res: string | null | undefined): number {
  return res ? (RES_RANK[res.toLowerCase()] ?? 0) : 0;
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

// Distinct audio languages in track order, flagging any that carries a Dolby Atmos track. Tracks with no language
// are skipped (they'd show as blank).
function audioTracksFrom(streams: Stream[]): AudioTrack[] {
  const out: AudioTrack[] = [];
  for (const s of streams) {
    const lang = (s.language ?? "").trim();
    if (!lang) continue;
    // Plex tags can be BCP-47 ("en-US"|"pt-BR"|…); keep only the primary subtag so it matches a bare ISO-639-1 original.
    const code = (s.languageTag ?? "").trim().split("-")[0].toLowerCase() || null;
    const atmos = /atmos/i.test(`${s.title ?? ""} ${s.displayTitle ?? ""} ${s.extendedDisplayTitle ?? ""}`);
    const existing = out.find((a) => a.lang === lang);
    if (existing) {
      existing.atmos = existing.atmos || atmos;
      existing.code = existing.code ?? code; // a later same-name track may carry the tag an earlier one lacked
    } else out.push({ lang, code, atmos });
  }
  return out;
}

// Distinct languages in track order (subtitles).
function langsFrom(streams: Stream[]): string[] {
  const out: string[] = [];
  for (const s of streams) {
    const lang = (s.language ?? "").trim();
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out;
}

// Display label for a raw Plex resolution token: "4k" → "4K", "1080" → "1080p", "sd" → "SD"; blank/unknown → "".
export function formatResolution(raw: string | null | undefined): string {
  if (!raw) return "";
  const r = raw.toLowerCase();
  if (r === "sd") return "SD";
  if (/^\d+k$/.test(r)) return r.toUpperCase(); // 4k → 4K, 8k → 8K
  if (/^\d+$/.test(r)) return `${r}p`; // 1080 → 1080p
  return raw.toUpperCase();
}

// The Audio spec row: up to `max` languages ("(Atmos)" noted), plus a count of the rest for a dim "+N more" suffix.
export function formatAudio(tracks: AudioTrack[], max = 4): { text: string; more: number } {
  const shown = tracks.slice(0, max).map((t) => (t.atmos ? `${t.lang} (Atmos)` : t.lang));
  return { text: shown.join(" · "), more: Math.max(0, tracks.length - max) };
}

// The Subtitles spec row: up to `max` languages, plus a count of the rest for a dim "+N more" suffix.
export function formatSubtitles(langs: string[], max = 3): { text: string; more: number } {
  return { text: langs.slice(0, max).join(" · "), more: Math.max(0, langs.length - max) };
}
