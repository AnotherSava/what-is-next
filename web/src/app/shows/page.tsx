import type { Metadata } from "next";
import { nowMs } from "@/lib/datetime";
import { formatInterval } from "@/lib/format";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId } from "@/lib/settings";
import { getFollowedShows, type ShowSummary } from "@/lib/shows";
import type { VisibleGroup } from "@/lib/progress";
import { ShowsView, type ShowCardData } from "./_components/ShowsView";

export const metadata: Metadata = { title: "Shows" };

// Within a group: favourites first, then most-behind, then title (unchanged ordering; the Shows view keeps array
// order when it regroups, so sorting the flat list here fixes the order inside every shelf).
function rank(a: ShowSummary, b: ShowSummary): number {
  return (
    Number(b.isFavorite) - Number(a.isFavorite) ||
    b.progress.unwatchedAiredCount - a.progress.unwatchedAiredCount ||
    a.title.localeCompare(b.title)
  );
}

export default async function ShowsPage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [allShows, plexServerId] = await Promise.all([
    getFollowedShows(displayedUser.id),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  const now = nowMs();

  const cards: ShowCardData[] = [...allShows]
    .filter((s) => s.group !== "off-list")
    .sort(rank)
    .map((s) => {
      const behind = s.group === "behind";
      const n = s.progress.nextUp;
      return {
        id: s.id,
        title: s.title,
        posterPath: s.posterPath,
        watchUrl: s.inPlex ? plexWatchUrl(plexServerId, s.plexRatingKey) : null,
        rating: s.imdbRating,
        isFavorite: s.isFavorite,
        group: s.group as Exclude<VisibleGroup, "off-list">,
        lastText: behind && s.lastWatchedAt ? `${formatInterval(now - s.lastWatchedAt.getTime())} ago` : "",
        nextCode: behind && n ? `S${n.seasonNumber} · E${n.episodeNumber}` : null,
        nextTitle: behind ? s.nextUpTitle : null,
        more: behind && s.progress.unwatchedAiredCount > 1 ? `+${s.progress.unwatchedAiredCount - 1} more` : "",
      };
    });

  return <ShowsView shows={cards} canFavorite={canEdit} />;
}
