import { getPrisma } from "@/lib/db";
import { createJellyfinScanner } from "@/lib/jellyfin";
import { createPlexScanner } from "@/lib/plex";
import { getSetting, setSetting, SYNC_KEYS } from "@/lib/settings";
import { getTmdb } from "@/lib/tmdb";
import { adoptCandidates } from "./adopt";
import { applyEpisodePresence, applyPresence, applyWatched } from "./apply";
import { buildCatalogIndex } from "./catalog";
import { getEnabledProviders, getMediaServer, isUsable, libraryAllowlist, type MediaServerConfig } from "./config";
import { PROVIDER_LABEL, type LibraryCandidate, type MediaProvider, type MediaScanner } from "./types";

// App-level sync orchestration — the composition root that wires each provider's scanner to the shared writers.
// Shared by the admin "Sync now" actions, the nightly job and the on-view freshener, so presence, the watch import
// and the review lists are produced identically however a sync is triggered.
//
// Each provider syncs independently: its own cursors, its own bookkeeping keys, its own presence rows. One
// server being down or misconfigured therefore can't stop the other from syncing.

export interface ProviderSyncResult {
  provider: MediaProvider;
  matchedShows: number;
  matchedMovies: number;
  presenceSeasons: number;
  importedWatches: number;
  unaccounted: number;
  candidates: number;
  durationMs: number;
  presenceChanged: boolean;
}

export function buildScanner(provider: MediaProvider, config: MediaServerConfig): MediaScanner {
  const allow = libraryAllowlist(config);
  return provider === "plex"
    ? createPlexScanner({ url: config.url, token: config.token, allow })
    : createJellyfinScanner({ url: config.url, token: config.token, allow, user: config.user });
}

// Scan one server, replace its presence, import its watch state, and store its run summary + review lists. Does
// NOT add new titles — adopting a library-only title is always an explicit, reviewed action (see addLibraryItems).
export async function syncProvider(
  userId: string,
  provider: MediaProvider,
  trigger: "manual" | "cron" | "view",
): Promise<ProviderSyncResult> {
  const config = await getMediaServer(provider);
  if (!isUsable(config)) throw new Error(`${PROVIDER_LABEL[provider]} is not connected.`);

  const startMs = Date.now();
  const prisma = getPrisma();
  const keys = SYNC_KEYS[provider];
  const scanner = buildScanner(provider, config);
  const [catalog, watch, presence, source] = await Promise.all([
    buildCatalogIndex(prisma),
    getSetting(keys.watchCursor),
    getSetting(keys.presenceCursor),
    getSetting(keys.sourceCursor),
  ]);

  const r = await scanner.scan(catalog, {
    watch: watch?.shows ?? {},
    presence: presence?.shows ?? {},
    source: source?.shows ?? {},
  });
  const presenceChanged = await applyPresence(prisma, userId, provider, r.presenceRows);
  const unresolved = await applyEpisodePresence(prisma, userId, provider, r.episodePresence, r.matchedShowIds);
  const importedWatches = await applyWatched(prisma, userId, provider, r.watchedSignals);
  // A show whose episodes the catalog couldn't fully resolve keeps its OLD cursor, so the next sync fetches it
  // again. Advancing it would seal the gap: the server's counts wouldn't move, so the show would never be
  // re-fetched and the episodes the catalog learns about later would never get presence or watch state.
  for (const mediaItemId of unresolved) {
    const key = r.matchedShowKeys[mediaItemId];
    if (key == null) continue;
    delete r.cursors.watch[key];
    delete r.cursors.presence[key];
  }

  const at = new Date().toISOString();
  // Record the server id for watch deep links — best-effort, so a hiccup here never fails the whole sync.
  try {
    await setSetting(keys.server, { at, serverId: await scanner.getServerId() });
  } catch {
    // leave the prior value (if any) in place; links stay available from the last good sync
  }
  // Measure after the last server-facing call; the remaining setSetting writes are trivial local bookkeeping.
  const durationMs = Date.now() - startMs;
  await setSetting(keys.lastSync, {
    at,
    trigger,
    matchedShows: r.matchedShows,
    matchedMovies: r.matchedMovies,
    presenceSeasons: r.presenceSeasons,
    importedWatches,
    durationMs,
    unaccounted: r.unaccounted.length,
  });
  await setSetting(keys.candidates, { at, items: r.candidates });
  await setSetting(keys.unaccounted, { at, items: r.unaccounted });
  await setSetting(keys.watchCursor, { at, shows: r.cursors.watch });
  await setSetting(keys.presenceCursor, { at, shows: r.cursors.presence });
  await setSetting(keys.sourceCursor, { at, shows: r.cursors.source });

  return {
    provider,
    matchedShows: r.matchedShows,
    matchedMovies: r.matchedMovies,
    presenceSeasons: r.presenceSeasons,
    importedWatches,
    unaccounted: r.unaccounted.length,
    candidates: r.candidates.length,
    durationMs,
    presenceChanged,
  };
}

