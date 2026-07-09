import { z } from "zod";

// Zod schemas for the TVDB v4 responses we consume. Like the TMDB schemas these are intentionally permissive
// (only the fields the catalog reads are modelled; everything nullable in the API is `.nullish()`), so an added
// TVDB field never breaks a parse. Every response is wrapped in the standard envelope { status, data, links? }.

// Standard TVDB envelope. `links` appears on paginated list endpoints (e.g. episodes); nullish elsewhere.
const tvdbLinksSchema = z.object({
  prev: z.string().nullish(),
  self: z.string().nullish(),
  next: z.string().nullish(),
  total_items: z.number().int().nullish(),
  page_size: z.number().int().nullish(),
});
export type TvdbLinks = z.infer<typeof tvdbLinksSchema>;

function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ status: z.string().nullish(), data, links: tvdbLinksSchema.nullish() });
}

// POST /login → { data: { token } }. Token is a bearer valid ~1 month.
export const tvdbLoginResponseSchema = envelope(z.object({ token: z.string() }));

const tvdbStatusSchema = z.object({ id: z.number().int().nullish(), name: z.string().nullish() });
const tvdbGenreSchema = z.object({ id: z.number().int().nullish(), name: z.string().nullish() });
const tvdbRemoteIdSchema = z.object({
  id: z.string().nullish(),
  type: z.number().int().nullish(),
  sourceName: z.string().nullish(),
});

// A season stub inside a series extended record (episodes come from the episodes endpoint, not here).
const tvdbSeasonBaseSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  name: z.string().nullish(),
  image: z.string().nullish(),
  type: z.object({ id: z.number().int().nullish(), name: z.string().nullish(), type: z.string().nullish() }).nullish(),
});
export type TvdbSeasonBase = z.infer<typeof tvdbSeasonBaseSchema>;

// GET /series/{id}/extended → data: SeriesExtendedRecord (subset).
export const tvdbSeriesExtendedSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string().nullish(),
  image: z.string().nullish(),
  overview: z.string().nullish(),
  year: z.string().nullish(),
  firstAired: z.string().nullish(),
  lastAired: z.string().nullish(),
  originalLanguage: z.string().nullish(),
  averageRuntime: z.number().int().nullish(),
  status: tvdbStatusSchema.nullish(),
  genres: z.array(tvdbGenreSchema).nullish(),
  seasons: z.array(tvdbSeasonBaseSchema).nullish(),
  remoteIds: z.array(tvdbRemoteIdSchema).nullish(),
});
export type TvdbSeriesExtended = z.infer<typeof tvdbSeriesExtendedSchema>;
export const tvdbSeriesExtendedResponseSchema = envelope(tvdbSeriesExtendedSchema);

// GET /movies/{id}/extended → data: MovieExtendedRecord (subset).
const tvdbReleaseSchema = z.object({
  country: z.string().nullish(),
  date: z.string().nullish(),
  detail: z.string().nullish(),
});
export const tvdbMovieExtendedSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string().nullish(),
  image: z.string().nullish(),
  overview: z.string().nullish(),
  year: z.string().nullish(),
  runtime: z.number().int().nullish(),
  status: tvdbStatusSchema.nullish(),
  genres: z.array(tvdbGenreSchema).nullish(),
  first_release: tvdbReleaseSchema.nullish(),
  remoteIds: z.array(tvdbRemoteIdSchema).nullish(),
  // A movie's overview isn't a top-level field — it lives here, returned only with ?meta=translations.
  translations: z
    .object({
      overviewTranslations: z
        .array(z.object({ language: z.string().nullish(), overview: z.string().nullish() }))
        .nullish(),
    })
    .nullish(),
});
export type TvdbMovieExtended = z.infer<typeof tvdbMovieExtendedSchema>;
export const tvdbMovieExtendedResponseSchema = envelope(tvdbMovieExtendedSchema);

// An episode as it appears in GET /series/{id}/episodes/{season-type}.
export const tvdbEpisodeSchema = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  image: z.string().nullish(),
  runtime: z.number().int().nullish(),
  aired: z.string().nullish(),
  seasonNumber: z.number().int(),
  number: z.number().int(),
  absoluteNumber: z.number().int().nullish(),
});
export type TvdbEpisode = z.infer<typeof tvdbEpisodeSchema>;

// GET /series/{id}/episodes/{season-type} → data: { series, episodes[] } (+ top-level links for pagination).
export const tvdbSeriesEpisodesSchema = z.object({
  series: z.object({ id: z.number().int().nullish(), name: z.string().nullish() }).nullish(),
  episodes: z.array(tvdbEpisodeSchema),
});
export const tvdbSeriesEpisodesResponseSchema = envelope(tvdbSeriesEpisodesSchema);
