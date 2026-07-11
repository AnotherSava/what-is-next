"use client";

import { useTransition } from "react";
import { refreshShow } from "@/app/admin/actions";
import { StopTrackingButton } from "@/app/_components/StopTrackingButton";
import { setTracking, toggleFavorite } from "../actions";

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
      {isFavorite ? "♥" : "♡"}
    </button>
  );
}

// Track / untrack toggle — the one stored intent bit. Tracked → an ✕ that confirms before stopping (off-list if
// unstarted, Stopped if already started). Untracked → a button to (re)start tracking: "Resume" for a show you
// dropped, "Track" for a fresh one. `started` (any episode watched) picks between those two. A favorite is a
// deliberate keep and can't be untracked, so the ✕ is hidden while it's favorited (unfavorite first to stop).
export function TrackToggle({
  showId,
  wantToWatch,
  started,
  isFavorite,
}: {
  showId: string;
  wantToWatch: boolean;
  started: boolean;
  isFavorite: boolean;
}) {
  const [pending, start] = useTransition();
  if (wantToWatch) return isFavorite ? null : <StopTrackingButton onConfirm={() => setTracking(showId, false)} />;
  return (
    <button
      type="button"
      disabled={pending}
      title="Add to your list"
      onClick={() => start(() => setTracking(showId, true))}
      className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {started ? "Resume" : "Track"}
    </button>
  );
}
