import { CardMetaRow, CardTitle, SectionTitle } from "@/app/_components/cardUi";
import { CardNextRow } from "@/app/_components/CardNextRow";
import { PosterCard } from "@/app/_components/PosterCard";
import { getDashboard, type BehindShow, type ReadyMovie } from "@/lib/dashboard";
import { nowMs } from "@/lib/datetime";
import { formatInterval, formatRuntime } from "@/lib/format";
import { getWatchLinker, type WatchLinker } from "@/lib/media";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";

// Home / "Watch next" — the payoff screen (brief §8.1), rebuilt as the design reference's poster grids: a "Shows"
// shelf of behind shows whose next-up episode is already in your media-server library (playable now), then a
// "Movies" shelf of unwatched watchlist titles you have. Behind shows whose next episode you don't have yet live
// in the Download view.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyMovies, readyShows }, watchLink] = await Promise.all([
    getDashboard(displayedUser.id),
    getWatchLinker(),
  ]);
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty = readyMovies.length === 0 && readyShows.length === 0;

  if (empty) {
    return (
      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
        {canEdit
          ? "Nothing ready to watch right now — check Download for episodes to grab."
          : "Nothing ready to watch right now."}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {readyShows.length > 0 && (
        <section>
          <div className="mb-4">
            <SectionTitle>Shows</SectionTitle>
          </div>
          <div className="wn-grid">
            {readyShows.map((s) => (
              <ShowCard key={s.showId} show={s} watchLink={watchLink} now={now} canEdit={canEdit} />
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
              <MovieCard key={m.movieId} movie={m} watchLink={watchLink} canEdit={canEdit} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShowCard({
  show,
  watchLink,
  now,
  canEdit,
}: {
  show: BehindShow;
  watchLink: WatchLinker;
  now: number;
  canEdit: boolean;
}) {
  // Only offer Play when the NEXT-UP episode is the one you have — the show being on a server isn't enough.
  const watch = show.nextUpReady ? watchLink(show.presence) : null;
  const lastText = show.lastWatchedAt ? `${formatInterval(now - show.lastWatchedAt.getTime())} ago` : "";
  const moreCount = show.unwatchedAiredCount - 1;
  return (
    <PosterCard
      mediaType="tv"
      id={show.showId}
      title={show.title}
      posterPath={show.posterPath}
      detailHref={`/shows/${show.slug ?? show.showId}`}
      watchUrl={watch?.url}
      watchOn={watch?.server}
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
  watchLink,
  canEdit,
}: {
  movie: ReadyMovie;
  watchLink: WatchLinker;
  canEdit: boolean;
}) {
  const watch = watchLink(movie.presence);
  const year = movie.releaseDate ? movie.releaseDate.slice(0, 4) : "";
  return (
    <PosterCard
      mediaType="movie"
      id={movie.movieId}
      title={movie.title}
      posterPath={movie.posterPath}
      detailHref={`/movies/${movie.slug ?? movie.movieId}`}
      watchUrl={watch?.url}
      watchOn={watch?.server}
      rating={movie.imdbRating}
      isFavorite={movie.isFavorite}
      canFavorite={canEdit}
    >
      <CardTitle title={movie.title} aside={year} />
      <CardMetaRow left={movie.director ?? ""} right={formatRuntime(movie.runtime)} />
    </PosterCard>
  );
}
