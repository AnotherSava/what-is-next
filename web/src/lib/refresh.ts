import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { isEndedStatus } from "@/lib/progress";
import { setSetting } from "@/lib/settings";
import { getTmdb } from "@/lib/tmdb";

// Nightly metadata refresh (brief §7). Re-fetches catalog rows from TMDB and NEVER touches user-state tables.
//   • TV: status not Ended/Canceled, OR lastRefreshedAt older than 30 days (so ended shows still get an
//     occasional re-check for finale corrections).
//   • Movies: releaseDate null or in the future (nothing changes about a released movie).
// Logs a one-line summary into Setting `refresh:lastRun` for the admin page. The manual "Refresh now" buttons
// call the same code path.

export interface RefreshResult {
  tvRefreshed: number;
  moviesRefreshed: number;
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

  const result: RefreshResult = { tvRefreshed, moviesRefreshed, errors, durationMs: Date.now() - nowMs };
  await setSetting("refresh:lastRun", { at: new Date(nowMs).toISOString(), trigger, ...result });
  return result;
}

// Manually refresh a single show/movie (per-show "Refresh now" button). Returns false if it has no tmdbId.
export async function refreshOne(mediaItemId: string): Promise<boolean> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { tmdbId: true, mediaType: true },
  });
  if (!item?.tmdbId) return false;
  const tmdb = getTmdb();
  const id =
    item.mediaType === "tv"
      ? await hydrateShowByTmdbId(prisma, tmdb, item.tmdbId)
      : await hydrateMovieByTmdbId(prisma, tmdb, item.tmdbId);
  return id != null;
}
