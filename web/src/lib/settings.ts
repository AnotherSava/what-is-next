import { z } from "zod";
import { getPrisma } from "@/lib/db";

// App-level configuration and bookkeeping (brief §5 Setting model, §5a rule 4: app state lives in Setting,
// per-user preferences would get their own table). JSON-encoded rows; this module is the only access path —
// every read and write is validated against the schema registry below.
//
// Unlike printlab's settings (user-tunable, seeded with defaults), these keys are runtime caches and job
// bookkeeping with no meaningful pre-seeded default. getSetting therefore returns `null` when a key is
// absent; callers decide the fallback.

// Nightly-refresh bookkeeping (brief §7): a one-line summary for the admin page.
const refreshLastRunSchema = z.object({
  at: z.string(), // ISO timestamp
  trigger: z.enum(["cron", "manual"]),
  tvRefreshed: z.number().int(),
  moviesRefreshed: z.number().int(),
  tvdbResolved: z.number().int().default(0), // default keeps pre-TVDB stored summaries parseable
  errors: z.number().int(),
  durationMs: z.number().int(),
});

// SQLite backup bookkeeping (brief §7): last snapshot + retention prune.
const backupLastRunSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  file: z.string().nullable(),
  prunedCount: z.number().int(),
  error: z.string().nullable(),
});

// A compact summary of the last import run, persisted so the admin page can show it regardless of where the
// CLI ran (brief §8.7). The full report + unresolved items still go to scripts/out/.
const importSummarySchema = z.object({
  at: z.string(),
  dir: z.string(),
  seriesResolved: z.number().int(),
  seriesTotal: z.number().int(),
  moviesResolved: z.number().int(),
  moviesTotal: z.number().int(),
  episodesMatched: z.number().int(),
  episodesTotal: z.number().int(),
  unmatchedWatched: z.number().int(),
  seenEpisodes: z.number().int(),
  seenMovies: z.number().int(),
  favoriteSeries: z.number().int(),
  favoriteMovies: z.number().int(),
  lists: z.number().int(),
  listItems: z.number().int(),
  unresolved: z.array(z.string()),
  warnings: z.array(z.string()),
});

// Plex sync bookkeeping (Plex integration): last run summary for the admin page.
const plexLastSyncSchema = z.object({
  at: z.string(),
  trigger: z.enum(["cron", "manual"]),
  matchedShows: z.number().int(),
  matchedMovies: z.number().int(),
  presenceSeasons: z.number().int(),
});

// A Plex library item that isn't yet in the tracker — surfaced for the "review, then add" flow. Carries the
// external ids (to hydrate from TMDB) + the Plex rating key (to read episode watched state) + whether it's
// been watched in Plex.
const plexCandidateSchema = z.object({
  plexRatingKey: z.string(),
  mediaType: z.enum(["tv", "movie"]),
  title: z.string(),
  year: z.number().int().nullable(),
  tmdbId: z.number().int().nullable(),
  tvdbId: z.number().int().nullable(),
  imdbId: z.string().nullable(),
  plexWatched: z.boolean(),
  lastViewedAt: z.number().int().nullable(), // Unix epoch seconds — for the movie watch date when added
});
export type PlexCandidate = z.infer<typeof plexCandidateSchema>;

const plexCandidatesSchema = z.object({
  at: z.string(),
  items: z.array(plexCandidateSchema),
});

const SETTING_SCHEMAS = {
  "refresh:lastRun": refreshLastRunSchema,
  "backup:lastRun": backupLastRunSchema,
  "import:lastReport": importSummarySchema,
  "plex:lastSync": plexLastSyncSchema,
  "plex:candidates": plexCandidatesSchema,
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K> | null> {
  const row = await getPrisma().setting.findUnique({ where: { key } });
  if (!row) return null;
  return SETTING_SCHEMAS[key].parse(JSON.parse(row.value)) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  const json = JSON.stringify(SETTING_SCHEMAS[key].parse(value));
  await getPrisma().setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}
