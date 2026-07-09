import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getShowPlexPresence, getShowsInPlex, isPlexConfigured } from "@/lib/plex";
import {
  compareEpisodes,
  computeShowProgress,
  displayGroup,
  hasAired,
  watchedEpisodeIds,
  type DisplayGroup,
  type ShowProgress,
} from "@/lib/progress";

// Read-side data layer for the shows pages (brief §8.2, §8.3). Loads followed shows for a given user and
// computes derived state through progress.ts — the counts and "next up" are never stored. Every function takes
// an explicit userId (brief §5a rule 1).

export interface ShowSummary {
  id: string;
  title: string;
  posterPath: string | null;
  status: string | null;
  tracking: string;
  isFavorite: boolean;
  progress: ShowProgress;
  group: DisplayGroup;
  inPlex: boolean;
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
    isPlexConfigured() ? getShowsInPlex(userId) : Promise.resolve(new Set<string>()),
  ]);

  return states.map((st) => {
    const progress = computeShowProgress({
      episodes: st.mediaItem.episodes,
      seenEvents: seenByItem.get(st.mediaItemId) ?? [],
      airingStatus: st.mediaItem.status,
      todayISO: today,
    });
    return {
      id: st.mediaItem.id,
      title: st.mediaItem.title,
      posterPath: st.mediaItem.posterPath,
      status: st.mediaItem.status,
      tracking: st.tracking,
      isFavorite: st.isFavorite,
      progress,
      group: displayGroup(st.tracking, progress.status),
      inPlex: plexShows.has(st.mediaItemId),
    };
  });
}

// The five display buckets for /shows, in presentation order (brief §8.2).
export const SHOW_GROUP_ORDER: DisplayGroup[] = ["behind", "up-to-date", "planned", "finished", "stopped"];

export function groupShows(shows: ShowSummary[]): Record<DisplayGroup, ShowSummary[]> {
  const groups: Record<DisplayGroup, ShowSummary[]> = {
    behind: [],
    "up-to-date": [],
    planned: [],
    finished: [],
    stopped: [],
  };
  for (const s of shows) groups[s.group].push(s);
  return groups;
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
  tracking: string | null;
  isFavorite: boolean;
  progress: ShowProgress;
  seasons: ShowDetailSeason[];
  inPlex: boolean;
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
      : Promise.resolve({ inPlex: false, seasons: new Set<number>() }),
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
    tracking: state?.tracking ?? null,
    isFavorite: state?.isFavorite ?? false,
    progress,
    seasons,
    inPlex: plexPresence.inPlex,
  };
}
