import type { Metadata } from "next";
import { displayDate, nowMs } from "@/lib/datetime";
import { formatInterval } from "@/lib/format";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId } from "@/lib/settings";
import { getFollowedShows, SHOW_GROUP_ORDER, type ShowSummary } from "@/lib/shows";
import type { DisplayGroup, VisibleGroup } from "@/lib/progress";
import { ShowsView, type ShowCardData } from "./_components/ShowsView";

export const metadata: Metadata = { title: "Shows" };

const GROUP_RANK = new Map<DisplayGroup, number>(SHOW_GROUP_ORDER.map((g, i) => [g, i]));

// Order the flat list by group first, then within each group: favourites first, then the group-appropriate key
// (Behind → most-recently-watched first; every other shelf → most-behind), then title. Grouping first is what keeps
// the comparator transitive — behindRecency only ever sees same-(Behind)-group pairs, so it never conflicts with the
// most-behind fallback that orders other groups. The Shows view keeps array order when it regroups, so sorting here
// fixes the order inside every shelf.
function rank(a: ShowSummary, b: ShowSummary): number {
  return (
    (GROUP_RANK.get(a.group) ?? 0) - (GROUP_RANK.get(b.group) ?? 0) ||
    Number(b.isFavorite) - Number(a.isFavorite) ||
    behindRecency(a, b) ||
    b.progress.unwatchedAiredCount - a.progress.unwatchedAiredCount ||
    a.title.localeCompare(b.title)
  );
}

// Most-recent watch first, applied only within the Behind shelf (0 for any other pairing, so the remaining shelves
// keep their most-behind/title order). Undated/never-watched shows sink to the bottom of the shelf.
function behindRecency(a: ShowSummary, b: ShowSummary): number {
  if (a.group !== "behind" || b.group !== "behind") return 0;
  return (b.lastWatchedAt?.getTime() ?? -Infinity) - (a.lastWatchedAt?.getTime() ?? -Infinity);
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
        slug: s.slug,
        title: s.title,
        posterPath: s.posterPath,
        watchUrl: s.inPlex ? plexWatchUrl(plexServerId, s.plexRatingKey) : null,
        rating: s.imdbRating,
        isFavorite: s.isFavorite,
        group: s.group as Exclude<VisibleGroup, "off-list">,
        lastText: behind && s.lastWatchedAt ? `${formatInterval(now - s.lastWatchedAt.getTime())} ago` : "",
        lastTitle: behind && s.lastWatchedAt ? displayDate(s.lastWatchedAt) : "",
        nextCode: behind && n ? `S${n.seasonNumber} · E${n.episodeNumber}` : null,
        nextTitle: behind ? s.nextUpTitle : null,
        moreCount: behind ? s.progress.unwatchedAiredCount - 1 : 0,
      };
    });

  return <ShowsView shows={cards} canFavorite={canEdit} />;
}
