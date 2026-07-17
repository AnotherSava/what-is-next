import type { PrismaClient } from "@/generated/prisma/client";
import { getOmdb, isOmdbConfigured } from "@/lib/omdb";
import type { TmdbClient, TmdbMovieDetail, TmdbSeasonDetail, TmdbTvDetail } from "@/lib/tmdb";

// Which external API a catalog row is hydrated from. Drives where external ids are written (tmdbId vs tvdbId)
// and which client the refresh dispatches to. See MediaItem.metadataSource.
export type MetadataSource = "tmdb" | "tvdb";

// Shared TMDB → catalog upsert. CATALOG ROWS ONLY (MediaItem/Season/Episode) — it never touches user state, so
// search-add and the nightly refresh both reuse it without risk (global rule: single source of logic). Both key
// MediaItem by tmdbId, and the shared season/episode upsert (upsertCatalogSeason) is identical for both.

// Best-effort IMDb rating for catalog hydration: null when OMDb isn't configured, the item has no imdb id, or the
// lookup fails. Hydration must never fail because the (optional) rating source is down — the IMDb score is a nice-
// to-have on top of the TMDB-sourced catalog. Only a real value is ever returned, so callers skip writing null and
// keep any previously stored rating.
async function fetchImdbRatingBestEffort(imdbId: string | null | undefined): Promise<number | null> {
  if (!imdbId || !isOmdbConfigured()) return null;
  try {
    return await getOmdb().getImdbRating(imdbId);
  } catch {
    return null;
  }
}

// Catalog fields derived purely from a TMDB show detail (external ids included). Callers add mediaType and may
// override tvdbId (an already-set authoritative tvdbId is preserved over TMDB's external id).
export function tvDetailToMediaData(detail: TmdbTvDetail) {
  return {
    tmdbId: detail.id,
    tvdbId: detail.external_ids?.tvdb_id ?? null,
    imdbId: detail.external_ids?.imdb_id ?? null,
    title: detail.name,
    originalTitle: detail.original_name ?? null,
    overview: detail.overview ?? null,
    releaseDate: detail.first_air_date ?? null,
    status: detail.status ?? null,
    runtime: detail.episode_run_time?.[0] ?? null,
    posterPath: detail.poster_path ?? null,
    backdropPath: detail.backdrop_path ?? null,
    genres: detail.genres?.length ? JSON.stringify(detail.genres.map((g) => g.name)) : null,
    tmdbRating: detail.vote_average ?? null,
    numberOfSeasons: detail.number_of_seasons ?? null,
    numberOfEpisodes: detail.number_of_episodes ?? null,
  };
}

export function movieDetailToMediaData(detail: TmdbMovieDetail) {
  return {
    tmdbId: detail.id,
    tvdbId: detail.external_ids?.tvdb_id ?? null,
    imdbId: detail.external_ids?.imdb_id ?? null,
    title: detail.title,
    originalTitle: detail.original_title ?? null,
    overview: detail.overview ?? null,
    releaseDate: detail.release_date ?? null,
    status: detail.status ?? null,
    runtime: detail.runtime ?? null,
    posterPath: detail.poster_path ?? null,
    backdropPath: detail.backdrop_path ?? null,
    genres: detail.genres?.length ? JSON.stringify(detail.genres.map((g) => g.name)) : null,
    tmdbRating: detail.vote_average ?? null,
    director: directorFrom(detail),
  };
}

// The movie's director(s) from TMDB credits, comma-joined (a film can be co-directed — e.g. the Coens), or null
// when credits weren't returned or list no director.
function directorFrom(detail: TmdbMovieDetail): string | null {
  const names = (detail.credits?.crew ?? [])
    .filter((c) => c.job === "Director")
    .map((c) => c.name)
    .filter((n): n is string => !!n);
  const unique = [...new Set(names)]; // TMDB's community-edited crew can list the same person twice — de-dup
  return unique.length ? unique.join(", ") : null;
}

