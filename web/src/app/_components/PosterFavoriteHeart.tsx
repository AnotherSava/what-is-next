"use client";

import { useFavoriteToggle } from "./useFavoriteToggle";

// The favourite heart overlaid on a detail-hero poster, shared by the movie and show pages (single source of logic
// — the two must not drift). Owner → an optimistic ♥/♡ button (the app's amber favourite colour when favourited,
// a light outline otherwise). Non-owner → a read-only filled ♥, shown only when the item is a favourite. The amber
// (not the design mock's red) matches the grid cards' heart, so the affordance reads identically across views.
// `toggle` is the media-specific server action, bound by a thin per-type wrapper (MovieHeroHeart / ShowHeroHeart).
export function PosterFavoriteHeart({
  isFavorite,
  canFavorite,
  toggle,
}: {
  isFavorite: boolean;
  canFavorite: boolean;
  toggle: () => Promise<void>;
}) {
  const { favorited, onToggle, ariaLabel } = useFavoriteToggle(isFavorite, toggle);
  const pos = "absolute top-[11px] right-[11px] z-[4] text-[24px] leading-none";
  const stroke = { WebkitTextStroke: "0.7px rgba(0,0,0,0.35)", textShadow: "0 1px 3px rgba(0,0,0,0.55)" } as const;

  if (!canFavorite) {
    if (!isFavorite) return null;
    return (
      <span className={pos} style={{ color: "var(--color-behind)", ...stroke }} aria-hidden>
        ♥
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={favorited}
      className={`wn-heart ${pos}`}
      style={{ color: favorited ? "var(--color-behind)" : "#e2e2e6", ...stroke }}
      onClick={onToggle}
    >
      {favorited ? "♥" : "♡"}
    </button>
  );
}
