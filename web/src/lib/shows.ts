import { type CastMember, parseCast } from "@/lib/cast";
import { displayMonthYear, isoDate, monthYearISO, todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getPlexPresenceKeys, getShowPlexPresence, isPlexConfigured, type SeasonPlexSource } from "@/lib/plex";
import { isWaitForFullSeasonEnabled } from "@/lib/settings";
import {
  compareEpisodes,
  computeShowProgress,
  displayGroup,
  hasAired,
  watchedEpisodeIds,
  type DisplayGroup,
  type ShowProgress,
  type VisibleGroup,
} from "@/lib/progress";

// Read-side data layer for the shows pages (brief §8.2, §8.3). Loads followed shows for a given user and
// computes derived state through progress.ts — the counts and "next up" are never stored. Every function takes
// an explicit userId (brief §5a rule 1).

export interface ShowSummary {
  id: string;
  slug: string | null; // URL slug for the detail link (falls back to id when unset)
  title: string;
  posterPath: string | null;
  status: string | null;
  isFavorite: boolean;
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10), fetched from OMDb; null when unresolved
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page; null when unresolved
  progress: ShowProgress;
  group: DisplayGroup;
  inPlex: boolean;
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
  nextUpTitle: string | null; // title of progress.nextUp (the next episode to watch), or null when up to date
  lastWatchedAt: Date | null; // most recent episode watch (any source), or null when nothing dated/watched
}

const EPISODE_SELECT = {
  id: true,
  seasonNumber: true,
  episodeNumber: true,
  isSpecial: true,
  releaseDate: true,
  title: true,
} as const;

async function seenEpisodesByItem(
  userId: string,
): Promise<Map<string, { episodeId: string | null; watchedAt: Date | null }[]>> {
  const seen = await getPrisma().seenEvent.findMany({
    where: { userId, episodeId: { not: null } },
    select: { episodeId: true, mediaItemId: true, watchedAt: true },
  });
  const byItem = new Map<string, { episodeId: string | null; watchedAt: Date | null }[]>();
  for (const s of seen) {
    const arr = byItem.get(s.mediaItemId);
    if (arr) arr.push({ episodeId: s.episodeId, watchedAt: s.watchedAt });
    else byItem.set(s.mediaItemId, [{ episodeId: s.episodeId, watchedAt: s.watchedAt }]);
  }
  return byItem;
}

// The most recent watchedAt among a show's seen episodes (undated watches ignored), or null if none is dated.
function latestWatchedAt(seen: { watchedAt: Date | null }[]): Date | null {
  let latest: Date | null = null;
  for (const s of seen) {
    if (s.watchedAt && (!latest || s.watchedAt > latest)) latest = s.watchedAt;
  }
  return latest;
}

export async function getFollowedShows(userId: string, today: string = todayISO()): Promise<ShowSummary[]> {
  const prisma = getPrisma();
  const [states, seenByItem, plexShows, waitForFullSeason] = await Promise.all([
    prisma.userMediaState.findMany({
      where: { userId, mediaItem: { is: { mediaType: "tv" } } },
      include: { mediaItem: { include: { episodes: { select: EPISODE_SELECT } } } },
    }),
    seenEpisodesByItem(userId),
    isPlexConfigured() ? getPlexPresenceKeys(userId) : Promise.resolve(new Map<string, string | null>()),
    isWaitForFullSeasonEnabled(),
  ]);

  return states
    .map((st) => {
      const seen = seenByItem.get(st.mediaItemId) ?? [];
      const progress = computeShowProgress({
        episodes: st.mediaItem.episodes,
        seenEvents: seen,
        airingStatus: st.mediaItem.status,
        todayISO: today,
        waitForFullSeason,
      });
      const group = displayGroup(st.wantToWatch, progress);
      const nextUpTitle = progress.nextUp
        ? (st.mediaItem.episodes.find((e) => e.id === progress.nextUp!.id)?.title ?? null)
        : null;
      return {
        id: st.mediaItem.id,
        slug: st.mediaItem.slug,
        title: st.mediaItem.title,
        posterPath: st.mediaItem.posterPath,
        status: st.mediaItem.status,
        isFavorite: st.isFavorite,
        tmdbRating: st.mediaItem.tmdbRating,
        imdbRating: st.mediaItem.imdbRating,
        imdbId: st.mediaItem.imdbId,
        progress,
        // A favorite is a strong "keep this around", so it's never hidden — a favorited off-list show shows as Planned.
        group: group === "off-list" && st.isFavorite ? "planned" : group,
        inPlex: plexShows.has(st.mediaItemId),
        plexRatingKey: plexShows.get(st.mediaItemId) ?? null,
        nextUpTitle,
        lastWatchedAt: latestWatchedAt(seen),
      };
    })
    .filter((s) => s.group !== "off-list"); // not wanted and nothing watched — the default no-opinion state
}

