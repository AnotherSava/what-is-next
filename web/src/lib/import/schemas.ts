import { z } from "zod";

// Zod schemas for the "TV Time Out" export files (brief §6.1, verified 2026-07-08 against the real export).
// Every field the importer reads is validated; the importer must treat these files as read-only and never
// die on a surprising row — hence permissive nullish/defaults where the real data is sparse.

const externalIdSchema = z.object({
  tvdb: z.number().int().nullish(),
  imdb: z.string().nullish(),
});

export const tvtimeEpisodeSchema = z.object({
  id: externalIdSchema,
  number: z.number().int(),
  name: z.string().nullish(),
  special: z.boolean().default(false),
  is_watched: z.boolean().default(false),
  watched_at: z.string().nullish(), // ISO; may be null even when is_watched (rare) → "seen, date unknown"
  rewatch_count: z.number().int().nullish(),
  watched_count: z.number().int().nullish(),
});
export type TvtimeEpisode = z.infer<typeof tvtimeEpisodeSchema>;

export const tvtimeSeasonSchema = z.object({
  number: z.number().int(), // 0 = specials
  is_specials: z.boolean().default(false),
  episodes: z.array(tvtimeEpisodeSchema).default([]),
});
export type TvtimeSeason = z.infer<typeof tvtimeSeasonSchema>;

// Per-series status. up_to_date / continuing both mean "actively watching" (the split is derived, not stored,
// brief §6.2). All 83 real series fall into these four; an unseen value would surface as a clear zod error.
export const tvtimeSeriesStatusSchema = z.enum(["up_to_date", "continuing", "not_started_yet", "stopped"]);
export type TvtimeSeriesStatus = z.infer<typeof tvtimeSeriesStatusSchema>;

export const tvtimeSeriesSchema = z.object({
  uuid: z.string().nullish(),
  id: externalIdSchema,
  created_at: z.string().nullish(),
  title: z.string(),
  status: tvtimeSeriesStatusSchema,
  is_favorite: z.boolean().default(false),
  _noEpisodeData: z.boolean().nullish(),
  seasons: z.array(tvtimeSeasonSchema).default([]),
});
export type TvtimeSeries = z.infer<typeof tvtimeSeriesSchema>;
export const tvtimeSeriesFileSchema = z.array(tvtimeSeriesSchema);

export const tvtimeMovieSchema = z.object({
  id: externalIdSchema,
  uuid: z.string().nullish(),
  created_at: z.string().nullish(),
  title: z.string(),
  year: z.number().int().nullish(),
  watched_at: z.string().nullish(),
  is_watched: z.boolean().default(false),
  is_favorite: z.boolean().default(false),
  rewatch_count: z.number().int().nullish(),
});
export type TvtimeMovie = z.infer<typeof tvtimeMovieSchema>;
export const tvtimeMovieFileSchema = z.array(tvtimeMovieSchema);

export const tvtimeListItemSchema = z.object({
  type: z.string(), // "series" | "movie"
  tvdb_id: z.number().int(),
  name: z.string().nullish(),
  custom_order: z.number().int().default(0),
});
export type TvtimeListItem = z.infer<typeof tvtimeListItemSchema>;

export const tvtimeListSchema = z.object({
  id: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  is_public: z.boolean().nullish(),
  created_at: z.string().nullish(),
  items: z.array(tvtimeListItemSchema).default([]),
});
export type TvtimeList = z.infer<typeof tvtimeListSchema>;
export const tvtimeListsFileSchema = z.array(tvtimeListSchema);
