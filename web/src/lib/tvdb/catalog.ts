import type { PrismaClient } from "@/generated/prisma/client";
import { upsertCatalogSeason } from "@/lib/catalog";
import { syncSlug } from "@/lib/slug";
import type { TvdbClient } from "./client";
import { tvdbImageUrl } from "./images";
import type { TvdbEpisode, TvdbMovieExtended, TvdbSeriesExtended } from "./schemas";

// TVDB → catalog hydration (the fallback for titles TMDB can't resolve). Mirrors @/lib/catalog's tmdbId-keyed
// path but keys by tvdbId, sets metadataSource "tvdb", and leaves tmdbId null so the row stays TVDB-sourced.
// Season/episode writes reuse the shared upsertCatalogSeason(source: "tvdb") so both providers share one DB path.

function imdbFromRemoteIds(remoteIds: TvdbSeriesExtended["remoteIds"]): string | null {
  const hit = remoteIds?.find((r) => r.sourceName?.toLowerCase().includes("imdb") && r.id);
  return hit?.id ?? null;
}

export function tvdbSeriesToMediaData(series: TvdbSeriesExtended, episodes: TvdbEpisode[]) {
  const aired = episodes.filter((e) => e.seasonNumber > 0);
  return {
    tmdbId: null,
    tvdbId: series.id,
    imdbId: imdbFromRemoteIds(series.remoteIds),
    title: series.name,
    originalTitle: null,
    overview: series.overview ?? null,
    releaseDate: series.firstAired || null, // TVDB returns "" for unknown dates; coerce to null
    status: series.status?.name ?? null,
    runtime: series.averageRuntime ?? null,
    posterPath: tvdbImageUrl(series.image),
    backdropPath: null,
    genres: series.genres?.length ? JSON.stringify(series.genres.map((g) => g.name).filter(Boolean)) : null,
    tmdbRating: null, // TVDB's score is a different scale; don't mix it into the TMDB rating field
    numberOfSeasons: new Set(aired.map((e) => e.seasonNumber)).size,
    numberOfEpisodes: aired.length,
  };
}

export function tvdbMovieToMediaData(movie: TvdbMovieExtended) {
  // A movie's overview lives in translations (see getMovieExtended's meta=translations); prefer English.
  const translated = movie.translations?.overviewTranslations ?? [];
  const overview =
    movie.overview || translated.find((t) => t.language === "eng")?.overview || translated[0]?.overview || null;
  return {
    tmdbId: null,
    tvdbId: movie.id,
    imdbId: imdbFromRemoteIds(movie.remoteIds),
    title: movie.name,
    originalTitle: null,
    overview,
    // TVDB returns "" for unknown dates; `||` (not `??`) lets the year fallback fire on an empty string.
    releaseDate: movie.first_release?.date || (movie.year ? `${movie.year}-01-01` : null),
    status: movie.status?.name ?? null,
    runtime: movie.runtime ?? null,
    posterPath: tvdbImageUrl(movie.image),
    backdropPath: null,
    genres: movie.genres?.length ? JSON.stringify(movie.genres.map((g) => g.name).filter(Boolean)) : null,
    tmdbRating: null,
  };
}

// Reshape a flat TVDB episode list into the season-with-episodes structure upsertCatalogSeason consumes (its
// input uses TMDB field names, which act as the catalog's internal shape). Season name/poster come from the
// series' season list; air_date is the earliest episode air date in that season.
function groupEpisodesIntoSeasons(series: TvdbSeriesExtended, episodes: TvdbEpisode[]) {
  const bySeason = new Map<number, TvdbEpisode[]>();
  for (const ep of episodes) {
    const list = bySeason.get(ep.seasonNumber) ?? [];
    list.push(ep);
    bySeason.set(ep.seasonNumber, list);
  }
  return [...bySeason.entries()].map(([seasonNumber, eps]) => {
    // The seasons array carries an entry per ordering type (official/dvd/absolute/…), so several can share a
    // number. Episodes are fetched in "default" (aired/official) order, so match the official-type season;
    // fall back to any same-number entry for shows without a typed one.
    const seasonMeta =
      series.seasons?.find((s) => s.number === seasonNumber && s.type?.type === "official") ??
      series.seasons?.find((s) => s.number === seasonNumber);
    const airDates = eps
      .map((e) => e.aired)
      .filter((d): d is string => !!d)
      .sort();
    return {
      season_number: seasonNumber,
      id: seasonMeta?.id ?? null,
      name: seasonMeta?.name ?? null,
      overview: null,
      air_date: airDates[0] ?? null,
      poster_path: tvdbImageUrl(seasonMeta?.image),
      episodes: eps.map((e) => ({
        id: e.id,
        episode_number: e.number,
        season_number: e.seasonNumber,
        name: e.name ?? null,
        overview: e.overview ?? null,
        air_date: e.aired || null, // coerce TVDB's "" to null
        runtime: e.runtime ?? null,
      })),
    };
  });
}

// Hydrate a TVDB series (extended record + all episodes) keyed by tvdbId. Returns the mediaItemId, or null if
// the series detail fetch fails (caller keeps the stub for a later retry).
export async function hydrateShowByTvdbId(
  prisma: PrismaClient,
  tvdb: TvdbClient,
  tvdbId: number,
): Promise<string | null> {
  let series: TvdbSeriesExtended;
  let episodes: TvdbEpisode[];
  try {
    series = await tvdb.getSeriesExtended(tvdbId);
    episodes = await tvdb.getAllSeriesEpisodes(tvdbId);
  } catch {
    return null;
  }
  const data = {
    ...tvdbSeriesToMediaData(series, episodes),
    mediaType: "tv",
    metadataSource: "tvdb",
    lastRefreshedAt: new Date(),
    needsDetails: false,
  };
  const item = await prisma.mediaItem.upsert({
    where: { tvdbId_mediaType: { tvdbId, mediaType: "tv" } },
    create: data,
    update: data,
  });
  await syncSlug(prisma, item.id);
  for (const season of groupEpisodesIntoSeasons(series, episodes)) {
    await upsertCatalogSeason(prisma, item.id, season.season_number, season, undefined, "tvdb");
  }
  return item.id;
}

export async function hydrateMovieByTvdbId(
  prisma: PrismaClient,
  tvdb: TvdbClient,
  tvdbId: number,
): Promise<string | null> {
  let movie: TvdbMovieExtended;
  try {
    movie = await tvdb.getMovieExtended(tvdbId);
  } catch {
    return null;
  }
  const data = {
    ...tvdbMovieToMediaData(movie),
    mediaType: "movie",
    metadataSource: "tvdb",
    lastRefreshedAt: new Date(),
    needsDetails: false,
  };
  const item = await prisma.mediaItem.upsert({
    where: { tvdbId_mediaType: { tvdbId, mediaType: "movie" } },
    create: data,
    update: data,
  });
  await syncSlug(prisma, item.id);
  return item.id;
}
