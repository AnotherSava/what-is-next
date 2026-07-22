"use client";

import { PosterFavoriteHeart } from "@/app/_components/PosterFavoriteHeart";
import { toggleFavorite } from "../actions";

// The show poster's favourite heart — binds the show favourite action into the shared PosterFavoriteHeart (which
// owns the markup, colour, and optimistic toggle so the movie and show hearts can't drift).
export function ShowHeroHeart({
  showId,
  isFavorite,
  canFavorite,
}: {
  showId: string;
  isFavorite: boolean;
  canFavorite: boolean;
}) {
  return <PosterFavoriteHeart isFavorite={isFavorite} canFavorite={canFavorite} toggle={() => toggleFavorite(showId)} />;
}
