import Link from "next/link";
import { Poster } from "@/app/_components/Poster";
import { MarkWatchedButton } from "@/app/_components/MarkWatchedButton";
import { getDashboard, type BehindShow, type UpcomingEpisode } from "@/lib/dashboard";
import type { MovieSummary } from "@/lib/movies";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { isManualWatchedEnabled } from "@/lib/settings";

// Home / "Watch next" — the payoff screen (brief §8.1). Behind shows with their next-up episode, upcoming
// airings for the next two weeks, and a movie-watchlist snippet. Renders the same for viewer and owner; only
// the one-tap "mark watched" affordance is gated on canEdit.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyInPlex, behind, upcoming, watchlistMovies }, manualWatched] = await Promise.all([
    getDashboard(displayedUser.id),
    isManualWatchedEnabled(),
  ]);
  const canMarkWatched = canEdit && manualWatched; // watched controls are hidden unless the owner enabled them
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
              <BehindRow key={s.showId} show={s} canMarkWatched={canMarkWatched} />
            ))}
          </ul>
        </Section>
      )}

      {behind.length > 0 && (
        <Section title="Behind" count={behind.length}>
          <ul className="space-y-2">
            {behind.map((s) => (
              <BehindRow key={s.showId} show={s} canMarkWatched={canMarkWatched} />
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

function code(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

function BehindRow({ show, canMarkWatched }: { show: BehindShow; canMarkWatched: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <Link href={`/shows/${show.showId}`} className="shrink-0">
        <Poster path={show.posterPath} alt={show.title} width={48} height={72} size="w185" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/shows/${show.showId}`} className="block truncate font-medium hover:underline">
          {show.title}
        </Link>
        <p className="truncate text-xs text-[var(--color-muted)]">
          <span className="font-mono text-[var(--color-behind)]">
            {code(show.nextUp.seasonNumber, show.nextUp.episodeNumber)}
          </span>{" "}
          {show.nextUp.title ?? ""}
          {show.unwatchedAiredCount > 1 ? ` · +${show.unwatchedAiredCount - 1} more` : ""}
        </p>
      </div>
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
        <span className="font-mono text-xs text-[var(--color-muted)]">{code(ep.seasonNumber, ep.episodeNumber)}</span>
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
