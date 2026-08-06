// The "source" of a copy in a media-server library — resolution, HDR format, and the audio/subtitle languages —
// plus the formatters the movie and show pages render it with. Pure and dependency-free (testable).
//
// The shape is provider-neutral and stored as-is on MediaPresence, so a Plex-sourced row and a Jellyfin-sourced
// row render identically. Each provider's module derives it from its own API (Plex reads stream colour fields,
// Jellyfin reads VideoRangeType); everything below is what they must agree on.

export interface AudioTrack {
  lang: string; // human language name ("English" | "Русский") — for display
  code: string | null; // primary ISO 639-1 subtag ("en"|"ru"|…); null when untagged. Matched against a title's original language.
  atmos: boolean; // Dolby Atmos present on any track of this language
}

export interface VideoSource {
  videoResolution: string | null; // token: "4k" | "1080" | …; null = unknown
  hdrFormat: string | null; // combined label: "Dolby Vision · HDR10" | "HDR10" | "HLG"; null = SDR / unknown
  audioTracks: AudioTrack[]; // distinct audio languages, in track order
  subtitleLangs: string[]; // distinct subtitle languages, in track order
}

export const EMPTY_SOURCE: VideoSource = {
  videoResolution: null,
  hdrFormat: null,
  audioTracks: [],
  subtitleLangs: [],
};

// Resolution tokens, best first — the tiebreak when a title has several copies (a 1080p and a 4K file).
const RES_RANK: Record<string, number> = { "8k": 6, "4k": 5, "1080": 4, "720": 3, "576": 2, "480": 1, sd: 0 };

export function resolutionRank(res: string | null | undefined): number {
  return res ? (RES_RANK[res.toLowerCase()] ?? 0) : 0;
}

// Pixel dimensions → the resolution token. Plex reports a token directly; Jellyfin reports width/height, so this
// is how a Jellyfin copy lands in the same vocabulary. Deliberately tolerant of cropped scope encodes, which are
// narrower/shorter than the nominal format (a 2.39:1 UHD film is 3822×2066, a cropped 1080p is 1920×800), so
// each rung matches on EITHER dimension clearing its floor.
export function resolutionToken(width: number | null | undefined, height: number | null | undefined): string | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 && h <= 0) return null;
  if (w >= 7000 || h >= 3500) return "8k";
  if (w >= 3000 || h >= 1700) return "4k";
  if (w >= 1800 || h >= 1000) return "1080";
  if (w >= 1200 || h >= 700) return "720";
  if (w >= 700 && h >= 500) return "576"; // PAL widescreen — narrower than 720p but taller than 480p
  if (w >= 600 || h >= 400) return "480";
  return "sd";
}

// Display label for a resolution token: "4k" → "4K", "1080" → "1080p", "sd" → "SD"; blank/unknown → "".
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

// Collapse a track list into distinct languages in track order, merging duplicates of the same language (a file
// often carries several dubs of one language) and OR-ing their Atmos flag. Untagged tracks are skipped — they'd
// render as a blank chip. Shared so both providers dedupe identically.
export function collectAudioTracks(rows: { lang: string; code: string | null; atmos: boolean }[]): AudioTrack[] {
  const out: AudioTrack[] = [];
  for (const r of rows) {
    const lang = r.lang.trim();
    if (!lang) continue;
    const existing = out.find((a) => a.lang === lang);
    if (existing) {
      existing.atmos = existing.atmos || r.atmos;
      existing.code = existing.code ?? r.code; // a later same-language track may carry the tag an earlier one lacked
    } else out.push({ lang, code: r.code, atmos: r.atmos });
  }
  return out;
}

// Distinct language names in track order (subtitles).
export function collectLangs(names: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const lang = (n ?? "").trim();
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out;
}

const displayNames = new Intl.DisplayNames(["en"], { type: "language" });

// Resolve a language tag to the pair the UI needs: an English display name and the primary ISO 639-1 subtag.
// Handles what both servers emit — Plex's BCP-47 tags ("en", "en-US", "pt-BR") and Jellyfin's ISO 639-2 codes,
// including the bibliographic variants ("eng", "rus", "fre"/"fra", "ger"/"deu"). ICU canonicalises the 3-letter
// forms to their 2-letter equivalents, so "fre" and "fra" both land on "fr" / "French".
export function resolveLanguage(tag: string | null | undefined): { name: string | null; code: string | null } {
  const raw = (tag ?? "").trim();
  if (!raw || raw.toLowerCase() === "und") return { name: null, code: null };
  let code: string | null = null;
  try {
    code = new Intl.Locale(raw).language ?? null;
  } catch {
    code = raw.split("-")[0].toLowerCase() || null; // not a parseable tag — fall back to the primary subtag
  }
  if (code === "und") code = null;
  let name: string | null = null;
  try {
    const resolved = displayNames.of(raw);
    // ICU echoes the input back for a tag it doesn't know, and yields "root" for undetermined — neither is a name.
    if (resolved && resolved !== raw && resolved !== "root") name = resolved;
  } catch {
    name = null;
  }
  return { name, code };
}
