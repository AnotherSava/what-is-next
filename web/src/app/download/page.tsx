import type { Metadata } from "next";
import Link from "next/link";
import { EmptyColumn } from "@/app/_components/EmptyColumn";
import { MovieDirectorLine, MovieRatingLine, MovieTitleLink } from "@/app/_components/MovieText";
import { Poster } from "@/app/_components/Poster";
import { Section } from "@/app/_components/Section";
import { displayDate, nowMs } from "@/lib/datetime";
import { getDownloads, type DownloadMovie, type DownloadShow } from "@/lib/download";
import { downloadLinksFor, type DownloadLink, type DownloadSource } from "@/lib/downloadSources";
import { formatInterval, formatSeasonRange } from "@/lib/format";
import { isPlexConfigured } from "@/lib/plex";
import { getDisplayedUser } from "@/lib/session";
import { getDownloadSources, getMovieRatingsVisibility } from "@/lib/settings";

export const metadata: Metadata = { title: "Download" };

// "Download" — what you're tracking but don't have in Plex yet, in two columns: Movies (watchlist titles not in
// your library) on the left, Shows on the right. Shows keep their three sections: "Get back" (started, but you've
// watched everything you have), "More of" (started, still have unwatched episodes in Plex), and "Not started".
// Presence is per-episode, so a show you already partly own still appears when a newer aired episode isn't
// downloaded. Renders for the displayed user; it's a read-only view (nothing here is in Plex to play or mark).
export default async function DownloadPage() {
  const displayedUser = await getDisplayedUser();
  const [{ movies, getBack, moreOf, notStarted }, sources, ratingsVisibility] = await Promise.all([
    getDownloads(displayedUser.id),
    getDownloadSources(),
    getMovieRatingsVisibility(),
  ]);
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const showsEmpty = getBack.length === 0 && moreOf.length === 0 && notStarted.length === 0;
  const empty = movies.length === 0 && showsEmpty;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Download</h1>

      {empty ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {isPlexConfigured()
            ? "Nothing to download — everything you're tracking is already in your Plex library."
            : "Connect Plex to see which movies and episodes aren't in your library yet."}
        </div>
      ) : (
        // Movies left, Shows right; stacks with Movies first on narrow screens.
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2">
          <Section title="Movies" count={movies.length}>
            {movies.length > 0 ? (
              <ul className="space-y-2">
                {movies.map((m) => (
                  <MovieRow
                    key={m.movieId}
                    movie={m}
                    sources={sources}
                    showTmdb={ratingsVisibility.tmdb}
                    showImdb={ratingsVisibility.imdb}
                  />
                ))}
              </ul>
            ) : (
              <EmptyColumn>Every tracked movie is already in your Plex library.</EmptyColumn>
            )}
          </Section>

          {/* Shows column keeps its existing three sections. */}
          <div className="space-y-8">
            {showsEmpty ? (
              <Section title="Shows" count={0}>
                <EmptyColumn>Every aired episode you&apos;re tracking is already in your Plex library.</EmptyColumn>
              </Section>
            ) : (
              <>
                {getBack.length > 0 && (
                  <Section title="Get back" count={getBack.length}>
                    <ul className="space-y-2">
                      {getBack.map((s) => (
                        <DownloadRow
                          key={s.showId}
                          show={s}
                          now={now}
                          sources={sources}
                          showAge
                          seasons={s.missingSeasons}
                          showTmdb={ratingsVisibility.tmdb}
                          showImdb={ratingsVisibility.imdb}
                        />
                      ))}
                    </ul>
                  </Section>
                )}

                {moreOf.length > 0 && (
                  <Section title="More of" count={moreOf.length}>
                    <ul className="space-y-2">
                      {moreOf.map((s) => (
                        <DownloadRow
                          key={s.showId}
                          show={s}
                          now={now}
                          sources={sources}
                          showAge
                          seasons={s.missingSeasons}
                          showTmdb={ratingsVisibility.tmdb}
                          showImdb={ratingsVisibility.imdb}
                        />
                      ))}
                    </ul>
                  </Section>
                )}

                {notStarted.length > 0 && (
                  <Section title="Not started" count={notStarted.length}>
                    <ul className="space-y-2">
                      {notStarted.map((s) => (
                        <DownloadRow
                          key={s.showId}
                          show={s}
                          now={now}
                          sources={sources}
                          showTmdb={ratingsVisibility.tmdb}
                          showImdb={ratingsVisibility.imdb}
                        />
                      ))}
                    </ul>
                  </Section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MovieRow({
  movie,
  sources,
  showTmdb,
  showImdb,
}: {
  movie: DownloadMovie;
  sources: DownloadSource[];
  showTmdb: boolean;
  showImdb: boolean;
}) {
  // No play button — the movie isn't in Plex; the poster links to the movie page instead (mirrors DownloadRow).
  const links = downloadLinksFor(sources, "movies", movie.title);
  return (
    <li className="flex items-stretch gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <Link href={`/movies/${movie.movieId}`} className="shrink-0 leading-none" aria-label={movie.title}>
        <Poster path={movie.posterPath} alt={movie.title} width={48} height={72} size="w185" />
      </Link>
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
      <SourceLinks links={links} />
    </li>
  );
}

// The download-source chips shown in a card's top-right corner (movies and shows alike, so they can't drift).
// Each opens the source's search in a new tab. Renders nothing when there are no configured sources for this card.
function SourceLinks({ links }: { links: DownloadLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 self-start">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function DownloadRow({
  show,
  now,
  sources,
  showAge = false,
  seasons,
  showTmdb,
  showImdb,
}: {
  show: DownloadShow;
  now: number;
  sources: DownloadSource[];
  showAge?: boolean;
  seasons?: number[]; // the seasons-to-download range (Get back / More of); absent for not-started shows (title only)
  showTmdb: boolean;
  showImdb: boolean;
}) {
  const age = showAge && show.lastWatchedAt;
  const links = downloadLinksFor(sources, "shows", show.title);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      {/* No play button — the episode isn't in Plex; the poster links to the show instead. */}
      <Link href={`/shows/${show.showId}`} className="shrink-0 leading-none" aria-label={show.title}>
        <Poster path={show.posterPath} alt={show.title} width={48} height={72} size="w185" />
      </Link>
      {/* Title + season/episode pinned to the top, ratings to the bottom (matches the movie card). */}
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
        <div className="min-w-0">
          <Link href={`/shows/${show.showId}`} className="block truncate font-medium hover:underline">
            {show.title}
          </Link>
          {seasons && seasons.length > 0 && (
            <p className="truncate text-sm text-[var(--color-accent)]">{formatSeasonRange(seasons)}</p>
          )}
        </div>
        <MovieRatingLine
          tmdbRating={show.tmdbRating}
          imdbRating={show.imdbRating}
          showTmdb={showTmdb}
          showImdb={showImdb}
        />
      </div>
      <SourceLinks links={links} />
      {(show.isFavorite || age || show.missingCount > 1) && (
        // Spread down the card height: favorite ♥ on top, last-watched in the middle, "+N more" on the bottom.
        <div className="flex shrink-0 flex-col items-end justify-between self-stretch text-xs text-[var(--color-muted)]">
          <span className="text-xl leading-none text-[var(--color-behind)]">{show.isFavorite ? "♥" : ""}</span>
          <span>
            {age && (
              <span title={`Last watched ${displayDate(show.lastWatchedAt!)}`}>
                {formatInterval(now - show.lastWatchedAt!.getTime())} ago
              </span>
            )}
          </span>
          <span className="opacity-60">{show.missingCount > 1 ? `+${show.missingCount - 1} more` : ""}</span>
        </div>
      )}
    </li>
  );
}
