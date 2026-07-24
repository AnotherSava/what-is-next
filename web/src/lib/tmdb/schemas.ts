import { z } from "zod";

// Zod schemas for every TMDB response we consume (brief §2: "validate ALL external JSON"). TMDB returns many
// more fields than we model — schemas are intentionally permissive (`.passthrough()` semantics via omitting
// `.strict()`) and pick only what the catalog needs, so an added TMDB field never breaks a parse. Every field
// we actually read is validated; anything nullable in the API is `.nullable()` here.

// A TV result as it appears in /search/tv and /find results.
export const tmdbTvSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  original_name: z.string().nullish(),
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  genre_ids: z.array(z.number().int()).nullish(),
});
export type TmdbTvSummary = z.infer<typeof tmdbTvSummarySchema>;

// A movie result as it appears in /search/movie and /find results.
export const tmdbMovieSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: z.string().nullish(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  genre_ids: z.array(z.number().int()).nullish(),
});
export type TmdbMovieSummary = z.infer<typeof tmdbMovieSummarySchema>;

// GET /3/find/{external_id} → results grouped by media type. We only use tv_results (tvdb_id) and
// movie_results (imdb_id), per the import mapping (brief §6.2).
export const tmdbFindSchema = z.object({
  tv_results: z.array(tmdbTvSummarySchema),
  movie_results: z.array(tmdbMovieSummarySchema),
});
export type TmdbFind = z.infer<typeof tmdbFindSchema>;

const tmdbGenreSchema = z.object({ id: z.number().int(), name: z.string() });

const tmdbExternalIdsSchema = z.object({
  imdb_id: z.string().nullish(),
  tvdb_id: z.number().int().nullish(),
});

// Credits (append_to_response=credits) — crew gives the director(s); cast (in billing order) the top-billed
// actors shown on the movie detail page. `order` is TMDB's billing rank (0 = top-billed).
const tmdbCreditsSchema = z.object({
  cast: z
    .array(
      z.object({
        name: z.string().nullish(),
        character: z.string().nullish(),
        profile_path: z.string().nullish(),
        order: z.number().int().nullish(),
      }),
    )
    .nullish(),
  crew: z.array(z.object({ job: z.string().nullish(), name: z.string().nullish() })).nullish(),
});
export type TmdbCredits = z.infer<typeof tmdbCreditsSchema>;

// A season stub inside a show detail response (no episodes here — those come from /tv/{id}/season/{n}).
const tmdbSeasonStubSchema = z.object({
  id: z.number().int().nullish(),
  season_number: z.number().int(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  episode_count: z.number().int().nullish(),
});

// GET /3/tv/{id}?append_to_response=external_ids,credits
export const tmdbTvDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  original_name: z.string().nullish(),
  original_language: z.string().nullish(), // ISO 639-1 code of the show's original language, e.g. "en" | "ru" | "es"
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
  status: z.string().nullish(), // "Returning Series" | "Ended" | "Canceled" | "In Production" | "Planned" | ...
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  episode_run_time: z.array(z.number()).nullish(),
  number_of_seasons: z.number().int().nullish(),
  number_of_episodes: z.number().int().nullish(),
  genres: z.array(tmdbGenreSchema).nullish(),
  seasons: z.array(tmdbSeasonStubSchema).nullish(),
  external_ids: tmdbExternalIdsSchema.nullish(),
  created_by: z.array(z.object({ name: z.string().nullish() })).nullish(), // the show's creator(s)
  credits: tmdbCreditsSchema.nullish(), // series-regular cast (billing order), like the movie credits
});
export type TmdbTvDetail = z.infer<typeof tmdbTvDetailSchema>;

// An episode inside GET /3/tv/{id}/season/{n}
export const tmdbEpisodeSchema = z.object({
  id: z.number().int(),
  episode_number: z.number().int(),
  season_number: z.number().int(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  runtime: z.number().int().nullish(),
});
export type TmdbEpisode = z.infer<typeof tmdbEpisodeSchema>;

// GET /3/tv/{id}/season/{n}
export const tmdbSeasonDetailSchema = z.object({
  id: z.number().int().nullish(),
  season_number: z.number().int(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  episodes: z.array(tmdbEpisodeSchema),
});
export type TmdbSeasonDetail = z.infer<typeof tmdbSeasonDetailSchema>;

// GET /3/movie/{id}?append_to_response=external_ids,credits
export const tmdbMovieDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: z.string().nullish(),
  original_language: z.string().nullish(), // ISO 639-1 code of the movie's original language, e.g. "en" | "ru" | "es"
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
  status: z.string().nullish(), // "Released" | "Post Production" | "Planned" | ...
  runtime: z.number().int().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  genres: z.array(tmdbGenreSchema).nullish(),
  external_ids: tmdbExternalIdsSchema.nullish(),
  credits: tmdbCreditsSchema.nullish(),
});
export type TmdbMovieDetail = z.infer<typeof tmdbMovieDetailSchema>;

// GET /3/search/tv and /3/search/movie
export const tmdbTvSearchSchema = z.object({
  page: z.number().int(),
  total_results: z.number().int(),
  total_pages: z.number().int(),
  results: z.array(tmdbTvSummarySchema),
});
export const tmdbMovieSearchSchema = z.object({
  page: z.number().int(),
  total_results: z.number().int(),
  total_pages: z.number().int(),
  results: z.array(tmdbMovieSummarySchema),
});

// A person result as it appears in /search/person. `known_for` mixes movie + tv summaries; we read just enough
// to label the search card (department + a couple of known-for titles). No birth year here — that needs a detail
// call, so the card's year corner stays empty.
export const tmdbPersonSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  original_name: z.string().nullish(),
  profile_path: z.string().nullish(),
  known_for_department: z.string().nullish(),
  popularity: z.number().nullish(),
  known_for: z
    .array(z.object({ media_type: z.string().nullish(), title: z.string().nullish(), name: z.string().nullish() }))
    .nullish(),
});
export type TmdbPersonSummary = z.infer<typeof tmdbPersonSummarySchema>;

// GET /3/search/person
export const tmdbPersonSearchSchema = z.object({
  page: z.number().int(),
  total_results: z.number().int(),
  total_pages: z.number().int(),
  results: z.array(tmdbPersonSummarySchema),
});
