import { CardMetaRow, CardTitle, SectionTitle } from "@/app/_components/cardUi";
import { CardNextRow } from "@/app/_components/CardNextRow";
import { PosterCard } from "@/app/_components/PosterCard";
import { getDashboard, type BehindShow, type ReadyMovie } from "@/lib/dashboard";
import { nowMs } from "@/lib/datetime";
import { formatInterval, formatRuntime } from "@/lib/format";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId } from "@/lib/settings";

// Home / "Watch next" — the payoff screen (brief §8.1), rebuilt as the design reference's poster grids: a "Shows"
// shelf of behind shows whose next-up episode is in Plex (playable now), then a "Movies" shelf of unwatched
// watchlist titles present in your library. Behind shows whose next episode isn't in Plex live in the Download view.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyMovies, readyInPlex }, plexServerId] = await Promise.all([
    getDashboard(displayedUser.id),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty = readyMovies.length === 0 && readyInPlex.length === 0;

  if (empty) {
    return (
      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
        {canEdit
          ? "Nothing ready to watch in Plex right now — check Download for episodes to grab."
          : "Nothing ready to watch in Plex right now."}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {readyInPlex.length > 0 && (
        <section>
          <div className="mb-4">
            <SectionTitle>Shows</SectionTitle>
          </div>
          <div className="wn-grid">
            {readyInPlex.map((s) => (
              <ShowCard key={s.showId} show={s} plexServerId={plexServerId} now={now} canEdit={canEdit} />
            ))}
          </div>
        </section>
      )}

      {readyMovies.length > 0 && (
        <section>
          <div className="mb-4">
            <SectionTitle>Movies</SectionTitle>
          </div>
          <div className="wn-grid">
            {readyMovies.map((m) => (
              <MovieCard key={m.movieId} movie={m} plexServerId={plexServerId} canEdit={canEdit} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShowCard({
  show,
  plexServerId,
  now,
  canEdit,
}: {
  show: BehindShow;
  plexServerId: string | null;
  now: number;
  canEdit: boolean;
}) {
  const watchUrl = show.nextUpInPlex ? plexWatchUrl(plexServerId, show.plexRatingKey) : null;
  const lastText = show.lastWatchedAt ? `${formatInterval(now - show.lastWatchedAt.getTime())} ago` : "";
  const moreCount = show.unwatchedAiredCount - 1;
  return (
    <PosterCard
      mediaType="tv"
      id={show.showId}
      title={show.title}
      posterPath={show.posterPath}
      detailHref={`/shows/${show.slug ?? show.showId}`}
      watchUrl={watchUrl}
      rating={show.imdbRating}
      isFavorite={show.isFavorite}
      canFavorite={canEdit}
    >
      <CardTitle title={show.title} aside={lastText} />
      <CardNextRow
        code={`S${show.nextUp.seasonNumber} · E${show.nextUp.episodeNumber}`}
        epTitle={show.nextUp.title}
        moreCount={moreCount}
      />
    </PosterCard>
  );
}

function MovieCard({
  movie,
  plexServerId,
  canEdit,
}: {
  movie: ReadyMovie;
  plexServerId: string | null;
  canEdit: boolean;
}) {
  const watchUrl = plexWatchUrl(plexServerId, movie.plexRatingKey);
  const year = movie.releaseDate ? movie.releaseDate.slice(0, 4) : "";
  return (
    <PosterCard
      mediaType="movie"
      id={movie.movieId}
      title={movie.title}
      posterPath={movie.posterPath}
      detailHref={`/movies/${movie.slug ?? movie.movieId}`}
      watchUrl={watchUrl}
      rating={movie.imdbRating}
      isFavorite={movie.isFavorite}
      canFavorite={canEdit}
    >
      <CardTitle title={movie.title} aside={year} />
      <CardMetaRow left={movie.director ?? ""} right={formatRuntime(movie.runtime)} />
    </PosterCard>
  );
}
