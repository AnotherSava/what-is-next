import { z } from "zod";
import { getPrisma } from "@/lib/db";
import type { DownloadSource } from "@/lib/downloadSources";
import type { MediaProvider } from "@/lib/media/types";

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
  // Per-failure details for the admin card. Default [] keeps pre-feature summaries (which only stored the count)
  // parseable; those older runs simply show no breakdown.
  errorItems: z
    .array(z.object({ title: z.string(), mediaType: z.enum(["tv", "movie"]), reason: z.string() }))
    .default([]),
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

// Media-server sync bookkeeping: last run summary for the admin page. One row per provider (see SYNC_KEYS), so
// Plex and Jellyfin cards each report their own last run.
const lastSyncSchema = z.object({
  at: z.string(),
  trigger: z.enum(["cron", "manual", "view"]),
  matchedShows: z.number().int(),
  matchedMovies: z.number().int(),
  presenceSeasons: z.number().int(),
  importedWatches: z.number().int().default(0), // watch events imported this run; default keeps pre-feature summaries parseable
  durationMs: z.number().int().default(0), // wall-clock of the sync; default keeps pre-timing summaries parseable
  unaccounted: z.number().int().default(0), // library items we couldn't identify (no id); default keeps pre-feature summaries parseable
});

// A library item that isn't yet in the tracker — surfaced for the "review, then add" flow. Carries the external
// ids (to hydrate from TMDB) + the item's key on that server (to read episode watch state) + whether it's watched.
const candidateSchema = z.object({
  itemKey: z.string(),
  mediaType: z.enum(["tv", "movie"]),
  title: z.string(),
  year: z.number().int().nullable(),
  tmdbId: z.number().int().nullable(),
  tvdbId: z.number().int().nullable(),
  imdbId: z.string().nullable(),
  watched: z.boolean(),
  watchedAt: z.string().nullable(), // ISO timestamp — the movie watch date when adopted; null if unknown
});

const candidatesSchema = z.object({
  at: z.string(),
  items: z.array(candidateSchema),
});

// A library item the sync couldn't reconcile — no catalog match AND no external id, so it can't be auto-added
// like a candidate (nothing to hydrate from). Surfaced for the admin (see UnaccountedItem); it usually means the
// server hasn't matched the file to a metadata agent, so the fix is on the server side.
const unaccountedItemSchema = z.object({
  itemKey: z.string(),
  mediaType: z.enum(["tv", "movie"]),
  title: z.string(),
  year: z.number().int().nullable(),
});
const unaccountedSchema = z.object({
  at: z.string(),
  items: z.array(unaccountedItemSchema),
});

// User-facing app setting: whether the manual "mark watched" controls are shown. Off by default — watch state
// comes from the Plex sync, and the owner opts in to manual toggles from the admin page.
const manualWatchedSchema = z.object({ enabled: z.boolean() });

// User-facing app setting: hold a show out of Behind and the Download view until the season it's waiting on has
// fully aired, so a season is only surfaced once every episode is out. On by default (see isWaitForFullSeasonEnabled).
const waitForFullSeasonSchema = z.object({ enabled: z.boolean() });

// Owner-configured download-source links for the Download view (torrent/tracker searches). Each source's URL —
// domain, path, params — lives here, in runtime config, not the repo, so no download-source details are ever
// committed. A source targets movie cards, show cards, or both; its template carries a {query} placeholder
// replaced with the URL-encoded title, in the source's own search language. Kept permissive (any string) on
// purpose: the URL shape and the language code are validated where they're used — see src/lib/downloadSources.ts.
const downloadSourceSchema = z.object({
  label: z.string(),
  template: z.string(),
  movies: z.boolean(),
  shows: z.boolean(),
  // ISO 639-1 code of the title the source is searched with; default "en" keeps pre-feature stored rows parseable.
  language: z.string().default("en"),
  // Season marker for a per-season show link, printf-shaped (see downloadSources.ts). The default keeps pre-feature
  // stored rows producing the same "… S02" links they always did.
  seasonPattern: z.string().default("S%02d"),
});
const downloadSourcesSchema = z.object({ sources: z.array(downloadSourceSchema) });

// The three per-show cursors that keep a steady-state sync cheap, each mapping the show's item key ON THAT SERVER
// to a count observed at the last sync (see ScanCursors): watched episodes, total episodes, and seasons whose
// source was captured. An unchanged count lets the next sync skip that show's episode fetch entirely.
const cursorSchema = z.object({
  at: z.string(),
  shows: z.record(z.string(), z.number().int()),
});

// The media server's stable id, captured each sync — Plex's machineIdentifier, Jellyfin's server Id. Combined
// with a per-item key it builds a deep link to watch the item. See src/lib/media/link.ts.
const serverIdSchema = z.object({ at: z.string(), serverId: z.string() });