// Upsert one season and all its episodes. The external id (season.id / ep.id) is written to the column that
// matches `source` — tmdbId for TMDB, tvdbId for TVDB — so ids are never conflated across providers. For a TMDB
// season, episode tvdbId is intentionally left untouched (TMDB doesn't provide episode tvdb ids); for a TVDB
// season, tmdbId is left null the same way.
export async function upsertCatalogSeason(
  prisma: PrismaClient,
  mediaItemId: string,
  seasonNumber: number,
  season: TmdbSeasonDetail,
  stub?: { name?: string | null; air_date?: string | null; poster_path?: string | null; id?: number | null },
  source: MetadataSource = "tmdb",
): Promise<void> {
  const seasonExtId = season.id ?? stub?.id ?? null;
  const seasonIdField = source === "tvdb" ? { tvdbId: seasonExtId } : { tmdbId: seasonExtId };
  const seasonFields = {
    isSpecials: seasonNumber === 0,
    title: season.name ?? stub?.name ?? null,
    overview: season.overview ?? null,
    releaseDate: season.air_date ?? stub?.air_date ?? null,
    posterPath: season.poster_path ?? stub?.poster_path ?? null,
    ...seasonIdField,
  };
  const seasonRow = await prisma.season.upsert({
    where: { mediaItemId_seasonNumber: { mediaItemId, seasonNumber } },
    create: { mediaItemId, seasonNumber, ...seasonFields },
    update: seasonFields,
  });
  for (const ep of season.episodes) {
    const epIdField = source === "tvdb" ? { tvdbId: ep.id } : { tmdbId: ep.id };
    const epData = {
      seasonId: seasonRow.id,
      isSpecial: ep.season_number === 0,
      title: ep.name ?? null,
      overview: ep.overview ?? null,
      releaseDate: ep.air_date ?? null,
      runtime: ep.runtime ?? null,
      ...epIdField,
    };
    await prisma.episode.upsert({
      where: {
        mediaItemId_seasonNumber_episodeNumber: {
          mediaItemId,
          seasonNumber: ep.season_number,
          episodeNumber: ep.episode_number,
        },
      },
      create: { mediaItemId, seasonNumber: ep.season_number, episodeNumber: ep.episode_number, ...epData },
      update: epData,
    });
  }
}

// Fetch every season of a show and upsert them. Returns false if any season failed to fetch (so callers keep
// needsDetails=true and retry later instead of silently, permanently missing episodes).
export async function hydrateSeasonsFromDetail(
  prisma: PrismaClient,
  tmdb: TmdbClient,
  mediaItemId: string,
  detail: TmdbTvDetail,
): Promise<boolean> {
  let complete = true;
  for (const stub of detail.seasons ?? []) {
    try {
      const season = await tmdb.getSeasonDetail(detail.id, stub.season_number);
      await upsertCatalogSeason(prisma, mediaItemId, stub.season_number, season, stub);
    } catch {
      complete = false;
    }
  }
  return complete;
}

// Hydrate a show keyed by tmdbId (search-added / refresh). Upserts the MediaItem + all seasons/episodes and
// sets needsDetails based on full hydration. Returns the mediaItemId, or null if the detail fetch failed.
export async function hydrateShowByTmdbId(
  prisma: PrismaClient,
  tmdb: TmdbClient,
  tmdbId: number,
  onError?: (e: unknown) => void, // optional: observe the swallowed fetch error (the refresh job reports it)
): Promise<string | null> {
  let detail: TmdbTvDetail;
  try {
    detail = await tmdb.getTvDetail(tmdbId);
  } catch (e) {
    onError?.(e);
    return null;
  }
  const existing = await prisma.mediaItem.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType: "tv" } },
    select: { tvdbId: true },
  });
  const md = tvDetailToMediaData(detail);
  const imdbRating = await fetchImdbRatingBestEffort(md.imdbId);
  // Preserve an authoritative tvdbId (e.g. from the import); only adopt TMDB's external id when none is set.
  const data = {
    ...md,
    tvdbId: existing?.tvdbId ?? md.tvdbId,
    // Only write a real rating — a null (OMDb down/unconfigured/no match) must not wipe a previously stored one.
    ...(imdbRating != null ? { imdbRating } : {}),
    mediaType: "tv",
    metadataSource: "tmdb", // assert source so it can't drift (and self-heal a row previously adopted by TVDB)
    lastRefreshedAt: new Date(),
    needsDetails: false,
  };
  const item = await prisma.mediaItem.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType: "tv" } },
    create: data,
    update: data,
  });
  const complete = await hydrateSeasonsFromDetail(prisma, tmdb, item.id, detail);
  if (!complete) await prisma.mediaItem.update({ where: { id: item.id }, data: { needsDetails: true } });
  return item.id;
}

export async function hydrateMovieByTmdbId(
  prisma: PrismaClient,
  tmdb: TmdbClient,
  tmdbId: number,
  onError?: (e: unknown) => void, // optional: observe the swallowed fetch error (the refresh job reports it)
): Promise<string | null> {
  let detail: TmdbMovieDetail;
  try {
    detail = await tmdb.getMovieDetail(tmdbId);
  } catch (e) {
    onError?.(e);
    return null;
  }
  const existing = await prisma.mediaItem.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType: "movie" } },
    select: { tvdbId: true },
  });
  const md = movieDetailToMediaData(detail);
  const imdbRating = await fetchImdbRatingBestEffort(md.imdbId);
  const data = {
    ...md,
    tvdbId: existing?.tvdbId ?? md.tvdbId,
    // Only write a real rating — a null (OMDb down/unconfigured/no match) must not wipe a previously stored one.
    ...(imdbRating != null ? { imdbRating } : {}),
    mediaType: "movie",
    metadataSource: "tmdb", // assert source so it can't drift (and self-heal a row previously adopted by TVDB)
    lastRefreshedAt: new Date(),
    needsDetails: false,
  };
  const item = await prisma.mediaItem.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType: "movie" } },
    create: data,
    update: data,
  });
  return item.id;
}
