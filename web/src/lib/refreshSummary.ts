import { pluralWord, seconds } from "@/lib/format";

// Structured summary of a metadata refresh run: stat segments (number + label, styled separately in the UI) plus
// the wall-clock duration, which the card shows to the right of the "Refreshed <when>" heading. Lives apart from
// refresh.ts (which pulls in Prisma/TMDB) so the client and the card can import it freely.
export function refreshSummary(r: {
  tvRefreshed: number;
  moviesRefreshed: number;
  tvdbResolved: number;
  durationMs: number;
}): { stats: { value: number; label: string }[]; duration: string } {
  return {
    stats: [
      { value: r.tvRefreshed, label: pluralWord(r.tvRefreshed, "show") },
      { value: r.moviesRefreshed, label: pluralWord(r.moviesRefreshed, "movie") },
      { value: r.tvdbResolved, label: "via TVDB" },
    ],
    duration: seconds(r.durationMs),
  };
}
