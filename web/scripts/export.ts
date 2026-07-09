import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPrisma } from "../src/lib/db";
import { getOwner } from "../src/lib/owner";

// `npm run export` — dumps all of the owner's user state to JSON (brief §3.8, a v1 requirement: the app's own
// escape hatch). Everything is keyed by EXTERNAL IDs (tmdb/tvdb/imdb) + title and season/episode numbers, never
// internal cuids, so the dump can outlive both this DB and TMDB and be re-imported anywhere.

const prisma = getPrisma();

async function main(): Promise<void> {
  const owner = await getOwner();

  const [states, seen, ratings, lists] = await Promise.all([
    prisma.userMediaState.findMany({
      where: { userId: owner.id },
      include: {
        mediaItem: { select: { id: true, mediaType: true, title: true, tmdbId: true, tvdbId: true, imdbId: true } },
      },
    }),
    prisma.seenEvent.findMany({
      where: { userId: owner.id },
      select: {
        mediaItemId: true,
        watchedAt: true,
        source: true,
        episode: { select: { seasonNumber: true, episodeNumber: true } },
      },
    }),
    prisma.rating.findMany({
      where: { userId: owner.id },
      select: {
        rating: true,
        liked: true,
        review: true,
        mediaItem: { select: { mediaType: true, title: true, tmdbId: true, tvdbId: true } },
        episode: { select: { seasonNumber: true, episodeNumber: true } },
      },
    }),
    prisma.list.findMany({
      where: { userId: owner.id },
      include: {
        items: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            mediaItem: { select: { mediaType: true, title: true, tmdbId: true, tvdbId: true } },
          },
        },
      },
    }),
  ]);

  // Group seen events by show/movie.
  const episodesByItem = new Map<
    string,
    { season: number; episode: number; watchedAt: string | null; source: string }[]
  >();
  const movieWatchesByItem = new Map<string, { watchedAt: string | null; source: string }[]>();
  for (const e of seen) {
    if (e.episode) {
      const arr = episodesByItem.get(e.mediaItemId) ?? [];
      arr.push({
        season: e.episode.seasonNumber,
        episode: e.episode.episodeNumber,
        watchedAt: e.watchedAt?.toISOString() ?? null,
        source: e.source,
      });
      episodesByItem.set(e.mediaItemId, arr);
    } else {
      const arr = movieWatchesByItem.get(e.mediaItemId) ?? [];
      arr.push({ watchedAt: e.watchedAt?.toISOString() ?? null, source: e.source });
      movieWatchesByItem.set(e.mediaItemId, arr);
    }
  }

  const shows = states
    .filter((s) => s.mediaItem.mediaType === "tv")
    .map((s) => ({
      title: s.mediaItem.title,
      tmdbId: s.mediaItem.tmdbId,
      tvdbId: s.mediaItem.tvdbId,
      imdbId: s.mediaItem.imdbId,
      tracking: s.tracking,
      isFavorite: s.isFavorite,
      addedAt: s.createdAt.toISOString(),
      watchedEpisodes: episodesByItem.get(s.mediaItemId) ?? [],
    }));

  const movies = states
    .filter((s) => s.mediaItem.mediaType === "movie")
    .map((s) => ({
      title: s.mediaItem.title,
      tmdbId: s.mediaItem.tmdbId,
      tvdbId: s.mediaItem.tvdbId,
      imdbId: s.mediaItem.imdbId,
      tracking: s.tracking,
      isFavorite: s.isFavorite,
      addedAt: s.createdAt.toISOString(),
      watches: movieWatchesByItem.get(s.mediaItemId) ?? [],
    }));

  const payload = {
    exportedAt: new Date().toISOString(),
    owner: { name: owner.name, role: owner.role },
    counts: {
      shows: shows.length,
      movies: movies.length,
      watchedEpisodes: shows.reduce((n, s) => n + s.watchedEpisodes.length, 0),
      lists: lists.length,
    },
    shows,
    movies,
    lists: lists.map((l) => ({
      name: l.name,
      description: l.description,
      createdAt: l.createdAt.toISOString(),
      items: l.items.map((it) => ({
        type: it.mediaItem.mediaType,
        title: it.mediaItem.title,
        tmdbId: it.mediaItem.tmdbId,
        tvdbId: it.mediaItem.tvdbId,
        position: it.position,
      })),
    })),
    ratings: ratings.map((r) => ({
      type: r.mediaItem.mediaType,
      title: r.mediaItem.title,
      tmdbId: r.mediaItem.tmdbId,
      tvdbId: r.mediaItem.tvdbId,
      season: r.episode?.seasonNumber ?? null,
      episode: r.episode?.episodeNumber ?? null,
      rating: r.rating,
      liked: r.liked,
      review: r.review,
    })),
  };

  const outDir = join(process.cwd(), "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `export-${payload.exportedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(
    `Exported ${payload.counts.shows} shows, ${payload.counts.movies} movies, ${payload.counts.watchedEpisodes} watched episodes, ${payload.counts.lists} lists → ${path}`,
  );
}

main()
  .catch((err) => {
    console.error("Export failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
