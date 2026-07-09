import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { isEndedStatus } from "@/lib/progress";
import { setSetting } from "@/lib/settings";
import { getTmdb } from "@/lib/tmdb";
import { getTvdb, hydrateMovieByTvdbId, hydrateShowByTvdbId, isTvdbConfigured } from "@/lib/tvdb";

// Nightly metadata refresh (brief §7). Re-fetches catalog rows from TMDB and NEVER touches user-state tables.
//   • TV: status not Ended/Canceled, OR lastRefreshedAt older than 30 days (so ended shows still get an
//     occasional re-check for finale corrections).
//   • Movies: releaseDate null or in the future (nothing changes about a released movie).
// Logs a one-line summary into Setting `refresh:lastRun` for the admin page. The manual "Refresh now" buttons
// call the same code path.

export interface RefreshResult {
  tvRefreshed: number;
  moviesRefreshed: number;
  tvdbResolved: number; // catalog rows hydrated from the TVDB fallback (titles TMDB can't resolve)
  errors: number;
  durationMs: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function refreshAll(trigger: "cron" | "manual", nowMs: number = Date.now()): Promise<RefreshResult> {
  const prisma = getPrisma();
  const tmdb = getTmdb();
  const today = todayISO();
  let tvRefreshed = 0;
  let moviesRefreshed = 0;
  let tvdbResolved = 0;
  let errors = 0;

  const tvItems = await prisma.mediaItem.findMany({
    where: { mediaType: "tv", tmdbId: { not: null } },
    select: { tmdbId: true, status: true, lastRefreshedAt: true },
  });
  for (const it of tvItems) {
    const stale = !it.lastRefreshedAt || nowMs - it.lastRefreshedAt.getTime() > THIRTY_DAYS_MS;
    if (isEndedStatus(it.status) && !stale) continue;
    try {
      if (await hydrateShowByTmdbId(prisma, tmdb, it.tmdbId!)) tvRefreshed++;
      else errors++;
    } catch {
      errors++;
    }
  }

  const movieItems = await prisma.mediaItem.findMany({
    where: { mediaType: "movie", tmdbId: { not: null } },
    select: { tmdbId: true, releaseDate: true },
  });
  for (const it of movieItems) {
    const releasedInPast = it.releaseDate != null && it.releaseDate.slice(0, 10) <= today;
    if (releasedInPast) continue; // a released movie's metadata is stable
    try {
      if (await hydrateMovieByTmdbId(prisma, tmdb, it.tmdbId!)) moviesRefreshed++;
      else errors++;
    } catch {
      errors++;
    }
  }

  // TVDB fallback: hydrate rows TMDB can't resolve (tmdbId null, tvdbId set) — the import stubs and any titles
  // already adopted from TVDB. Skipped entirely when TVDB isn't configured. Kept small (a handful of titles).
  if (isTvdbConfigured()) {
    const tvdb = getTvdb();
    const fallbackItems = await prisma.mediaItem.findMany({
      where: { tmdbId: null, tvdbId: { not: null } },
      select: { tvdbId: true, mediaType: true },
    });
    for (const it of fallbackItems) {
      try {
        const id =
          it.mediaType === "tv"
            ? await hydrateShowByTvdbId(prisma, tvdb, it.tvdbId!)
            : await hydrateMovieByTvdbId(prisma, tvdb, it.tvdbId!);
        if (id) tvdbResolved++;
        else errors++;
      } catch {
        errors++;
      }
    }
  }

  const result: RefreshResult = { tvRefreshed, moviesRefreshed, tvdbResolved, errors, durationMs: Date.now() - nowMs };
  await setSetting("refresh:lastRun", { at: new Date(nowMs).toISOString(), trigger, ...result });
  return result;
}

// Manually refresh a single show/movie (per-show "Refresh now" button). Dispatches to TMDB or the TVDB fallback
// by which id the row carries — a set tmdbId is always TMDB-canonical, so it can never be routed to the TVDB
// hydrator (which would null it out); only tmdbId-null rows fall back to TVDB. Returns false when there's no
// usable id for the applicable source (or TVDB isn't configured).
export async function refreshOne(mediaItemId: string): Promise<boolean> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { tmdbId: true, tvdbId: true, mediaType: true },
  });
  if (!item) return false;

  if (item.tmdbId == null) {
    if (!item.tvdbId || !isTvdbConfigured()) return false;
    const tvdb = getTvdb();
    const id =
      item.mediaType === "tv"
        ? await hydrateShowByTvdbId(prisma, tvdb, item.tvdbId)
        : await hydrateMovieByTvdbId(prisma, tvdb, item.tvdbId);
    return id != null;
  }

  const tmdb = getTmdb();
  const id =
    item.mediaType === "tv"
      ? await hydrateShowByTmdbId(prisma, tmdb, item.tmdbId)
      : await hydrateMovieByTmdbId(prisma, tmdb, item.tmdbId);
  return id != null;
}
