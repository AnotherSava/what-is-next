"use client";

import { useTransition } from "react";
import { refreshShow } from "@/app/admin/actions";
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
      {isFavorite ? "★" : "☆"}
    </button>
  );
}

const TRACKING_OPTIONS = [
  { value: "watching", label: "Watching" },
  { value: "planned", label: "Planned" },
  { value: "stopped", label: "Stopped" },
  { value: "finished", label: "Finished" },
];

export function TrackingSelect({ showId, tracking }: { showId: string; tracking: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={tracking}
      disabled={pending}
      onChange={(e) => start(() => setTracking(showId, e.target.value))}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
    >
      {TRACKING_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
