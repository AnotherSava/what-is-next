"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFavoriteToggle } from "@/app/_components/useFavoriteToggle";
import { markMovieWatched, toggleMovieFavorite, unmarkMovieWatched, untrackMovie } from "../actions";

// Interactive controls for the movie detail hero (design: "Movies Page - Plex States", revised). Two client
// islands the server page composes onto the mostly-static hero: the poster favourite heart, and the ⋯ actions menu
// (mark watched / unwatched, remove from tracking) that floats at the hero's top-right. Play / download live on the
// poster itself (server-rendered hover overlays — see MovieHeroPoster). Owner-gated actions re-verify server-side.

// The poster's favourite heart. Owner → an optimistic toggle (filled ♥ when favourited, else a light ♡). Non-owner
// → a read-only filled heart, shown only when the movie is a favourite. Uses the app's amber favourite colour so it
// reads identically to the grid cards' heart (the design mock's red is not carried over, for cross-view consistency).
export function MovieHeroHeart({
  movieId,
  isFavorite,
  canFavorite,
}: {
  movieId: string;
  isFavorite: boolean;
  canFavorite: boolean;
}) {
  const { favorited, onToggle, ariaLabel } = useFavoriteToggle(isFavorite, () => toggleMovieFavorite(movieId));
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

// The ⋯ actions menu (owner). The page renders it only when it has at least one item (see showMenu there): watched
// offers "Mark unwatched"; unwatched offers "Mark watched" (when manual-watched is enabled) and/or "Remove from
// tracking" (when the movie is tracked — untracking a never-added movie would be a no-op, so it's hidden). It's a
// disclosure of plain buttons (Tab-navigable), closable with Escape — not an ARIA menu widget, so it deliberately
// omits role="menu"/menuitem and the arrow-key roving those imply.
export function MovieHeroMenu({
  movieId,
  watched,
  tracked,
  canMarkWatched,
  today,
}: {
  movieId: string;
  watched: boolean;
  tracked: boolean;
  canMarkWatched: boolean;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = () => setOpen(false);
  // An action unmounts the focused item; close and return focus to the trigger so keyboard users keep their place.
  const run = (action: () => Promise<void>) => {
    close();
    btnRef.current?.focus();
    start(() => action());
  };

  // Escape closes the menu and restores focus to its trigger (mouse users get the outside-click overlay below).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative" style={{ opacity: pending ? 0.6 : 1 }}>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-white/[0.03] text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-white/[0.06] hover:text-[var(--color-text)]"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        <DotsIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden />
          <div className="wn-menu absolute top-full right-0 z-30 mt-2">
            {watched ? (
              <button type="button" className="wn-menu-item" onClick={() => run(() => unmarkMovieWatched(movieId))}>
                Mark unwatched
              </button>
            ) : (
              <>
                {canMarkWatched && (
                  <button type="button" className="wn-menu-item" onClick={() => run(() => markMovieWatched(movieId, today))}>
                    Mark watched
                  </button>
                )}
                {canMarkWatched && tracked && <div className="wn-menu-sep" />}
                {tracked && (
                  <button type="button" className="wn-menu-item wn-menu-item-danger" onClick={() => run(() => untrackMovie(movieId))}>
                    Remove from tracking
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}
