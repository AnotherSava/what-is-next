import type { Metadata } from "next";
import Link from "next/link";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { displayDate, todayISO } from "@/lib/datetime";
import { getMovies, type MovieSummary } from "@/lib/movies";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";
import { MarkWatchedControl, MovieFavoriteStar, UnmarkWatchedButton } from "./_components/MovieControls";

export const metadata: Metadata = { title: "Movies" };

type Tab = "watched" | "watchlist";

function yearOf(releaseDate: string | null): string {
  return releaseDate ? releaseDate.slice(0, 4) : "";
}

function watchedDate(d: Date | null): string {
  return d ? displayDate(d) : "date unknown";
}

export default async function MoviesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active: Tab = tab === "watchlist" ? "watchlist" : "watched";
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ watched, watchlist }, manualWatched, plexServerId] = await Promise.all([
    getMovies(displayedUser.id),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  const canMarkWatched = canEdit && manualWatched; // manual mark/unmark hidden unless the owner enabled it
  const today = todayISO();
  const list = active === "watched" ? watched : watchlist;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>

      <div className="flex gap-1 rounded-lg bg-[var(--color-surface)] p-1 text-sm">
        <TabLink tab="watched" active={active} count={watched.length} label="Watched" />
        <TabLink tab="watchlist" active={active} count={watchlist.length} label="Watchlist" />
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {active === "watched" ? "No watched movies yet." : "Watchlist is empty."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((m) => (
            <MovieCard
              key={m.id}
              movie={m}
              tab={active}
              canEdit={canEdit}
              canMarkWatched={canMarkWatched}
              today={today}
              plexServerId={plexServerId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabLink({ tab, active, count, label }: { tab: Tab; active: Tab; count: number; label: string }) {
  const isActive = tab === active;
  return (
    <Link
      href={`/movies?tab=${tab}`}
      className={`flex-1 rounded-md px-3 py-1.5 text-center ${
        isActive
          ? "bg-[var(--color-surface-2)] font-medium"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {label} <span className="text-[var(--color-muted)]">{count}</span>
    </Link>
  );
}

function MovieCard({
  movie,
  tab,
  canEdit,
  canMarkWatched,
  today,
  plexServerId,
}: {
  movie: MovieSummary;
  tab: Tab;
  canEdit: boolean;
  canMarkWatched: boolean;
  today: string;
  plexServerId: string | null;
}) {
  const year = yearOf(movie.releaseDate);
  const watchUrl = plexWatchUrl(plexServerId, movie.plexRatingKey);
  return (
    <li className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <PosterPlay path={movie.posterPath} alt={movie.title} width={64} height={96} size="w185" watchUrl={watchUrl} />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {movie.title} {year && <span className="text-[var(--color-muted)]">({year})</span>}
          </p>
          {tab === "watched" && (
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">Watched {watchedDate(movie.watchedAt)}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canMarkWatched &&
              (tab === "watched" ? (
                <UnmarkWatchedButton movieId={movie.id} />
              ) : (
                <MarkWatchedControl movieId={movie.id} today={today} />
              ))}
          </div>
          {canEdit ? (
            <MovieFavoriteStar movieId={movie.id} isFavorite={movie.isFavorite} />
          ) : movie.isFavorite ? (
            <span className="text-xl leading-none text-[var(--color-behind)]">★</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