export interface SyncRunReport {
  results: ProviderSyncResult[];
  failures: { provider: MediaProvider; error: string }[];
}

// A failed sync writes no bookkeeping (deliberately — a failure must not masquerade as a fresh run), so nothing
// stored would stop the on-view freshener from retrying an unreachable server on its very next 20-second poll.
// This in-memory backoff does: after a failure that provider is skipped by the AUTOMATIC paths until the window
// passes. A manual "Sync now" always tries immediately — the owner asked for it — and any success clears it.
// Process-local and deliberately not persisted: a restart is a fine reason to try again.
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const retryAfter = new Map<MediaProvider, number>();

function inFailureBackoff(provider: MediaProvider): boolean {
  const until = retryAfter.get(provider);
  return until != null && Date.now() < until;
}

// Sync every connected server. One provider's failure is captured, not thrown, so a dead Plex box can't stop a
// working Jellyfin sync (and vice versa); the caller decides how loudly to report it.
export async function syncMediaServers(
  userId: string,
  trigger: "manual" | "cron" | "view",
  providers?: MediaProvider[],
): Promise<SyncRunReport> {
  const targets = providers ?? (await getEnabledProviders());
  const results: ProviderSyncResult[] = [];
  const failures: { provider: MediaProvider; error: string }[] = [];
  for (const provider of targets) {
    try {
      results.push(await syncProvider(userId, provider, trigger));
      retryAfter.delete(provider);
    } catch (e) {
      retryAfter.set(provider, Date.now() + FAILURE_BACKOFF_MS);
      failures.push({ provider, error: e instanceof Error ? e.message : `${PROVIDER_LABEL[provider]} sync failed.` });
    }
  }
  return { results, failures };
}

// Freshness window for the on-view freshener: it re-syncs — on open, on tab focus, and on a periodic poll while a
// tab stays open — only if the last sync is older than this. Also the basis for the header dot's "stale" (red)
// threshold (3× this). Override with MEDIA_VIEW_TTL_SECONDS. Default 1 min, so an open page stays ~1 min fresh
// and opening a page that's fallen behind re-syncs right away.
const DEFAULT_VIEW_TTL_MS = 60 * 1000;

export function viewSyncTtlMs(): number {
  const secs = Number(process.env.MEDIA_VIEW_TTL_SECONDS);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : DEFAULT_VIEW_TTL_MS;
}

// How current the watch state on screen is: the OLDEST last-sync among connected servers that have synced at all
// (with two servers, the page is only as fresh as the one that's lagging). Null until at least one has synced.
export async function lastSyncedAt(): Promise<string | null> {
  const providers = await getEnabledProviders();
  const runs = await Promise.all(providers.map((p) => getSetting(SYNC_KEYS[p].lastSync)));
  const times = runs.filter((r) => r != null).map((r) => r.at);
  return times.length > 0 ? times.reduce((oldest, at) => (Date.parse(at) < Date.parse(oldest) ? at : oldest)) : null;
}

// In-process guard so concurrent freshen calls (multiple tabs, rapid focus) share one sync instead of hammering
// the servers or contending on the SQLite writes. A single Node process serves the whole app, so a module-level
// promise is enough.
let inFlightViewSync: Promise<{ synced: boolean; changed: boolean }> | null = null;

// Stale-while-revalidate entry point for the on-view freshener: sync only the connected servers whose own last
// run is older than the window, coalescing concurrent callers. Returns whether any sync ran and whether it
// changed anything the pages show, so the client refreshes in place only on a real delta.
export async function syncMediaServersIfStale(userId: string): Promise<{ synced: boolean; changed: boolean }> {
  const providers = await getEnabledProviders();
  const ttl = viewSyncTtlMs();
  const runs = await Promise.all(providers.map((p) => getSetting(SYNC_KEYS[p].lastSync)));
  const stale = providers.filter((p, i) => {
    if (inFailureBackoff(p)) return false; // unreachable a moment ago — don't hammer it on every poll
    const last = runs[i];
    return !last || Date.now() - Date.parse(last.at) >= ttl;
  });
  if (stale.length === 0) return { synced: false, changed: false };
  if (inFlightViewSync) return inFlightViewSync;
  inFlightViewSync = (async () => {
    try {
      const { results } = await syncMediaServers(userId, "view", stale);
      return {
        synced: results.length > 0,
        changed: results.some((r) => r.presenceChanged || r.importedWatches > 0),
      };
    } finally {
      inFlightViewSync = null;
    }
  })();
  return inFlightViewSync;
}

// Adopt selected library-only titles into tracking, wiring the app singletons into the dep-injected core
// (media/adopt.ts). Only for items NOT already tracked, so existing history is never touched.
export async function addLibraryItems(
  userId: string,
  provider: MediaProvider,
  candidates: LibraryCandidate[],
): Promise<{ added: number; failed: string[] }> {
  const scanner = buildScanner(provider, await getMediaServer(provider));
  return adoptCandidates({ prisma: getPrisma(), tmdb: getTmdb(), scanner, userId }, candidates);
}