// The five display buckets for /shows, in presentation order (brief §8.2).
export const SHOW_GROUP_ORDER: VisibleGroup[] = ["behind", "up-to-date", "planned", "finished", "stopped"];

export function groupShows(shows: ShowSummary[]): Record<VisibleGroup, ShowSummary[]> {
  const groups: Record<VisibleGroup, ShowSummary[]> = {
    behind: [],
    "up-to-date": [],
    planned: [],
    finished: [],
    stopped: [],
  };
  for (const s of shows) {
    if (s.group === "off-list") continue; // filtered out by getFollowedShows; guard keeps the type exhaustive
    groups[s.group].push(s);
  }
  return groups;
}

// One-line status for a show card/header, keyed on the DISPLAY GROUP (not raw progress) so a Planned or Stopped
// show doesn't read like "N to watch". emphasize = render in the "behind" accent colour.
export function groupSummary(group: DisplayGroup, progress: ShowProgress): { text: string; emphasize: boolean } {
  switch (group) {
    case "behind":
      return { text: `${progress.unwatchedAiredCount} to watch`, emphasize: true };
    case "planned":
      return { text: "Not started", emphasize: false };
    case "stopped":
      return { text: "Stopped", emphasize: false };
    case "finished":
      return { text: "Finished", emphasize: false };
    case "up-to-date":
    case "off-list": // never displayed (filtered upstream); folded in to keep the switch exhaustive
      return { text: "Up to date", emphasize: false };
  }
}

export interface ShowDetailEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  releaseDate: string | null;
  runtime: number | null;
  isSpecial: boolean;
  aired: boolean;
  watched: boolean;
  watchedAtISO: string | null; // machine "YYYY-MM-DD" of the (most recent) watch — the date-editor input value; null = undated/unwatched
  watchedAtLabel: string | null; // human "Mon YYYY" of that watch, for the row's watched-on stamp; null = undated/unwatched
  airsLabel: string | null; // for unaired episodes: "airs Mon YYYY" (or "unaired" when the release date is unknown); null once aired
}

export interface ShowDetailSeason {
  seasonNumber: number;
  isSpecials: boolean;
  title: string | null;
  year: number | null; // earliest episode release year in the season — shown beside the season name
  episodes: ShowDetailEpisode[];
  airedCount: number;
  watchedCount: number;
  inPlex: boolean;
  source: SeasonPlexSource | null; // this season's Plex source (resolution/HDR/audio/subs) for the media pill; null when not in Plex
  latestWatchedAtISO: string | null; // machine date of the season's most recent watch — the season date-editor input value
  latestWatchedAtLabel: string | null; // human "Mon YYYY" of that watch, shown in the header when the season is folded + fully watched
}

export interface ShowDetail {
  id: string;
  slug: string | null; // canonical URL slug; the page redirects an id-based URL to /shows/<slug>
  title: string;
  originalTitle: string | null;
  originalLanguage: string | null; // TMDB original_language code (mostly ISO 639-1); drives the per-season "no original audio" warning
  overview: string | null;
  status: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  tmdbId: number | null;
  tmdbRating: number | null; // TMDB community score (0–10)
  imdbRating: number | null; // IMDb community score (0–10), fetched from OMDb; the poster ★ chip prefers it over TMDB
  releaseDate: string | null;
  creator: string | null; // show creator(s), comma-joined; null when unresolved
  cast: CastMember[]; // top-billed cast for the "Top cast" grid + "Stars" line; [] when unresolved
  tracked: boolean; // has a UserMediaState row — i.e. on your list / stopped (drives the ⋯ "remove" vs "stop" wording)
  wantToWatch: boolean;
  isFavorite: boolean;
  progress: ShowProgress;
  group: DisplayGroup;
  seasons: ShowDetailSeason[];
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
}

