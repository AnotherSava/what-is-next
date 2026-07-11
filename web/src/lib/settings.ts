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

// Plex sync bookkeeping (Plex integration): last run summary for the admin page.
const plexLastSyncSchema = z.object({
  at: z.string(),
  trigger: z.enum(["cron", "manual", "view"]),
  matchedShows: z.number().int(),
  matchedMovies: z.number().int(),
  presenceSeasons: z.number().int(),
  importedWatches: z.number().int().default(0), // watch events imported this run; default keeps pre-feature summaries parseable
  durationMs: z.number().int().default(0), // wall-clock of the sync; default keeps pre-timing summaries parseable
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

// User-facing app setting: whether the manual "mark watched" controls are shown. Off by default — watch state
// comes from the Plex sync, and the owner opts in to manual toggles from the admin page.
const manualWatchedSchema = z.object({ enabled: z.boolean() });

// Per-show watched-episode-count cursor (Plex integration): plexRatingKey → total viewedLeafCount at the last
// sync. Lets the next sync skip the /allLeaves fetch for any show whose count is unchanged (see scanPlex).
const plexWatchCursorSchema = z.object({
  at: z.string(),
  shows: z.record(z.string(), z.number().int()),
});

// The Plex server's stable machineIdentifier (Plex integration), captured each sync. Combined with a per-item
// plexRatingKey it builds an app.plex.tv deep link to watch the item. See src/lib/plex/link.ts.
const plexServerSchema = z.object({ at: z.string(), machineIdentifier: z.string() });

const SETTING_SCHEMAS = {
  "refresh:lastRun": refreshLastRunSchema,
  "backup:lastRun": backupLastRunSchema,
  "plex:lastSync": plexLastSyncSchema,
  "plex:candidates": plexCandidatesSchema,
  "plex:watchCursor": plexWatchCursorSchema,
  "plex:server": plexServerSchema,
  "settings:manualWatched": manualWatchedSchema,
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

// Whether the manual "mark watched" controls are shown in the UI. Off unless the owner has enabled it.
export async function isManualWatchedEnabled(): Promise<boolean> {
  return (await getSetting("settings:manualWatched"))?.enabled ?? false;
}

// The Plex server's machineIdentifier, or null until a sync has recorded it — needed to build watch deep links.
export async function getPlexServerId(): Promise<string | null> {
  return (await getSetting("plex:server"))?.machineIdentifier ?? null;
}
