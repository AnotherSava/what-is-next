"use client";

import { useTransition } from "react";
import { refreshShow } from "@/app/admin/actions";
import { setWantToWatch, toggleFavorite } from "../actions";

export function RefreshShowButton({ showId }: { showId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => refreshShow(showId))}
      title="Re-fetch this show's metadata and episodes from TMDB"
      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}

// Owner-only controls for a show (brief §8.3). Rendered only when canEdit; the actions themselves re-verify
// the owner session server-side. useTransition keeps the button responsive while the Server Action + revalidate
// round-trips.

export function FavoriteStar({ showId, isFavorite }: { showId: string; isFavorite: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
      aria-pressed={isFavorite}
      disabled={pending}
      onClick={() => start(() => toggleFavorite(showId))}
      className={`text-xl leading-none transition-colors disabled:opacity-50 ${
        isFavorite ? "text-[var(--color-behind)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}

// "On my list" toggle — the one stored intent bit. Off + nothing watched hides the show; off + already watched
// marks it Stopped; on surfaces it as Planned / Behind / Up to date (all derived). `started` (any episode watched)
// only tunes the labels.
export function WantToWatchToggle({
  showId,
  wantToWatch,
  started,
}: {
  showId: string;
  wantToWatch: boolean;
  started: boolean;
}) {
  const [pending, start] = useTransition();
  const title = wantToWatch
    ? started
      ? "Remove from your list (marks it Stopped)"
      : "Remove from your list"
    : "Add to your list";
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={wantToWatch}
      title={title}
      onClick={() => start(() => setWantToWatch(showId, !wantToWatch))}
      className={`rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
        wantToWatch
          ? "border-transparent bg-[var(--color-accent-strong)] text-white hover:bg-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      }`}
    >
      {wantToWatch ? "✓ On my list" : started ? "Resume" : "Add to list"}
    </button>
  );
}
