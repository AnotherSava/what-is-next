import type { PrismaClient } from "@/generated/prisma/client";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import type { TmdbClient } from "@/lib/tmdb";
import { applyWatched } from "./apply";
import type { LibraryCandidate, MediaScanner } from "./types";

// Adopting a library-only title into tracking: hydrate it from TMDB, put it on the list, and import that server's
// watch state for it. Only ever runs on items NOT already tracked, so existing history — including the historical
// TV Time import — is never touched.
//
// Dependency-injected (prisma, tmdb, the provider's scanner) so the flow is testable without the app singletons;
// run.ts wires the real ones.

export interface AdoptDeps {
  prisma: PrismaClient;
  tmdb: TmdbClient;
  scanner: MediaScanner;
  userId: string;
}

export async function adoptCandidates(
  deps: AdoptDeps,
  candidates: LibraryCandidate[],
): Promise<{ added: number; failed: string[] }> {
  const { prisma, tmdb, scanner, userId } = deps;
  let added = 0;
  const failed: string[] = [];

  for (const c of candidates) {
    try {
      const mediaItemId = await resolveAndHydrate(c);
      if (!mediaItemId) {
        failed.push(c.title);
        continue;
      }
      // Adopting a title puts it on your list; watched vs planned is derived from the imported watch log.
      await prisma.userMediaState.upsert({
        where: { userId_mediaItemId: { userId, mediaItemId } },
        create: { userId, mediaItemId, wantToWatch: true },
        update: {}, // never clobber an existing intent
      });
      await applyWatched(prisma, userId, scanner.provider, await scanner.watchedSignalsForCandidate(c, mediaItemId));
      added++;
    } catch {
      failed.push(c.title);
    }
  }
  return { added, failed };

  // A candidate always carries at least one external id (that's what makes it a candidate rather than unaccounted),
  // but only TMDB can hydrate — so an imdb/tvdb-only title is resolved to its TMDB id first.
  async function resolveAndHydrate(c: LibraryCandidate): Promise<string | null> {
    let tmdbId = c.tmdbId;
    const pick = (f: { tv_results: { id: number }[]; movie_results: { id: number }[] }) =>
      (c.mediaType === "tv" ? f.tv_results[0]?.id : f.movie_results[0]?.id) ?? null;
    if (tmdbId == null && c.imdbId) tmdbId = pick(await tmdb.findByImdb(c.imdbId));
    if (tmdbId == null && c.tvdbId != null) tmdbId = pick(await tmdb.findByTvdb(c.tvdbId));
    if (tmdbId == null) return null;
    return c.mediaType === "tv"
      ? hydrateShowByTmdbId(prisma, tmdb, tmdbId)
      : hydrateMovieByTmdbId(prisma, tmdb, tmdbId);
  }
}
