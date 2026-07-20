import { useOptimistic, useTransition } from "react";

// The optimistic favourite-toggle shared by both hearts — the grid card's (PosterCard) and the movie-detail hero's
// (MovieHeroHeart). Owns the optimistic state, the transition, and the aria wording so those can't drift between the
// two; each heart renders its own markup (size, position, hover-fade) and wires onToggle into its own onClick.
export function useFavoriteToggle(isFavorite: boolean, toggle: () => Promise<void>) {
  const [favorited, setFavorited] = useOptimistic(isFavorite);
  const [, start] = useTransition();
  const onToggle = () =>
    start(async () => {
      setFavorited(!favorited);
      await toggle();
    });
  return { favorited, onToggle, ariaLabel: favorited ? "Remove from favourites" : "Add to favourites" };
}
