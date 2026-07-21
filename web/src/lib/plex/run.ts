import { getPrisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { getTmdb } from "@/lib/tmdb";
import { getPlex } from "./client";
import {
  applyEpisodePresence,
  applyPresence,
  applyWatched,
  scanPlex,
  type PlexSyncDeps,
  type ScanResult,
} from "./sync";

// App-level Plex sync orchestration (uses the global singletons). Shared by the admin "Sync now" action and
// the nightly job so presence + the review list are produced identically. Kept out of sync.ts so that module
// stays pure/dep-injected for tests.

export function plexDeps(userId: string): PlexSyncDeps {
  return { prisma: getPrisma(), plex: getPlex(), tmdb: getTmdb(), userId };
}

// Scan Plex, replace presence, import watch state for already-tracked items, and store the run summary + the
// review candidate list. Does NOT add new titles — adding is always an explicit, reviewed action.
export async function syncPlexPresence(
  userId: string,
  trigger: "manual" | "cron" | "view",
): Promise<ScanResult & { importedWatches: number; durationMs: number; presenceChanged: boolean }> {
  const startMs = Date.now();
  const deps = plexDeps(userId);
  const priorWatchCursor = (await getSetting("plex:watchCursor"))?.shows ?? {};
  const priorPresenceCursor = (await getSetting("plex:presenceCursor"))?.shows ?? {};
  const priorSourceCursor = (await getSetting("plex:sourceCursor"))?.shows ?? {};
  const r = await scanPlex(deps, priorWatchCursor, priorPresenceCursor, priorSourceCursor);
  const presenceChanged = await applyPresence(deps.prisma, userId, r.presenceRows);
  await applyEpisodePresence(deps.prisma, userId, r.episodePresence, r.matchedShowIds);
  const importedWatches = await applyWatched(deps.prisma, userId, r.watchedSignals);
  const at = new Date().toISOString();
  // Record the server id for watch deep links — best-effort, so a hiccup here never fails the whole sync.
  try {
    await setSetting("plex:server", { at, machineIdentifier: await deps.plex.getMachineIdentifier() });
  } catch {
    // leave the prior value (if any) in place; links stay available from the last good sync
  }
  // Measure after the last Plex-facing call; the remaining setSetting writes are trivial local bookkeeping.
  const durationMs = Date.now() - startMs;
  await setSetting("plex:lastSync", {
    at,
    trigger,
    matchedShows: r.matchedShows,
    matchedMovies: r.matchedMovies,
    presenceSeasons: r.presenceSeasons,
    importedWatches,
    durationMs,
    unaccounted: r.unaccounted.length,
  });
  await setSetting("plex:candidates", { at, items: r.candidates });
  await setSetting("plex:unaccounted", { at, items: r.unaccounted });
  await setSetting("plex:watchCursor", { at, shows: r.watchCursor });
  await setSetting("plex:presenceCursor", { at, shows: r.presenceCursor });
  await setSetting("plex:sourceCursor", { at, shows: r.sourceCursor });
  return { ...r, importedWatches, durationMs, presenceChanged };
}

// Freshness window for the on-view freshener: it re-syncs — on open, on tab focus, and on a periodic poll while a
// tab stays open — only if the last sync is older than this. Also the basis for the header dot's "stale" (red)
// threshold (3× this). Override with PLEX_VIEW_TTL_SECONDS. Default 1 min, so an open page stays ~1 min fresh and
// opening a page that's fallen behind re-syncs right away.
const DEFAULT_VIEW_TTL_MS = 60 * 1000;

export function viewSyncTtlMs(): number {
  const secs = Number(process.env.PLEX_VIEW_TTL_SECONDS);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : DEFAULT_VIEW_TTL_MS;
}

// In-process guard so concurrent freshen calls (multiple tabs, rapid focus) share one sync instead of hammering
// Plex or contending on the SQLite writes. A single Node process serves the whole app, so a module-level promise
// is enough.
let inFlightViewSync: Promise<{ synced: boolean; changed: boolean }> | null = null;

// Stale-while-revalidate entry point for the on-view freshener: run a sync only when the last one is older than
// the window, coalescing concurrent callers. Returns whether a sync ran and whether it changed anything the pages
// show, so the client refreshes in place only on a real delta.
export async function syncPlexPresenceIfStale(userId: string): Promise<{ synced: boolean; changed: boolean }> {
  const last = await getSetting("plex:lastSync");
  if (last && Date.now() - Date.parse(last.at) < viewSyncTtlMs()) return { synced: false, changed: false };
  if (inFlightViewSync) return inFlightViewSync;
  inFlightViewSync = (async () => {
    try {
      const r = await syncPlexPresence(userId, "view");
      return { synced: true, changed: r.presenceChanged || r.importedWatches > 0 };
    } finally {
      inFlightViewSync = null;
    }
  })();
  return inFlightViewSync;
}
