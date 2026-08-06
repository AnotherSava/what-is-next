import type { PrismaClient } from "@/generated/prisma/client";
import type { CatalogIndex, MediaKind } from "./types";

// Matching a media-server library item to the catalog is by external id (tmdb, then tvdb, then imdb) — never by
// fuzzy title. This builds that lookup once per sync so a scan is a pure in-memory join, and hands scanners a
// tiny interface instead of a Prisma client (see MediaScanner).

export async function buildCatalogIndex(prisma: PrismaClient): Promise<CatalogIndex> {
  const items = await prisma.mediaItem.findMany({
    select: { id: true, mediaType: true, tmdbId: true, tvdbId: true, imdbId: true },
  });
  const empty = () => ({
    tmdb: new Map<number, string>(),
    tvdb: new Map<number, string>(),
    imdb: new Map<string, string>(),
  });
  const idx: Record<MediaKind, ReturnType<typeof empty>> = { tv: empty(), movie: empty() };
  for (const it of items) {
    const kind: MediaKind = it.mediaType === "movie" ? "movie" : "tv";
    if (it.tmdbId != null) idx[kind].tmdb.set(it.tmdbId, it.id);
    if (it.tvdbId != null) idx[kind].tvdb.set(it.tvdbId, it.id);
    if (it.imdbId) idx[kind].imdb.set(it.imdbId, it.id);
  }
  return {
    find(kind, ids) {
      return (
        (ids.tmdbId != null ? idx[kind].tmdb.get(ids.tmdbId) : undefined) ??
        (ids.tvdbId != null ? idx[kind].tvdb.get(ids.tvdbId) : undefined) ??
        (ids.imdbId ? idx[kind].imdb.get(ids.imdbId) : undefined) ??
        null
      );
    },
  };
}
