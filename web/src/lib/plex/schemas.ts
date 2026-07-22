import { z } from "zod";

// Zod schemas for the Plex Media Server HTTP API responses we consume (brief §2 convention: validate all
// external JSON). Plex wraps everything in a MediaContainer and returns far more than we read; schemas are
// permissive and pick only what the sync needs. Requested with `Accept: application/json`.

// GET /identity → server identity. machineIdentifier is the stable server id needed to build app.plex.tv deep
// links (…/server/{machineIdentifier}/details?key=…). Unprotected endpoint; we still send the token like every call.
export const plexIdentitySchema = z.object({
  MediaContainer: z.object({ machineIdentifier: z.string() }),
});

export const plexGuidSchema = z.object({ id: z.string() });

// GET /library/sections → the libraries. type is "show" | "movie" | "artist" | ...
const plexSectionSchema = z.object({ key: z.string(), type: z.string(), title: z.string() });
export const plexSectionsResponseSchema = z.object({
  MediaContainer: z.object({ Directory: z.array(plexSectionSchema).default([]) }),
});
export type PlexSection = z.infer<typeof plexSectionSchema>;

// GET /library/sections/{key}/all?includeGuids=1 → shows or movies with external ids + watch state.
export const plexItemSchema = z.object({
  ratingKey: z.string(),
  type: z.string(), // "show" | "movie"
  title: z.string(),
  year: z.number().int().nullish(),
  childCount: z.number().int().nullish(), // number of seasons (shows)
  viewCount: z.number().int().nullish(), // >0 = watched at least once (movies)
  lastViewedAt: z.number().int().nullish(), // Unix epoch SECONDS
  Guid: z.array(plexGuidSchema).nullish(),
});
export type PlexItem = z.infer<typeof plexItemSchema>;
export const plexItemsResponseSchema = z.object({
  MediaContainer: z.object({ Metadata: z.array(plexItemSchema).default([]) }),
});

// GET /library/metadata/{ratingKey} → a single item's full detail. We read only the media/stream fields the movie
// page's source strip needs: the resolution and the HDR format. A movie can carry several Media (versions/files) —
// deriveVideoSource (source.ts) picks the best. HDR lives on the video Stream's colour fields, not the Media.
const plexStreamSchema = z.object({
  streamType: z.number().int(), // 1 = video, 2 = audio, 3 = subtitle
  colorTrc: z.string().nullish(), // transfer fn: "smpte2084" = HDR10 (PQ), "arib-std-b67" = HLG, else SDR (bt709)
  DOVIPresent: z.boolean().nullish(), // Dolby Vision present on this (video) stream
  language: z.string().nullish(), // human language name, e.g. "English" / "Русский" (audio + subtitle rows) — display
  languageTag: z.string().nullish(), // Plex language tag, often BCP-47 ("en" | "en-US" | "ru"); normalized to a bare ISO 639-1 subtag in source.ts for matching
  title: z.string().nullish(), // ↓ these three are scanned for "Atmos" to flag an Atmos audio track
  displayTitle: z.string().nullish(),
  extendedDisplayTitle: z.string().nullish(),
});
const plexPartSchema = z.object({ Stream: z.array(plexStreamSchema).nullish() });
export const plexMediaSchema = z.object({
  videoResolution: z.string().nullish(), // "4k" | "1080" | "720" | "480" | "sd"
  height: z.number().int().nullish(), // pixel height — the tiebreak for picking the best of several versions
  Part: z.array(plexPartSchema).nullish(),
});
export type PlexMedia = z.infer<typeof plexMediaSchema>;
export const plexMetadataDetailResponseSchema = z.object({
  MediaContainer: z.object({
    Metadata: z.array(z.object({ Media: z.array(plexMediaSchema).nullish() })).default([]),
  }),
});

// GET /library/metadata/{ratingKey}/children → a show's seasons. index = season number.
export const plexSeasonSchema = z.object({
  ratingKey: z.string(),
  index: z.number().int(),
  title: z.string().nullish(),
  leafCount: z.number().int().nullish(),
  viewedLeafCount: z.number().int().nullish(),
});
export type PlexSeason = z.infer<typeof plexSeasonSchema>;
export const plexSeasonsResponseSchema = z.object({
  MediaContainer: z.object({ Metadata: z.array(plexSeasonSchema).default([]) }),
});

// GET /library/metadata/{ratingKey}/allLeaves → all episodes of a show. parentIndex = season, index = episode.
// ratingKey identifies the episode so the sync can fetch its full detail (getItemMedia) for that season's Plex
// source — /allLeaves' own Media is lightweight (resolution/height but no Stream detail, so no HDR/audio/subs), so
// it's only a fallback. The sync samples one episode per season, since episodes of a season share a copy.
export const plexEpisodeSchema = z.object({
  ratingKey: z.string().nullish(),
  parentIndex: z.number().int().nullish(),
  index: z.number().int().nullish(),
  viewCount: z.number().int().nullish(),
  lastViewedAt: z.number().int().nullish(),
  Media: z.array(plexMediaSchema).nullish(),
});
export type PlexEpisode = z.infer<typeof plexEpisodeSchema>;
export const plexEpisodesResponseSchema = z.object({
  MediaContainer: z.object({ Metadata: z.array(plexEpisodeSchema).default([]) }),
});

export interface PlexExternalIds {
  tmdbId: number | null;
  tvdbId: number | null;
  imdbId: string | null;
}

// Extract tmdb/tvdb/imdb ids from a Plex item's Guid array (e.g. "tmdb://1399", "tvdb://121361", "imdb://tt...").
export function parseGuids(item: { Guid?: { id: string }[] | null }): PlexExternalIds {
  const out: PlexExternalIds = { tmdbId: null, tvdbId: null, imdbId: null };
  for (const g of item.Guid ?? []) {
    const [scheme, value] = g.id.split("://");
    if (!value) continue;
    if (scheme === "tmdb") out.tmdbId = Number(value) || null;
    else if (scheme === "tvdb") out.tvdbId = Number(value) || null;
    else if (scheme === "imdb") out.imdbId = value;
  }
  return out;
}
