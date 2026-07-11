import Link from "next/link";
import { Poster } from "@/app/_components/Poster";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { MarkWatchedButton } from "@/app/_components/MarkWatchedButton";
import { getDashboard, type BehindShow, type UpcomingEpisode } from "@/lib/dashboard";
import { displayDate, nowMs } from "@/lib/datetime";
import { formatInterval } from "@/lib/format";
import type { MovieSummary } from "@/lib/movies";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";

// Home / "Watch next" — the payoff screen (brief §8.1). Behind shows with their next-up episode, upcoming
// airings for the next two weeks, and a movie-watchlist snippet. Renders the same for viewer and owner; only
// the one-tap "mark watched" affordance is gated on canEdit.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyInPlex, behind, upcoming, watchlistMovies }, manualWatched, plexServerId] = await Promise.all([
    getDashboard(displayedUser.id),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  const canMarkWatched = canEdit && manualWatched; // watched controls are hidden unless the owner enabled them
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty =
    readyInPlex.length === 0 && behind.length === 0 && upcoming.length === 0 && watchlistMovies.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Watch next</h1>

      {empty && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {canEdit
            ? "You're all caught up. Add a title from Search to track something new."
            : "Nothing to watch right now — all caught up."}
        </div>
      )}

      {readyInPlex.length > 0 && (
        <Section title="Watch right now" count={readyInPlex.length}>
          <ul className="space-y-2">
            {readyInPlex.map((s) => (
              <BehindRow
                key={s.showId}
                show={s}
                canMarkWatched={canMarkWatched}
                plexServerId={plexServerId}
                now={now}
              />
            ))}
          </ul>
        </Section>
      )}

      {behind.length > 0 && (
        <Section title="Behind" count={behind.length}>
          <ul className="space-y-2">
            {behind.map((s) => (
              <BehindRow
                key={s.showId}
                show={s}
                canMarkWatched={canMarkWatched}
                plexServerId={plexServerId}
                now={now}
              />
            ))}
          </ul>
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Airing in the next 2 weeks" count={upcoming.length}>
          <ul className="space-y-1.5">
            {upcoming.map((e) => (
              <UpcomingRow key={e.episodeId} ep={e} />
            ))}
          </ul>
        </Section>
      )}

      {watchlistMovies.length > 0 && (
        <Section title="Movie watchlist" count={watchlistMovies.length}>
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {watchlistMovies.map((m) => (
              <MovieChip key={m.id} movie={m} />
            ))}
          </ul>
          <Link href="/movies?tab=watchlist" className="text-xs text-[var(--color-accent)] hover:underline">
            See all →
          </Link>
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function episodeLabel(seasonNumber: number, episodeNumber: number): string {
  return `Season ${seasonNumber}, Episode ${episodeNumber}`;
}

function BehindRow({
  show,
  canMarkWatched,
  plexServerId,
  now,
}: {
  show: BehindShow;
  canMarkWatched: boolean;
  plexServerId: string | null;
  now: number;
}) {
  const watchUrl = plexWatchUrl(plexServerId, show.plexRatingKey);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <PosterPlay path={show.posterPath} alt={show.title} width={48} height={72} size="w185" watchUrl={watchUrl} />
      <div className="min-w-0 flex-1">
        <Link href={`/shows/${show.showId}`} className="block truncate text-lg font-medium hover:underline">
          {show.title}
        </Link>
        <p className="truncate text-sm text-[var(--color-behind)]">
          {episodeLabel(show.nextUp.seasonNumber, show.nextUp.episodeNumber)}
        </p>
        <p className="min-h-5 truncate text-sm text-[var(--color-muted)]">{show.nextUp.title}</p>
      </div>
      {(show.lastWatchedAt || show.unwatchedAiredCount > 1) && (
        // Mirror the left column's 3 lines: last-watched on top, "+N more" on the bottom, empty middle.
        <div className="flex shrink-0 flex-col items-end justify-between self-stretch text-xs text-[var(--color-muted)]">
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

function UpcomingRow({ ep }: { ep: UpcomingEpisode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
      <span className="w-24 shrink-0 text-xs text-[var(--color-accent)]">{ep.releaseDate}</span>
      <Link href={`/shows/${ep.showId}`} className="truncate hover:underline">
        <span className="font-medium">{ep.showTitle}</span>{" "}
        <span className="text-xs text-[var(--color-muted)]">{episodeLabel(ep.seasonNumber, ep.episodeNumber)}</span>
      </Link>
    </li>
  );
}

function MovieChip({ movie }: { movie: MovieSummary }) {
  return (
    <li className="w-20 shrink-0">
      <Poster path={movie.posterPath} alt={movie.title} width={80} height={120} size="w185" />
      <p className="mt-1 truncate text-[11px] text-[var(--color-muted)]">{movie.title}</p>
    </li>
  );
}