// Media-server connections, edited from /admin. This is the source of truth: the PLEX_*/JELLYFIN_* environment
// variables only seed this row the first time it's read (see media/config.ts) and are ignored afterwards.
// `user` is Jellyfin-only (which account's watch state to read); Plex's token is already user-scoped.
const mediaServerSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  token: z.string(),
  libraries: z.string(), // comma-separated library names to sync; blank = all TV + movie libraries
  user: z.string(),
});
const mediaServersSchema = z.object({ plex: mediaServerSchema, jellyfin: mediaServerSchema });

const SETTING_SCHEMAS = {
  "refresh:lastRun": refreshLastRunSchema,
  "backup:lastRun": backupLastRunSchema,
  "plex:lastSync": lastSyncSchema,
  "plex:candidates": candidatesSchema,
  "plex:unaccounted": unaccountedSchema,
  "plex:watchCursor": cursorSchema,
  "plex:presenceCursor": cursorSchema,
  "plex:sourceCursor": cursorSchema,
  "plex:server": serverIdSchema,
  "jellyfin:lastSync": lastSyncSchema,
  "jellyfin:candidates": candidatesSchema,
  "jellyfin:unaccounted": unaccountedSchema,
  "jellyfin:watchCursor": cursorSchema,
  "jellyfin:presenceCursor": cursorSchema,
  "jellyfin:sourceCursor": cursorSchema,
  "jellyfin:server": serverIdSchema,
  "settings:mediaServers": mediaServersSchema,
  "settings:manualWatched": manualWatchedSchema,
  "settings:waitForFullSeason": waitForFullSeasonSchema,
  "settings:downloadSources": downloadSourcesSchema,
} as const;

// Each provider's bookkeeping keys in one place, so provider-generic code can read and write them without a
// stringly-typed key built at the call site. The two providers' keys share their schemas, so SettingValue
// resolves to the same type either way.
export const SYNC_KEYS = {
  plex: {
    lastSync: "plex:lastSync",
    candidates: "plex:candidates",
    unaccounted: "plex:unaccounted",
    watchCursor: "plex:watchCursor",
    presenceCursor: "plex:presenceCursor",
    sourceCursor: "plex:sourceCursor",
    server: "plex:server",
  },
  jellyfin: {
    lastSync: "jellyfin:lastSync",
    candidates: "jellyfin:candidates",
    unaccounted: "jellyfin:unaccounted",
    watchCursor: "jellyfin:watchCursor",
    presenceCursor: "jellyfin:presenceCursor",
    sourceCursor: "jellyfin:sourceCursor",
    server: "jellyfin:server",
  },
} as const satisfies Record<MediaProvider, Record<string, SettingKey>>;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

// Read a stored value along with whether the row exists at all. The distinction matters for settings that seed
// themselves from the environment on first use (media/config.ts): "absent" means seed it, whereas "present but
// unreadable" must not silently overwrite what the owner configured.
//
// A row that fails to parse yields null rather than throwing: these settings are read from the root layout on
// every request, so one legacy or hand-edited row must not be able to 500 the entire site. The write path still
// validates strictly, so nothing unparseable can be stored by the app itself.
export async function readSetting<K extends SettingKey>(
  key: K,
): Promise<{ present: boolean; value: SettingValue<K> | null }> {
  const row = await getPrisma().setting.findUnique({ where: { key } });
  if (!row) return { present: false, value: null };
  let json: unknown;
  try {
    json = JSON.parse(row.value);
  } catch {
    console.warn(`[settings] ignoring "${key}": stored value is not valid JSON`);
    return { present: true, value: null };
  }
  const parsed = SETTING_SCHEMAS[key].safeParse(json);
  if (!parsed.success) {
    console.warn(`[settings] ignoring unreadable "${key}": ${parsed.error.message}`);
    return { present: true, value: null };
  }
  return { present: true, value: parsed.data as SettingValue<K> };
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K> | null> {
  return (await readSetting(key)).value;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  const json = JSON.stringify(SETTING_SCHEMAS[key].parse(value));
  await getPrisma().setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

// Whether the manual "mark watched" controls are shown in the UI. Off unless the owner has enabled it.
export async function isManualWatchedEnabled(): Promise<boolean> {
  return (await getSetting("settings:manualWatched"))?.enabled ?? false;
}

// Whether a still-airing season is held back until every episode has aired before it makes a show Behind or lists
// it in the Download view. On by default — the owner turns it off to be surfaced episodes as soon as they air.
export async function isWaitForFullSeasonEnabled(): Promise<boolean> {
  return (await getSetting("settings:waitForFullSeason"))?.enabled ?? true;
}

// The owner-configured Download-view source links (empty when unset) — the Download page renders a chip per source.
export async function getDownloadSources(): Promise<DownloadSource[]> {
  return (await getSetting("settings:downloadSources"))?.sources ?? [];
}
