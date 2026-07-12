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
//   • Movies: releaseDate null or in the future, OR lastRefreshedAt older than 7 days. A released movie's
//     metadata is stable, but its TMDB/IMDb ratings drift as votes accumulate, so re-check it weekly — a shorter
//     window than TV's, since a movie has no other refresh trigger (airing shows already refresh every night).
// Logs a one-line summary into Setting `refresh:lastRun` for the admin page. The manual "Refresh now" buttons
// call the same code path.

export interface RefreshResult {
  tvRefreshed: number;
  moviesRefreshed: number;
  tvdbResolved: number; // catalog rows hydrated from the TVDB fallback (titles TMDB can't resolve)
  errors: number;
  durationMs: number;
}

// Live progress for the manual "Refresh now" stream (admin UI). Counts are items *processed* (success or error)
// so the bar advances even when an item fails. The nightly cron passes no callback and never builds these.
export interface RefreshProgress {
  done: number; // items processed so far across all phases
  total: number; // items that will be processed this run
  tvDone: number;
  tvTotal: number;
  movieDone: number;
  movieTotal: number;
  tvdbDone: number;
  tvdbTotal: number;
  current: string | null; // title of the item currently being fetched, or null between/after items
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // TV ended-show re-check window
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // released-movie rating re-check window (see the movies note above)

// `onProgress`, when given (manual runs), is called once up front with the totals and then after every processed
// item, so the admin UI can stream a determinate progress bar. The nightly cron omits it and behaves as before.
export async function refreshAll(
  trigger: "cron" | "manual",
  nowMs: number = Date.now(),
  onProgress?: (progress: RefreshProgress) => void,
): Promise<RefreshResult> {
  const prisma = getPrisma();
  const tmdb = getTmdb();
  const today = todayISO();

  // Build the work lists first so the exact total is known before any item runs (progress needs it) and the skip
  // predicates live in one place instead of being duplicated by a separate counting pass.
  const tvItems = await prisma.mediaItem.findMany({
    where: { mediaType: "tv", tmdbId: { not: null } },
    select: { tmdbId: true, status: true, lastRefreshedAt: true, title: true },
  });
  const tvWork = tvItems.filter((it) => {
    const stale = !it.lastRefreshedAt || nowMs - it.lastRefreshedAt.getTime() > THIRTY_DAYS_MS;
    return !(isEndedStatus(it.status) && !stale); // ended & still fresh → nothing changes, skip
  });

  const movieItems = await prisma.mediaItem.findMany({
    where: { mediaType: "movie", tmdbId: { not: null } },
    select: { tmdbId: true, releaseDate: true, lastRefreshedAt: true, title: true },
  });
  // Unreleased/undated movies always refresh; a released movie's metadata is stable, but its TMDB/IMDb ratings
  // drift, so re-check it once it's older than the weekly staleness window (shorter than TV's — see note above).
  const movieWork = movieItems.filter((it) => {
    const released = it.releaseDate != null && it.releaseDate.slice(0, 10) <= today;
    const stale = !it.lastRefreshedAt || nowMs - it.lastRefreshedAt.getTime() > SEVEN_DAYS_MS;
    return !released || stale;
  });

  // TVDB fallback: rows TMDB can't resolve (tmdbId null, tvdbId set) — the import stubs and any titles already
  // adopted from TVDB. Skipped entirely when TVDB isn't configured. Kept small (a handful of titles).
  const tvdbWork = isTvdbConfigured()
    ? await prisma.mediaItem.findMany({
        where: { tmdbId: null, tvdbId: { not: null } },
        select: { tvdbId: true, mediaType: true, title: true },
      })
    : [];

  const total = tvWork.length + movieWork.length + tvdbWork.length;
  let tvRefreshed = 0;
  let moviesRefreshed = 0;
  let tvdbResolved = 0;
  let errors = 0;
  let tvProcessed = 0;
  let movieProcessed = 0;
  let tvdbProcessed = 0;
  let current: string | null = null; // title of the item in flight, surfaced live in the admin progress bar
  const emit = () =>
    onProgress?.({
      done: tvProcessed + movieProcessed + tvdbProcessed,
      total,
      tvDone: tvProcessed,
      tvTotal: tvWork.length,
      movieDone: movieProcessed,
      movieTotal: movieWork.length,
      tvdbDone: tvdbProcessed,
      tvdbTotal: tvdbWork.length,
      current,
    });
  emit(); // initial snapshot so the client can size the bar before the first item completes

  // Each loop emits *before* fetching, so the bar names the title now in flight; the counts stay "completed so far"
  // and tick up as the next item begins.
  for (const it of tvWork) {
    current = it.title;
    emit();
    try {
      if (await hydrateShowByTmdbId(prisma, tmdb, it.tmdbId!)) tvRefreshed++;
      else errors++;
    } catch {
      errors++;
    }
    tvProcessed++;
  }

  for (const it of movieWork) {
    current = it.title;
    emit();
    try {
      if (await hydrateMovieByTmdbId(prisma, tmdb, it.tmdbId!)) moviesRefreshed++;
      else errors++;
    } catch {
      errors++;
    }
    movieProcessed++;
  }

  if (tvdbWork.length > 0) {
    const tvdb = getTvdb();
    for (const it of tvdbWork) {
      current = it.title;
      emit();
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
      tvdbProcessed++;
    }
  }

  current = null;
  emit(); // final frame: everything processed, nothing in flight (100%)

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
