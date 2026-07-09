import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlexBadge } from "@/app/_components/PlexBadge";
import { Poster } from "@/app/_components/Poster";
import { getPrisma } from "@/lib/db";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getShowDetail } from "@/lib/shows";
import { EpisodeChecklist } from "../_components/EpisodeChecklist";
import { FavoriteStar, RefreshShowButton, TrackingSelect } from "../_components/ShowControls";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = await getPrisma().mediaItem.findFirst({ where: { id, mediaType: "tv" }, select: { title: true } });
  return { title: item?.title ?? "Show" };
}

export default async function ShowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const show = await getShowDetail(displayedUser.id, id);
  if (!show) notFound();

  const { progress } = show;
  const summary =
    progress.status === "behind"
      ? `${progress.unwatchedAiredCount} to watch`
      : progress.status === "finished"
        ? "Finished"
        : "Up to date";

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Poster path={show.posterPath} alt={show.title} width={120} height={180} size="w342" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight">{show.title}</h1>
              {show.inPlex && <PlexBadge />}
            </div>
            {show.originalTitle && show.originalTitle !== show.title && (
              <p className="text-sm text-[var(--color-muted)]">{show.originalTitle}</p>
            )}
          </div>
          <p className="text-sm">
            <span className={progress.status === "behind" ? "text-[var(--color-behind)]" : "text-[var(--color-good)]"}>
              {summary}
            </span>
            <span className="text-[var(--color-muted)]">
              {" · "}
              {progress.watchedAiredCount}/{progress.airedCount} aired watched
              {show.status ? ` · ${show.status}` : ""}
            </span>
          </p>
          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              <TrackingSelect showId={show.id} tracking={show.tracking ?? "watching"} />
              <FavoriteStar showId={show.id} isFavorite={show.isFavorite} />
              <RefreshShowButton showId={show.id} />
            </div>
          )}
        </div>
      </div>

      {show.overview && <p className="text-sm leading-relaxed text-[var(--color-muted)]">{show.overview}</p>}

      <EpisodeChecklist showId={show.id} seasons={show.seasons} canEdit={canEdit} />
    </div>
  );
}
