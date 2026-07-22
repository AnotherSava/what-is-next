"use client";

import { HeroKebabMenu, type KebabItem } from "@/app/_components/HeroKebabMenu";
import { PosterFavoriteHeart } from "@/app/_components/PosterFavoriteHeart";
import { markMovieWatched, toggleMovieFavorite, unmarkMovieWatched, untrackMovie } from "../actions";

// Interactive controls for the movie detail hero (design: "Movies Page - Plex States", revised). Two client
// islands the server page composes onto the mostly-static hero: the poster favourite heart, and the ⋯ actions menu
// (mark watched / unwatched, remove from tracking) that floats at the hero's top-right. Play / download live on the
// poster itself (server-rendered hover overlays — see MovieHeroPoster). Owner-gated actions re-verify server-side.

// The movie poster's favourite heart — binds the movie favourite action into the shared PosterFavoriteHeart (which
// owns the markup, colour, and optimistic toggle so the movie and show hearts can't drift).
export function MovieHeroHeart({
  movieId,
  isFavorite,
  canFavorite,
}: {
  movieId: string;
  isFavorite: boolean;
  canFavorite: boolean;
}) {
  return <PosterFavoriteHeart isFavorite={isFavorite} canFavorite={canFavorite} toggle={() => toggleMovieFavorite(movieId)} />;
}

// The ⋯ actions menu (owner). The page renders it only when it has at least one item (see showMenu there): watched
// offers "Mark unwatched"; unwatched offers "Mark watched" (when manual-watched is enabled) and/or "Remove from
// tracking" (when the movie is tracked — untracking a never-added movie would be a no-op, so it's hidden). The
// disclosure mechanics live in the shared HeroKebabMenu; this only supplies the items.
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
  const items: KebabItem[] = watched
    ? [{ label: "Mark unwatched", action: () => unmarkMovieWatched(movieId) }]
    : [
        ...(canMarkWatched ? [{ label: "Mark watched", action: () => markMovieWatched(movieId, today) }] : []),
        ...(tracked
          ? [{ label: "Remove from tracking", danger: true, separatorBefore: canMarkWatched, action: () => untrackMovie(movieId) }]
          : []),
      ];
  return <HeroKebabMenu items={items} />;
}
