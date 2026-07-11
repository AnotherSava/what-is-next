import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getPlexPresenceKeys, getShowPlexPresence, isPlexConfigured } from "@/lib/plex";
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
  title: string;
  posterPath: string | null;
  status: string | null;
  isFavorite: boolean;
  progress: ShowProgress;
  group: DisplayGroup;
  inPlex: boolean;
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
}

const EPISODE_SELECT = {
  id: true,
  seasonNumber: true,
  episodeNumber: true,
  isSpecial: true,
  releaseDate: true,
} as const;

async function seenEpisodesByItem(userId: string): Promise<Map<string, { episodeId: string | null }[]>> {
  const seen = await getPrisma().seenEvent.findMany({
    where: { userId, episodeId: { not: null } },
    select: { episodeId: true, mediaItemId: true },
  });
  const byItem = new Map<string, { episodeId: string | null }[]>();
  for (const s of seen) {
    const arr = byItem.get(s.mediaItemId);
    if (arr) arr.push({ episodeId: s.episodeId });
    else byItem.set(s.mediaItemId, [{ episodeId: s.episodeId }]);
  }
  return byItem;
}

export async function getFollowedShows(userId: string, today: string = todayISO()): Promise<ShowSummary[]> {
  const prisma = getPrisma();
  const [states, seenByItem, plexShows] = await Promise.all([
    prisma.userMediaState.findMany({
      where: { userId, mediaItem: { is: { mediaType: "tv" } } },
      include: { mediaItem: { include: { episodes: { select: EPISODE_SELECT } } } },
    }),
    seenEpisodesByItem(userId),
    isPlexConfigured() ? getPlexPresenceKeys(userId) : Promise.resolve(new Map<string, string | null>()),
  ]);

  return states
    .map((st) => {
      const progress = computeShowProgress({
        episodes: st.mediaItem.episodes,
        seenEvents: seenByItem.get(st.mediaItemId) ?? [],
        airingStatus: st.mediaItem.status,
        todayISO: today,
      });
      const group = displayGroup(st.wantToWatch, progress);
      return {
        id: st.mediaItem.id,
        title: st.mediaItem.title,
        posterPath: st.mediaItem.posterPath,
        status: st.mediaItem.status,
        isFavorite: st.isFavorite,
        progress,
        // A favorite is a strong "keep this around", so it's never hidden — a favorited off-list show shows as Planned.
        group: group === "off-list" && st.isFavorite ? "planned" : group,
        inPlex: plexShows.has(st.mediaItemId),
        plexRatingKey: plexShows.get(st.mediaItemId) ?? null,
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
}

export interface ShowDetailSeason {
  seasonNumber: number;
  isSpecials: boolean;
  title: string | null;
  episodes: ShowDetailEpisode[];
  airedCount: number;
  watchedCount: number;
  inPlex: boolean;
}

export interface ShowDetail {
  id: string;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  status: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  tmdbId: number | null;
  releaseDate: string | null;
  wantToWatch: boolean;
  isFavorite: boolean;
  progress: ShowProgress;
  group: DisplayGroup;
  seasons: ShowDetailSeason[];
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
}

export async function getShowDetail(
  userId: string,
  showId: string,
  today: string = todayISO(),
): Promise<ShowDetail | null> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findFirst({
    where: { id: showId, mediaType: "tv" },
    include: {
      seasons: { orderBy: { seasonNumber: "asc" } },
      episodes: { orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }] },
    },
  });
  if (!item) return null;

  const [state, seen, plexPresence] = await Promise.all([
    prisma.userMediaState.findUnique({ where: { userId_mediaItemId: { userId, mediaItemId: showId } } }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: showId, episodeId: { not: null } },
      select: { episodeId: true },
    }),
    isPlexConfigured()
      ? getShowPlexPresence(userId, showId)
      : Promise.resolve({ seasons: new Set<number>(), ratingKey: null }),
  ]);
  const watched = watchedEpisodeIds(seen);
  const progress = computeShowProgress({
    episodes: item.episodes,
    seenEvents: seen,
    airingStatus: item.status,
    todayISO: today,
  });

  const episodesBySeason = new Map<number, ShowDetailEpisode[]>();
  for (const ep of [...item.episodes].sort(compareEpisodes)) {
    const aired = hasAired(ep.releaseDate, today);
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
    };
    const arr = episodesBySeason.get(ep.seasonNumber);
    if (arr) arr.push(row);
    else episodesBySeason.set(ep.seasonNumber, [row]);
  }

  const seasons: ShowDetailSeason[] = item.seasons.map((s) => {
    const episodes = episodesBySeason.get(s.seasonNumber) ?? [];
    return {
      seasonNumber: s.seasonNumber,
      isSpecials: s.isSpecials,
      title: s.title,
      episodes,
      airedCount: episodes.filter((e) => e.aired).length,
      watchedCount: episodes.filter((e) => e.watched).length,
      inPlex: plexPresence.seasons.has(s.seasonNumber),
    };
  });

  return {
    id: item.id,
    title: item.title,
    originalTitle: item.originalTitle,
    overview: item.overview,
    status: item.status,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    tmdbId: item.tmdbId,
    releaseDate: item.releaseDate,
    wantToWatch: state?.wantToWatch ?? false,
    isFavorite: state?.isFavorite ?? false,
    progress,
    group: displayGroup(state?.wantToWatch ?? false, progress),
    seasons,
    plexRatingKey: plexPresence.ratingKey,
  };
}
