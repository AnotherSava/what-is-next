import Link from "next/link";
import { EmptyColumn } from "@/app/_components/EmptyColumn";
import { MovieDirectorLine, MovieRatingLine, MovieTitleLink } from "@/app/_components/MovieText";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { MarkWatchedButton } from "@/app/_components/MarkWatchedButton";
import { Section } from "@/app/_components/Section";
import { getDashboard, type BehindShow, type ReadyMovie } from "@/lib/dashboard";
import { displayDate, nowMs } from "@/lib/datetime";
import { formatInterval } from "@/lib/format";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getMovieRatingsVisibility, getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";

// Home / "Watch next" — the payoff screen (brief §8.1). Two columns of what's playable right now from Plex:
// Movies (unwatched watchlist titles in your library) on the left, Shows (behind shows whose next-up episode is
// in your library) on the right. (Behind shows whose next episode isn't in Plex live in the Download view.)
// Renders the same for viewer and owner; only the shows' one-tap "mark watched" affordance is gated on canEdit.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyMovies, readyInPlex }, manualWatched, plexServerId, ratingsVisibility] = await Promise.all([
    getDashboard(displayedUser.id),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
    getMovieRatingsVisibility(),
  ]);
  const canMarkWatched = canEdit && manualWatched; // watched controls are hidden unless the owner enabled them
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty = readyMovies.length === 0 && readyInPlex.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Watch next</h1>

      {empty ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {canEdit
            ? "Nothing ready to watch in Plex right now — check Download for episodes to grab."
            : "Nothing ready to watch in Plex right now."}
        </div>
      ) : (
        // Movies left, Shows right; stacks with Movies first on narrow screens.
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2">
          <Section title="Movies" count={readyMovies.length}>
            {readyMovies.length > 0 ? (
              <ul className="space-y-2">
                {readyMovies.map((m) => (
                  <MovieRow
                    key={m.movieId}
                    movie={m}
                    plexServerId={plexServerId}
                    showTmdb={ratingsVisibility.tmdb}
                    showImdb={ratingsVisibility.imdb}
                  />
                ))}
              </ul>
            ) : (
              <EmptyColumn>No movies ready in Plex right now.</EmptyColumn>
            )}
          </Section>

          <Section title="Shows" count={readyInPlex.length}>
            {readyInPlex.length > 0 ? (
              <ul className="space-y-2">
                {readyInPlex.map((s) => (
                  <BehindRow
                    key={s.showId}
                    show={s}
                    canMarkWatched={canMarkWatched}
                    plexServerId={plexServerId}
                    now={now}
                    showTmdb={ratingsVisibility.tmdb}
                    showImdb={ratingsVisibility.imdb}
                  />
                ))}
              </ul>
            ) : (
              <EmptyColumn>No shows ready in Plex right now.</EmptyColumn>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function MovieRow({
  movie,
  plexServerId,
  showTmdb,
  showImdb,
}: {
  movie: ReadyMovie;
  plexServerId: string | null;
  showTmdb: boolean;
  showImdb: boolean;
}) {
  const watchUrl = plexWatchUrl(plexServerId, movie.plexRatingKey);
  return (
    <li className="flex items-stretch gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <PosterPlay path={movie.posterPath} alt={movie.title} width={48} height={72} size="w185" watchUrl={watchUrl} />
      {/* Title + director pinned to the top, ratings to the bottom (matches the /movies card). */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <MovieTitleLink movieId={movie.movieId} title={movie.title} releaseDate={movie.releaseDate} />
          <MovieDirectorLine director={movie.director} />
        </div>
        <MovieRatingLine
          tmdbRating={movie.tmdbRating}
          imdbRating={movie.imdbRating}
          showTmdb={showTmdb}
          showImdb={showImdb}
        />
      </div>
    </li>
  );
}

function episodeLabel(seasonNumber: number, episodeNumber: number): string {
  return `S${seasonNumber} · E${episodeNumber}`;
}

function BehindRow({
  show,
  canMarkWatched,
  plexServerId,
  now,
  showTmdb,
  showImdb,
}: {
  show: BehindShow;
  canMarkWatched: boolean;
  plexServerId: string | null;
  now: number;
  showTmdb: boolean;
  showImdb: boolean;
}) {
  // Play button only when the NEXT-UP episode is in Plex (i.e. the "Watch right now" rows) — a behind show whose
  // show is in Plex but whose next episode isn't shouldn't offer a "watch now" affordance.
  const watchUrl = show.nextUpInPlex ? plexWatchUrl(plexServerId, show.plexRatingKey) : null;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <PosterPlay path={show.posterPath} alt={show.title} width={48} height={72} size="w185" watchUrl={watchUrl} />
      {/* Title + next-up pinned to the top, ratings to the bottom (matches the movie card). */}
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
        <div className="min-w-0">
          <Link href={`/shows/${show.showId}`} className="block truncate font-medium hover:underline">
            {show.title}
          </Link>
          <p className="truncate text-sm text-[var(--color-behind)]">
            {episodeLabel(show.nextUp.seasonNumber, show.nextUp.episodeNumber)}
            {show.nextUp.title && <span className="ml-2 text-[var(--color-muted)]">{show.nextUp.title}</span>}
          </p>
        </div>
        <MovieRatingLine
          tmdbRating={show.tmdbRating}
          imdbRating={show.imdbRating}
          showTmdb={showTmdb}
          showImdb={showImdb}
        />
      </div>
      {(show.isFavorite || show.lastWatchedAt || show.unwatchedAiredCount > 1) && (
        // Spread down the card height: favorite ♥ on top, last-watched in the middle, "+N more" on the bottom.
        <div className="flex shrink-0 flex-col items-end justify-between self-stretch text-xs text-[var(--color-muted)]">
          {/* Read-only badge only — favoriting happens on the show page, so the empty ♡ never shows in lists. */}
          <span className="text-xl leading-none text-[var(--color-behind)]">{show.isFavorite ? "♥" : ""}</span>
          <span>
            {show.lastWatchedAt && (
              <span title={`Last watched ${displayDate(show.lastWatchedAt)}`}>
                {formatInterval(now - show.lastWatchedAt.getTime())} ago
              </span>
            )}
          </span>
          <span className="opacity-60">
            {show.unwatchedAiredCount > 1 ? `+${show.unwatchedAiredCount - 1} more` : ""}
          </span>
        </div>
      )}
      {canMarkWatched && <MarkWatchedButton episodeId={show.nextUp.episodeId} label="Watched" />}
    </li>
  );
}