export async function getShowDetail(
  userId: string,
  idOrSlug: string,
  today: string = todayISO(),
): Promise<ShowDetail | null> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findFirst({
    where: { mediaType: "tv", OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
    include: {
      seasons: { orderBy: { seasonNumber: "asc" } },
      episodes: { orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }] },
    },
  });
  if (!item) return null;
  const showId = item.id; // resolved id — the queries below key on it, not on the (possibly slug) route param

  const [state, seen, plexPresence, waitForFullSeason] = await Promise.all([
    prisma.userMediaState.findUnique({ where: { userId_mediaItemId: { userId, mediaItemId: showId } } }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: showId, episodeId: { not: null } },
      select: { episodeId: true, watchedAt: true },
    }),
    isPlexConfigured()
      ? getShowPlexPresence(userId, showId)
      : Promise.resolve({ seasons: new Set<number>(), sources: new Map<number, SeasonPlexSource>(), ratingKey: null }),
    isWaitForFullSeasonEnabled(),
  ]);
  const watched = watchedEpisodeIds(seen);
  // Most recent dated watch per episode (a rewatch adds another SeenEvent); undated watches contribute nothing.
  const watchedAtByEpisode = new Map<string, Date>();
  for (const s of seen) {
    if (!s.episodeId || !s.watchedAt) continue;
    const prev = watchedAtByEpisode.get(s.episodeId);
    if (!prev || s.watchedAt > prev) watchedAtByEpisode.set(s.episodeId, s.watchedAt);
  }
  const progress = computeShowProgress({
    episodes: item.episodes,
    seenEvents: seen,
    airingStatus: item.status,
    todayISO: today,
    waitForFullSeason,
  });

  const episodesBySeason = new Map<number, ShowDetailEpisode[]>();
  // Earliest known release date per season (any episode) → the "(year)" beside the season name.
  const seasonEarliest = new Map<number, string>();
  for (const ep of [...item.episodes].sort(compareEpisodes)) {
    const aired = hasAired(ep.releaseDate, today);
    const watchedAt = watchedAtByEpisode.get(ep.id);
    const row: ShowDetailEpisode = {
      id: ep.id,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      releaseDate: ep.releaseDate,
      runtime: ep.runtime,
      isSpecial: ep.isSpecial,
      aired,
      watched: watched.has(ep.id),
      watchedAtISO: watchedAt ? isoDate(watchedAt) : null,
      watchedAtLabel: watchedAt ? displayMonthYear(watchedAt) : null,
      airsLabel: aired ? null : ep.releaseDate ? `airs ${monthYearISO(ep.releaseDate)}` : "unaired",
    };
    const arr = episodesBySeason.get(ep.seasonNumber);
    if (arr) arr.push(row);
    else episodesBySeason.set(ep.seasonNumber, [row]);
    if (ep.releaseDate) {
      const cur = seasonEarliest.get(ep.seasonNumber);
      if (!cur || ep.releaseDate < cur) seasonEarliest.set(ep.seasonNumber, ep.releaseDate);
    }
  }

  const seasons: ShowDetailSeason[] = item.seasons
    .map((s) => {
      const episodes = episodesBySeason.get(s.seasonNumber) ?? [];
      let latest: Date | undefined;
      for (const e of episodes) {
        const w = watchedAtByEpisode.get(e.id);
        if (w && (!latest || w > latest)) latest = w;
      }
      const earliest = seasonEarliest.get(s.seasonNumber);
      return {
        seasonNumber: s.seasonNumber,
        isSpecials: s.isSpecials,
        title: s.title,
        year: earliest ? Number(earliest.slice(0, 4)) : null,
        episodes,
        airedCount: episodes.filter((e) => e.aired).length,
        watchedCount: episodes.filter((e) => e.watched).length,
        inPlex: plexPresence.seasons.has(s.seasonNumber),
        source: plexPresence.sources.get(s.seasonNumber) ?? null,
        latestWatchedAtISO: latest ? isoDate(latest) : null,
        latestWatchedAtLabel: latest ? displayMonthYear(latest) : null,
      };
    })
    // Specials (season 0) sort ahead of Season 1 by number, but they're side content — show them after the
    // regular seasons, keeping numeric order within each group.
    .sort((a, b) => Number(a.isSpecials) - Number(b.isSpecials) || a.seasonNumber - b.seasonNumber);

  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    originalTitle: item.originalTitle,
    originalLanguage: item.originalLanguage,
    overview: item.overview,
    status: item.status,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    tmdbId: item.tmdbId,
    tmdbRating: item.tmdbRating,
    imdbRating: item.imdbRating,
    releaseDate: item.releaseDate,
    creator: item.creator,
    cast: parseCast(item.cast),
    tracked: state != null,
    wantToWatch: state?.wantToWatch ?? false,
    isFavorite: state?.isFavorite ?? false,
    progress,
    group: displayGroup(state?.wantToWatch ?? false, progress),
    seasons,
    plexRatingKey: plexPresence.ratingKey,
  };
}
