import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { hasAired } from "@/lib/progress";

// Read-side data layer for the "Recently watched" feed. Shows the user's watch history across ALL sources (Plex
// sync, in-app marks, and the historical TV Time import), newest watch first. Explicit userId (brief §5a rule 1).

export interface RecentWatch {
  id: string;
  kind: "episode" | "movie";
  mediaItemId: string;
  mediaType: "tv" | "movie";
  title: string;
  posterPath: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  watchedAt: Date | null; // when watched (null = "seen, date unknown")
}

export async function getRecentWatches(userId: string, limit = 100): Promise<RecentWatch[]> {
  const rows = await getPrisma().seenEvent.findMany({
    where: { userId },
    // SQLite sorts NULLs last on DESC, so undated watches sink below dated ones; createdAt breaks ties.
    orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      watchedAt: true,
      episodeId: true,
      mediaItem: { select: { id: true, mediaType: true, title: true, posterPath: true } },
      episode: { select: { seasonNumber: true, episodeNumber: true, title: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.episodeId ? "episode" : "movie",
    mediaItemId: r.mediaItem.id,
    mediaType: r.mediaItem.mediaType === "movie" ? "movie" : "tv",
    title: r.mediaItem.title,
    posterPath: r.mediaItem.posterPath,
    seasonNumber: r.episode?.seasonNumber ?? null,
    episodeNumber: r.episode?.episodeNumber ?? null,
    episodeTitle: r.episode?.title ?? null,
    watchedAt: r.watchedAt,
  }));
}

// ---------------------------------------------------------------------------
// Timeline view (design reference): the same history grouped into time periods ("This week", then "Month Year"),
// with a show's episode watches in one period collapsed into a single card whose episodes aggregate into a range.
// ---------------------------------------------------------------------------

// One show+season's episode watches within a period, collapsed. epFirst–epLast is the span (first watched → last,
// gaps included, matching the reference); fullSeason means every aired non-special episode of the season is here,
// so the card can read just "Season N" without an episode range.
export interface TimelineEpisodeGroup {
  kind: "episode";
  key: string;
  mediaItemId: string;
  slug: string | null; // show URL slug (falls back to mediaItemId)
  title: string;
  posterPath: string | null;
  imdbRating: number | null;
  isFavorite: boolean;
  seasonNumber: number;
  epFirst: number;
  epLast: number;
  epCount: number;
  fullSeason: boolean;
}

export interface TimelineMovie {
  kind: "movie";
  key: string;
  mediaItemId: string;
  slug: string | null; // movie URL slug (falls back to mediaItemId)
  title: string;
  posterPath: string | null;
  imdbRating: number | null;
  isFavorite: boolean;
  releaseDate: string | null;
  director: string | null;
  runtime: number | null;
}

export type TimelineItem = TimelineEpisodeGroup | TimelineMovie;
export interface TimelinePeriod {
  period: string;
  items: TimelineItem[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function periodLabel(watchedAt: Date | null, nowMs: number): string {
  if (!watchedAt) return "Earlier";
  if (nowMs - watchedAt.getTime() <= WEEK_MS) return "This week";
  return `${MONTHS[watchedAt.getMonth()]} ${watchedAt.getFullYear()}`;
}

// Group the recent watches into the timeline the Recent view renders. `nowMs` is the request-time snapshot used for
// the "This week" boundary; `today` bounds "has it aired" for the full-season check.
export async function getRecentTimeline(
  userId: string,
  nowMs: number,
  today: string = todayISO(),
  limit = 200,
): Promise<TimelinePeriod[]> {
  const prisma = getPrisma();
  const [rows, favStates] = await Promise.all([
    prisma.seenEvent.findMany({
      where: { userId },
      orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        watchedAt: true,
        episodeId: true,
        mediaItem: {
          select: {
            id: true,
            slug: true,
            title: true,
            posterPath: true,
            imdbRating: true,
            releaseDate: true,
            director: true,
            runtime: true,
          },
        },
        episode: { select: { seasonNumber: true, episodeNumber: true } },
      },
    }),
    prisma.userMediaState.findMany({ where: { userId, isFavorite: true }, select: { mediaItemId: true } }),
  ]);
  const favs = new Set(favStates.map((s) => s.mediaItemId));

  // Aired non-special episode count per (show, season) — for the "full season" simplification.
  const showIds = [...new Set(rows.filter((r) => r.episodeId).map((r) => r.mediaItem.id))];
  const seasonAired = new Map<string, number>();
  if (showIds.length > 0) {
    const eps = await prisma.episode.findMany({
      where: { mediaItemId: { in: showIds }, isSpecial: false },
      select: { mediaItemId: true, seasonNumber: true, releaseDate: true },
    });
    for (const e of eps) {
      if (!hasAired(e.releaseDate, today)) continue;
      const k = `${e.mediaItemId}|${e.seasonNumber}`;
      seasonAired.set(k, (seasonAired.get(k) ?? 0) + 1);
    }
  }

  const periods: TimelinePeriod[] = [];
  const periodByName = new Map<string, TimelinePeriod>();
  const groupByKey = new Map<string, { group: TimelineEpisodeGroup; eps: Set<number> }>();
  const getPeriod = (name: string): TimelinePeriod => {
    let p = periodByName.get(name);
    if (!p) {
      p = { period: name, items: [] };
      periodByName.set(name, p);
      periods.push(p);
    }
    return p;
  };

  for (const r of rows) {
    const name = periodLabel(r.watchedAt, nowMs);
    const p = getPeriod(name);
    if (r.episodeId && r.episode) {
      const season = r.episode.seasonNumber ?? 0;
      const gk = `${name}|${r.mediaItem.id}|${season}`;
      let entry = groupByKey.get(gk);
      if (!entry) {
        const group: TimelineEpisodeGroup = {
          kind: "episode",
          key: gk,
          mediaItemId: r.mediaItem.id,
          slug: r.mediaItem.slug,
          title: r.mediaItem.title,
          posterPath: r.mediaItem.posterPath,
          imdbRating: r.mediaItem.imdbRating,
          isFavorite: favs.has(r.mediaItem.id),
          seasonNumber: season,
          epFirst: 0,
          epLast: 0,
          epCount: 0,
          fullSeason: false,
        };
        entry = { group, eps: new Set() };
        groupByKey.set(gk, entry);
        p.items.push(group);
      }
      if (r.episode.episodeNumber != null) entry.eps.add(r.episode.episodeNumber);
    } else {
      p.items.push({
        kind: "movie",
        key: r.id,
        mediaItemId: r.mediaItem.id,
        slug: r.mediaItem.slug,
        title: r.mediaItem.title,
        posterPath: r.mediaItem.posterPath,
        imdbRating: r.mediaItem.imdbRating,
        isFavorite: favs.has(r.mediaItem.id),
        releaseDate: r.mediaItem.releaseDate,
        director: r.mediaItem.director,
        runtime: r.mediaItem.runtime,
      });
    }
  }

  for (const { group, eps } of groupByKey.values()) {
    const sorted = [...eps].sort((a, b) => a - b);
    group.epFirst = sorted[0] ?? 0;
    group.epLast = sorted[sorted.length - 1] ?? 0;
    group.epCount = sorted.length;
    const total = seasonAired.get(`${group.mediaItemId}|${group.seasonNumber}`) ?? 0;
    group.fullSeason = total > 0 && sorted.length >= total;
  }

  // Bulk imports stamp a whole season's episodes with one timestamp, so two seasons of the same show can land a
  // second apart and sort in reverse (S3 ahead of S4). Cross-show recency stays as-is; we only reorder a show's own
  // seasons into the slots it already occupies, newest season first, so they read in season order.
  for (const p of periods) {
    const slotsByShow = new Map<string, number[]>();
    p.items.forEach((it, i) => {
      if (it.kind !== "episode") return;
      const slots = slotsByShow.get(it.mediaItemId) ?? [];
      slots.push(i);
      slotsByShow.set(it.mediaItemId, slots);
    });
    for (const slots of slotsByShow.values()) {
      if (slots.length < 2) continue;
      const groups = slots.map((i) => p.items[i] as TimelineEpisodeGroup).sort((a, b) => b.seasonNumber - a.seasonNumber);
      slots.forEach((i, k) => (p.items[i] = groups[k]));
    }
  }

  return periods;
}
