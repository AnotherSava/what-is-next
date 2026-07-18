import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { getPrisma } from "@/lib/db";
import { displayDate, todayISO } from "@/lib/datetime";
import { getMovieDetail } from "@/lib/movies";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";
import { MarkWatchedControl, MovieFavoriteStar, UnmarkWatchedButton } from "../_components/MovieControls";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPrisma().mediaItem.findFirst({
    where: { mediaType: "movie", OR: [{ slug }, { id: slug }] },
    select: { title: true },
  });
  return { title: item?.title ?? "Movie" };
}

export default async function MovieDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [movie, manualWatched, plexServerId] = await Promise.all([
    getMovieDetail(displayedUser.id, slug),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  if (!movie) notFound();
  // Canonicalise: an id-based (or otherwise non-slug) URL 308-redirects to /movies/<slug> once a slug exists.
  if (movie.slug && movie.slug !== slug) redirect(`/movies/${movie.slug}`);

  const year = movie.releaseDate ? movie.releaseDate.slice(0, 4) : "";
  const watchUrl = plexWatchUrl(plexServerId, movie.plexRatingKey);
  const canMarkWatched = canEdit && manualWatched;
  const status = movie.watched
    ? `Watched${movie.watchedAt ? ` ${displayDate(movie.watchedAt)}` : ""}`
    : movie.tracked
      ? "On your watchlist"
      : "Not on your list";

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <PosterPlay
          path={movie.posterPath}
          alt={movie.title}
          width={120}
          height={180}
          size="w342"
          watchUrl={watchUrl}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              {movie.title}
              {year && <span className="ml-2 font-normal text-[var(--color-muted)]">({year})</span>}
            </h1>
            {movie.originalTitle && movie.originalTitle !== movie.title && (
              <p className="text-sm text-[var(--color-muted)]">{movie.originalTitle}</p>
            )}
          </div>
          <p className="text-sm">
            <span className={movie.watched ? "text-[var(--color-good)]" : "text-[var(--color-muted)]"}>{status}</span>
            {movie.runtime ? <span className="text-[var(--color-muted)]">{` · ${movie.runtime} min`}</span> : null}
          </p>
          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              {canMarkWatched &&
                (movie.watched ? (
                  <UnmarkWatchedButton movieId={movie.id} />
                ) : (
                  <MarkWatchedControl movieId={movie.id} today={todayISO()} />
                ))}
              {/* Favorite lives here (and only here) — watched movies only. */}
              {movie.watched && <MovieFavoriteStar movieId={movie.id} isFavorite={movie.isFavorite} />}
            </div>
          )}
        </div>
      </div>

      {movie.overview && <p className="text-sm leading-relaxed text-[var(--color-muted)]">{movie.overview}</p>}
    </div>
  );
}
