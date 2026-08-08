import { type CastMember, parseCast } from "@/lib/cast";
import { getPrisma } from "@/lib/db";
import {
  getMoviePresence,
  getPresenceRefs,
  isMediaServerEnabled,
  type AudioTrack,
  type PresenceRef,
} from "@/lib/media";

// Read-side data layer for /movies (brief §8.4). A movie is "watched" iff it has a SeenEvent (episodeId null)
// — the append-only log is the source of truth — and its watch date is the latest such event. Unlike shows,
// movies have no off-list/Stopped state: tracking is simply whether a UserMediaState row exists, so every row is
// shown (watched → Watched, else Watchlist) and untracking deletes the row. Explicit userId per §5a rule 1.

export interface MovieSummary {
  id: string;
  slug: string | null; // URL slug for the detail link (falls back to id when unset)
  title: string;
  originalTitle: string | null; // native title — the query for a download source that searches in that language
  originalLanguage: string | null; // TMDB original_language code (mostly ISO 639-1); which language originalTitle is in
  posterPath: string | null;
  releaseDate: string | null;
  tmdbId: number | null;
  tmdbRating: number | null; // TMDB community score (0–10)
  imdbRating: number | null; // IMDb community score (0–10), fetched from OMDb; null when unresolved
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page; null when unresolved
  director: string | null; // director(s), comma-joined; null when unresolved
  runtime: number | null; // minutes; null when unresolved
  isFavorite: boolean;
  watched: boolean;
  watchedAt: Date | null;
  addedAt: Date; // when the title was added to the list (UserMediaState.createdAt) — the "added" half of the sort key
  onServer: boolean; // present in a connected media server's library (Plex or Jellyfin)
  presence: PresenceRef | null; // which server holds it + its key there → the watch deep link; null when on none
}

export interface MoviesView {
  watched: MovieSummary[];
  watchlist: MovieSummary[];
}

export async function getMovies(userId: string): Promise<MoviesView> {
  const prisma = getPrisma();
  const onAnyServer = await isMediaServerEnabled();
  const [states, seen, presence] = await Promise.all([
    prisma.userMediaState.findMany({
      where: { userId, mediaItem: { is: { mediaType: "movie" } } },
      include: { mediaItem: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.seenEvent.findMany({
      where: { userId, episodeId: null, mediaItem: { is: { mediaType: "movie" } } },
      select: { mediaItemId: true, watchedAt: true },
    }),
    onAnyServer ? getPresenceRefs(userId) : Promise.resolve(new Map<string, PresenceRef>()),
  ]);

  // Latest watch date per movie (null "seen, date unknown" events still mark it watched).
  const latestWatch = new Map<string, Date | null>();
  const watchedSet = new Set<string>();
  for (const e of seen) {
    watchedSet.add(e.mediaItemId);
    const prev = latestWatch.get(e.mediaItemId);
    if (!latestWatch.has(e.mediaItemId) || (e.watchedAt && (!prev || e.watchedAt > prev))) {
      latestWatch.set(e.mediaItemId, e.watchedAt ?? prev ?? null);
    }
  }

  const watched: MovieSummary[] = [];
  const watchlist: MovieSummary[] = [];
  for (const st of states) {
    const isWatched = watchedSet.has(st.mediaItemId);
    const summary: MovieSummary = {
      id: st.mediaItem.id,
      slug: st.mediaItem.slug,
      title: st.mediaItem.title,
      originalTitle: st.mediaItem.originalTitle,
      originalLanguage: st.mediaItem.originalLanguage,
      posterPath: st.mediaItem.posterPath,
      releaseDate: st.mediaItem.releaseDate,
      tmdbId: st.mediaItem.tmdbId,
      tmdbRating: st.mediaItem.tmdbRating,
      imdbRating: st.mediaItem.imdbRating,
      imdbId: st.mediaItem.imdbId,
      director: st.mediaItem.director,
      runtime: st.mediaItem.runtime,
      isFavorite: st.isFavorite,
      watched: isWatched,
      watchedAt: latestWatch.get(st.mediaItemId) ?? null,
      addedAt: st.createdAt,
      onServer: presence.has(st.mediaItemId),
      presence: presence.get(st.mediaItemId) ?? null,
    };
    if (isWatched) watched.push(summary);
    else watchlist.push(summary);
  }

  // Watched: most recent first (undated sink to the end). Watchlist: keep updatedAt order.
  watched.sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0));
  return { watched, watchlist };
}

export interface MovieDetail {
  id: string;
  slug: string | null; // canonical URL slug; the page redirects an id-based URL to /movies/<slug>
  title: string;
  originalTitle: string | null;
  originalLanguage: string | null; // TMDB original_language code (mostly ISO 639-1); picks the download-search title
  overview: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  imdbRating: number | null; // IMDb community score (0–10) for the poster ★ chip; null when unresolved
  director: string | null; // director(s), comma-joined; null when unresolved
  cast: CastMember[]; // top-billed cast for the "Top cast" grid + "Stars" line; [] when unresolved
  tmdbId: number | null;
  tracked: boolean; // has a UserMediaState row — i.e. on your watchlist or already watched
  isFavorite: boolean;
  watched: boolean;
  watchedAt: Date | null; // latest watch date, or null if watched-but-undated / unwatched
  onServer: boolean; // present in a connected server's library — the hero leads with Play vs Download (not)
  presence: PresenceRef | null; // which server holds it + its key there → the watch deep link; null when on none
  videoResolution: string | null; // source resolution of the copy ("4k"|"1080"|…); null when on no server
  hdrFormat: string | null; // combined HDR label of the copy ("Dolby Vision · HDR10"|…); null = SDR / on no server
  audioTracks: AudioTrack[]; // audio-row languages of the copy; [] when on no server / unknown
  subtitleLangs: string[]; // subtitle-row languages of the copy; [] when on no server / unknown
}

export async function getMovieDetail(userId: string, idOrSlug: string): Promise<MovieDetail | null> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findFirst({
    where: { mediaType: "movie", OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
  });
  if (!item) return null;
  const movieId = item.id; // resolved id — the queries below key on it, not on the (possibly slug) route param

  const onAnyServer = await isMediaServerEnabled();
  const [state, seen, presence] = await Promise.all([
    prisma.userMediaState.findUnique({ where: { userId_mediaItemId: { userId, mediaItemId: movieId } } }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: movieId, episodeId: null },
      select: { watchedAt: true },
    }),
    onAnyServer ? getMoviePresence(userId, movieId) : Promise.resolve(null),
  ]);

  let watchedAt: Date | null = null;
  for (const e of seen) if (e.watchedAt && (!watchedAt || e.watchedAt > watchedAt)) watchedAt = e.watchedAt;

  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    originalTitle: item.originalTitle,
    originalLanguage: item.originalLanguage,
    overview: item.overview,
    posterPath: item.posterPath,
    releaseDate: item.releaseDate,
    runtime: item.runtime,
    imdbRating: item.imdbRating,
    director: item.director,
    cast: parseCast(item.cast),
    tmdbId: item.tmdbId,
    tracked: state != null,
    isFavorite: state?.isFavorite ?? false,
    watched: seen.length > 0,
    watchedAt,
    onServer: presence != null,
    presence: presence?.ref ?? null,
    videoResolution: presence?.videoResolution ?? null,
    hdrFormat: presence?.hdrFormat ?? null,
    audioTracks: presence?.audioTracks ?? [],
    subtitleLangs: presence?.subtitleLangs ?? [],
  };
}
