import type { Metadata } from "next";
import { nowMs } from "@/lib/datetime";
import { formatRuntime } from "@/lib/format";
import { getRecentTimeline, type TimelineItem } from "@/lib/recent";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { RecentView, type RecentCard, type RecentPeriodData } from "./_components/RecentView";

export const metadata: Metadata = { title: "Recently watched" };

function toCard(it: TimelineItem): RecentCard {
  const rating = it.imdbRating;
  if (it.kind === "episode") {
    const epRange = it.fullSeason
      ? ""
      : it.epCount <= 1
        ? `Episode ${it.epFirst}`
        : `Episodes ${it.epFirst}–${it.epLast}`;
    return {
      kind: "episode",
      key: it.key,
      id: it.mediaItemId,
      title: it.title,
      posterPath: it.posterPath,
      rating,
      isFavorite: it.isFavorite,
      seasonLabel: `Season ${it.seasonNumber}`,
      epRange,
    };
  }
  return {
    kind: "movie",
    key: it.key,
    id: it.mediaItemId,
    title: it.title,
    posterPath: it.posterPath,
    rating,
    isFavorite: it.isFavorite,
    year: it.releaseDate ? it.releaseDate.slice(0, 4) : "",
    director: it.director ?? "",
    runtime: formatRuntime(it.runtime),
  };
}

export default async function RecentPage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const timeline = await getRecentTimeline(displayedUser.id, nowMs());

  const periods: RecentPeriodData[] = timeline.map((p) => ({
    period: p.period,
    items: p.items.map((it) => toCard(it)),
  }));

  return <RecentView periods={periods} canFavorite={canEdit} />;
}
