"use client";

import { useState, useTransition } from "react";
import { markMovieWatched, toggleMovieFavorite, unmarkMovieWatched } from "../actions";

// Owner-only movie controls (brief §8.4). Mark-watched carries an editable date defaulting to today; unmark
// returns the movie to the watchlist. Actions re-verify the owner session server-side.

export function MovieFavoriteStar({ movieId, isFavorite }: { movieId: string; isFavorite: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
      aria-pressed={isFavorite}
      disabled={pending}
      onClick={() => start(() => toggleMovieFavorite(movieId))}
      className={`text-xl leading-none transition-colors disabled:opacity-50 ${
        isFavorite ? "text-[var(--color-behind)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}

export function MarkWatchedControl({ movieId, today }: { movieId: string; today: string }) {
  const [date, setDate] = useState(today);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => markMovieWatched(movieId, date))}
        className="rounded-md bg-[var(--color-accent-strong)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent)] disabled:opacity-50"
      >
        Mark watched
      </button>
    </div>
  );
}

export function UnmarkWatchedButton({ movieId }: { movieId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => unmarkMovieWatched(movieId))}
      className="rounded-md px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      Unmark
    </button>
  );
}
