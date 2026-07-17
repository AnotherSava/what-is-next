import { pluralWord, seconds } from "@/lib/format";

// Structured summary of a Plex sync run: stat segments (number + label, styled separately in the UI) plus the
// wall-clock duration, shown to the right of the "Synced <when>" heading. Single formatter so the card can't drift.
export function plexSyncSummary(s: {
  matchedShows: number;
  matchedMovies: number;
  presenceSeasons: number;
  importedWatches: number;
  unaccounted: number;
  durationMs: number;
}): { stats: { value: number; label: string }[]; duration: string } {
  const stats = [
    { value: s.matchedShows, label: pluralWord(s.matchedShows, "show") },
    { value: s.matchedMovies, label: pluralWord(s.matchedMovies, "movie") },
    { value: s.presenceSeasons, label: `${pluralWord(s.presenceSeasons, "season")} marked` },
    { value: s.importedWatches, label: `${pluralWord(s.importedWatches, "watch", "watches")} imported` },
  ];
  // Unmatched is an exception state — only surface it when there's actually something unmatched to act on.
  if (s.unaccounted > 0) stats.push({ value: s.unaccounted, label: "unmatched" });
  return { stats, duration: seconds(s.durationMs) };
}
