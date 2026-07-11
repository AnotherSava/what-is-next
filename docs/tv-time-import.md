# TV Time import — historical record

The catalog and watch history were seeded once from a TV Time account export. The importer that performed this one-time migration has since been **removed** (imports are not an ongoing feature). This file preserves the reconciliation results and the follow-up repairs so the data's provenance stays understandable without the code.

## The migration

- **Source**: a TV Time "Out" export bundle — `tvtime-series-*.json`, `tvtime-movies-*.json`, `tvtime-lists-*.json`, plus an optional `user_tv_show_data.csv` (GDPR export) for cross-checking. Export dated 2026-07-07, archived outside the repo.
- **Run**: 2026-07-09, as the owner account.
- **Tooling (removed)**: CLI `web/scripts/import.ts` (`npm run import -- <export-dir>`) driving the `web/src/lib/import/` module — Importer orchestration, TVDB→TMDB id resolution, `(season, episode)` episode matching, and the GDPR cross-check. Recoverable from git history (added in commit `8a1fb9d`).
- **Provenance in the DB**: every imported watch is a `SeenEvent` with `source = "tvtime-import"` (the schema still documents that value). This data is untouched by the removal.

## Results (final, after the follow-up repairs below)

- Series 83/83 resolved · Movies 99/99 · Episodes matched 3378/3714.
- Watch history: 1931 episode + 81 movie `SeenEvent`s · Favorites 17 series + 8 movies · Lists: 1 ("Didn't like", 5 items).

## Titles TMDB couldn't resolve → resolved via the TVDB fallback

TMDB returned no match for 4 fan/web titles. Each carried a TVDB id, and the TVDB fallback metadata source (added after the import) hydrated them (`metadataSource = "tvdb"`):

- Harry Potter and the Ten Years Later (tv, tvdb 283555)
- Дыши (tv, tvdb 466900)
- Backrooms (tv, tvdb 420847)
- Harry Potter and the Deathly Weapons (movie, tvdb 138435)

## Follow-up repairs (2026-07-10)

An audit against the live database found two gaps, both fixed by a one-off back-fill from the preserved export:

1. **Lost episode watches.** Harry Potter and the Ten Years Later and Дыши were TMDB-unresolved _at import time_, so no catalog episodes existed to attach their watches to — their 8 + 8 watched episodes were dropped (and were not even counted in `unmatchedWatched`). Once the TVDB fallback created the episode rows, 16 episode `SeenEvent`s were back-filled (source `tvtime-import`, original watched dates 2026-03-15 and 2026-05-20). Refresh never restores these on its own because it never writes user state.
2. **List-only title.** "Scavengers Reign" (tvdb 421287 / tmdb 204154) sat in the "Didn't like" list but was never a followed series, so the import created no catalog row. It was added as a catalog row + list item (position 0); the list now holds all 5 items.

## Plex date reconciliation (2026-07-11)

TV Time's `watchedAt` often carried bulk-marking dates (whole seasons stamped on one later day), while Plex holds the actual per-play timestamps. The Plex sync couldn't fix this on its own: `applyWatched` is additive and de-dupes against existing `SeenEvent`s regardless of source, so for any episode/movie TV Time already logged, Plex never wrote its date. A one-time reconcile re-fetched Plex's full watch history (via `scanPlex` with an empty cursor) and, for each item holding a `tvtime-import` event, applied a **`min(TV Time, Plex)` policy** — moving the date to Plex's only where Plex proves an _earlier_ watch, so a late TV Time mark is corrected while a Plex _rewatch_ never overwrites the original first watch.

- **304** episode/movie dates moved earlier to Plex's date (max 34 days; 215 of them ≤3 days). The largest were sloppy TV Time bulk-marks: Upload S4, Better Things S3, Mrs. Maisel S4E1, Game of Thrones S5E1–3.
- **120** watches where Plex's date was _later_ (rewatches — e.g. Black Mirror S4E1 rewatched 2026, 3 Body Problem binge) kept their original TV Time date.
- **24** Plex-only watches (already `source = "plex"`) and **1** Plex episode absent from the catalog (numbering mismatch) were left untouched.
- **Provenance:** only `watchedAt` was corrected — `source` stays `"tvtime-import"` (these watches entered the log via the TV Time migration), so a `tvtime-import` event's date may now differ from the raw export. The reconcile ran from a throwaway script (since removed; recoverable pattern — re-fetch Plex, apply `min` per matched event).

## Accepted limitations (not bugs — deliberately unfixed)

15 watched episodes could not be matched: TV Time is TVDB-numbered and places these in season tails / specials that TMDB numbers differently. The importer matches strictly on `(season, episode)` and never guesses, so these slots — which don't exist as TMDB episodes — went unmatched. The TVDB fallback can't help (all three shows are TMDB-canonical). The raw export is archived if the watches are ever wanted.

| Show                              | Unmatched watched episodes                     |
| --------------------------------- | ---------------------------------------------- |
| Женский Стендап (Female Stand-up) | S1E13–14, S2E13–16, S3E17–19, S4E18–19 (11)    |
| Firefly                           | S1E12–14 (3) — aired-vs-production renumbering |
| The Big Bang Theory               | S0E6 (1) — a special TMDB lacks                |

## GDPR cross-check

The optional GDPR CSV was cross-checked against imported watch counts: 85 shows compared, 46 discrepancies. 43 were _imported > GDPR_ (the CSV is an older/partial snapshot — benign). 3 were _GDPR > imported_:

- Firefly 14 vs 11 — the 3 unmatched-watched episodes above.
- Black Mirror 34 vs 32 — a GDPR snapshot counting artifact (the export itself has 32, matching the DB); not data loss.
- Harry Potter and the Ten Years Later 8 vs 0 — the lost history, now back-filled.

## If we ever re-import

Restore `web/src/lib/import/` and `web/scripts/import.ts` from git history (commit `8a1fb9d`), re-add the `import` npm script and the `import:lastReport` setting schema, then run `npm run import -- <export-dir>`. The importer was idempotent (keyed by external ids + `source = "tvtime-import"`), so a re-run converges rather than duplicating.
