// Poster-grid density shared constants — imported by both the server layout (to read the persisted cookie and seed
// the initial column count) and the client GridDensity provider/slider. Kept framework-free so it's safe on both
// sides of the server/client boundary.

export const MIN_COLS = 3;
export const MAX_COLS = 8;
export const DEFAULT_COLS = 5;
export const COLS_COOKIE = "wn-cols";

export function clampCols(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_COLS;
  return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(n)));
}
