// Derived watch-state — the single source of the behind / up-to-date / finished rules and the "next up"
// episode (brief §5, §5a rule 3). PURE: every function takes episodes + seen events + a status + today's date
// and returns a result. It never fetches, never knows about sessions or the DB. This is the most heavily
// unit-tested module in the app; the UI and dashboard read from here, never re-implement the rules.

export interface ProgressEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  isSpecial: boolean; // season 0 / flagged special — excluded from all counts by default (brief §5)
  releaseDate: string | null; // ISO date; "has it aired" is DERIVED (releaseDate <= today), never stored
}

// A seen event contributes a watched episode when episodeId is set (movie watches have episodeId null).
export interface ProgressSeenEvent {
  episodeId: string | null;
}

export type DerivedStatus = "behind" | "up-to-date" | "finished";

// How a followed show is grouped for display. Derived entirely from the watch log + one stored intent bit
// (wantToWatch). "off-list" = not wanted and nothing watched — the default no-opinion state; it is never shown.
export type DisplayGroup = "behind" | "up-to-date" | "finished" | "planned" | "stopped" | "off-list";

// The display buckets actually shown on /shows — everything except the hidden "off-list" default.
export type VisibleGroup = Exclude<DisplayGroup, "off-list">;

export interface ShowProgress {
  status: DerivedStatus;
  totalCounted: number; // non-special episodes, aired or not
  airedCount: number; // non-special episodes that have aired
  watchedAiredCount: number; // non-special aired episodes that are watched
  unwatchedAiredCount: number; // the "behind by N" number
  nextUp: ProgressEpisode | null; // lowest (season, episode) aired-unwatched non-special episode
}

// TMDB statuses that mean "more is (or may be) coming". Ended/Canceled are the only definitively-done states;
// anything else (including null/unknown) is treated as still-open so a caught-up show reads "up to date",
// not prematurely "finished".
const ENDED_STATUSES = new Set(["Ended", "Canceled", "Cancelled"]);

export function isEndedStatus(status: string | null | undefined): boolean {
  return status != null && ENDED_STATUSES.has(status);
}

// An episode has aired iff it has a release date on or before today. A null release date is treated as
// not-yet-aired (an announced-but-undated episode isn't something you can be "behind" on).
export function hasAired(releaseDate: string | null | undefined, todayISO: string): boolean {
  if (!releaseDate) return false;
  return releaseDate.slice(0, 10) <= todayISO;
}

export function watchedEpisodeIds(seenEvents: ProgressSeenEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of seenEvents) if (e.episodeId) ids.add(e.episodeId);
  return ids;
}

// Order episodes by (seasonNumber, episodeNumber). Stable, total ordering for "next up" and checklist display.
export function compareEpisodes(a: ProgressEpisode, b: ProgressEpisode): number {
  return a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber;
}

export interface ComputeShowProgressInput {
  episodes: ProgressEpisode[];
  seenEvents: ProgressSeenEvent[];
  airingStatus: string | null;
  todayISO: string; // "YYYY-MM-DD" — caller computes it in the display timezone
}

export function computeShowProgress(input: ComputeShowProgressInput): ShowProgress {
  const { episodes, seenEvents, airingStatus, todayISO } = input;
  const watched = watchedEpisodeIds(seenEvents);
  const counted = episodes.filter((e) => !e.isSpecial);

  let airedCount = 0;
  let watchedAiredCount = 0;
  const airedUnwatched: ProgressEpisode[] = [];
  for (const ep of counted) {
    if (!hasAired(ep.releaseDate, todayISO)) continue;
    airedCount++;
    if (watched.has(ep.id)) watchedAiredCount++;
    else airedUnwatched.push(ep);
  }

  const unwatchedAiredCount = airedUnwatched.length;
  const status: DerivedStatus =
    unwatchedAiredCount > 0 ? "behind" : isEndedStatus(airingStatus) ? "finished" : "up-to-date";
  const nextUp =
    airedUnwatched.length > 0 ? airedUnwatched.reduce((a, b) => (compareEpisodes(a, b) <= 0 ? a : b)) : null;

  return {
    status,
    totalCounted: counted.length,
    airedCount,
    watchedAiredCount,
    unwatchedAiredCount,
    nextUp,
  };
}

// Combine the single stored intent bit (wantToWatch) with derived progress into the display bucket. Progress is
// the source of truth (watch log + airing status); the flag only splits want-vs-stopped. Deviation from brief §5
// (which stored a 4-value tracking enum): the enum conflated intent with progress and could drift from the log
// (a "planned" show you'd started stayed hidden) — collapsed to one flag + derivation so drift is impossible.
//
//   nothing watched → Planned if wanted, else off-list (the default; not shown)
//   finished (all aired watched + show ended) → Finished, regardless of the flag (completion is terminal)
//   started, wanted     → derived (Behind / Up to date)
//   started, not wanted → Stopped
//
// The nothing-watched gate comes FIRST: computeShowProgress reports "finished" vacuously for a show with no aired
// episodes + an Ended/Canceled status (e.g. cancelled before airing), but you haven't finished what you never
// started — such a show is Planned/off-list, not Finished.
export function displayGroup(wantToWatch: boolean, progress: ShowProgress): DisplayGroup {
  if (progress.watchedAiredCount === 0) return wantToWatch ? "planned" : "off-list";
  if (progress.status === "finished") return "finished";
  if (!wantToWatch) return "stopped";
  return progress.status; // "behind" | "up-to-date"
}
