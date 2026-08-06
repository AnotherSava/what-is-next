import type { ScanCursors } from "./types";

// When a scan needs to fetch a show's episode list, and when it can skip it.
//
// Fetching episodes is the expensive part of a sync — one request per show, plus (on Plex) one per season for the
// stream detail. Both providers avoid it the same way: every show carries counts that come free with its row, and
// an unchanged pair means nothing about that show has moved since last time. In the steady state that makes a sync
// zero episode requests.
//
// Shared rather than written per provider because the two must agree: if one drifts, that server silently stops
// picking up new watches while still reporting a successful sync.
//
// The trade-off both accept: a change that nets the same totals — an unwatch plus a watch, or a quality swap that
// keeps the episode count — is missed until the next real move. Presence, watch state and source are all corrected
// additively, so the cost is staleness, never wrongness.
export function needsEpisodeFetch(
  cursors: ScanCursors,
  itemKey: string,
  watchedEpisodes: number,
  totalEpisodes: number,
  seasonCount: number,
): boolean {
  const watchChanged = watchedEpisodes > 0 && watchedEpisodes !== cursors.watch[itemKey];
  const presenceChanged = totalEpisodes !== cursors.presence[itemKey];
  // A show whose source was never captured needs one fetch to seed it, even when both counts are unchanged.
  const sourceMissing = seasonCount > 0 && !(itemKey in cursors.source);
  return watchChanged || presenceChanged || sourceMissing;
}
