import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { getPrisma } from "@/lib/db";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";
import { getShowDetail, groupSummary } from "@/lib/shows";
import { EpisodeChecklist } from "../_components/EpisodeChecklist";
import { FavoriteStar, RefreshShowButton, TrackToggle } from "../_components/ShowControls";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPrisma().mediaItem.findFirst({
    where: { mediaType: "tv", OR: [{ slug }, { id: slug }] },
    select: { title: true },
  });
  return { title: item?.title ?? "Show" };
}

export default async function ShowDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [show, manualWatched, plexServerId] = await Promise.all([
    getShowDetail(displayedUser.id, slug),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  if (!show) notFound();
  // Canonicalise: an id-based (or otherwise non-slug) URL 308-redirects to /shows/<slug> once a slug exists.
  if (show.slug && show.slug !== slug) redirect(`/shows/${show.slug}`);

  const { progress } = show;
  const summary = groupSummary(show.group, progress);
  const watchUrl = plexWatchUrl(plexServerId, show.plexRatingKey);

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <PosterPlay path={show.posterPath} alt={show.title} width={120} height={180} size="w342" watchUrl={watchUrl} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h1 className="text-xl font-semibold leading-tight">{show.title}</h1>
            {show.originalTitle && show.originalTitle !== show.title && (
              <p className="text-sm text-[var(--color-muted)]">{show.originalTitle}</p>
            )}
          </div>
          <p className="text-sm">
            <span className={summary.emphasize ? "text-[var(--color-behind)]" : "text-[var(--color-good)]"}>
              {summary.text}
            </span>
            <span className="text-[var(--color-muted)]">
              {" · "}
              {progress.watchedAiredCount}/{progress.airedCount} aired watched
              {show.status ? ` · ${show.status}` : ""}
            </span>
          </p>
          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              {show.group !== "finished" && (
                <TrackToggle
                  showId={show.id}
                  wantToWatch={show.wantToWatch}
                  started={show.progress.watchedAiredCount > 0}
                  isFavorite={show.isFavorite}
                />
              )}
              <FavoriteStar showId={show.id} isFavorite={show.isFavorite} />
              <RefreshShowButton showId={show.id} />
            </div>
          )}
        </div>
      </div>

      {show.overview && <p className="text-sm leading-relaxed text-[var(--color-muted)]">{show.overview}</p>}

      <EpisodeChecklist
        showId={show.id}
        seasons={show.seasons}
        canEdit={canEdit && manualWatched}
        nextUpSeasonNumber={progress.nextUp?.seasonNumber ?? null}
      />
    </div>
  );
}
