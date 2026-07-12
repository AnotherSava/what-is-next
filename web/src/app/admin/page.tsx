import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { plural, seconds } from "@/lib/format";
import { isPlexConfigured } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";
import { getDownloadSources, getMovieRatingsVisibility, getSetting, isManualWatchedEnabled } from "@/lib/settings";
import { isTvdbConfigured } from "@/lib/tvdb";
import { addSelectedPlexItems } from "./actions";
import {
  BackupNowButton,
  ManualWatchedToggle,
  MovieRatingsToggles,
  RefreshNowButton,
} from "./_components/AdminButtons";
import { ACTION_BUTTON_CLASS } from "./_components/buttonStyle";
import { DownloadSourcesEditor } from "./_components/DownloadSources";
import { SyncPlexButton } from "./_components/SyncButton";

export const metadata: Metadata = { title: "Admin" };

// A job counts as "up to date" only if it ran within this window. The nightly cron runs daily, so ~a day + a
// couple hours of grace flags a genuinely missed run without false alarms from slight timing drift.
const FRESH_WINDOW_MS = 26 * 60 * 60 * 1000;

type JobState = "ok" | "warn" | "off"; // green / amber / grey (not configured)

// One place both the status dot and the freshness badge read from, so a state's dot and text can't diverge.
const STATE_COLOR: Record<JobState, string> = {
  ok: "var(--color-good)",
  warn: "var(--color-behind)",
  off: "var(--color-muted)",
};

function absolute(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function ago(iso: string, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Owner console (brief §8.7). proxy.ts already requires a session to reach /admin; this re-checks role. The page
// is a status dashboard: one card per scheduled job with a freshness signal, so the owner can see at a glance
// whether everything is current. All three nightly jobs (refresh, backup, Plex sync) run on the same daily cron.
export default async function AdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/login");

  // Dynamic server component: needs the request-time wall clock for the "time ago" freshness readouts. It renders
  // once per request and is never memoized, so reading the clock here is safe despite the purity lint.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const plexOn = isPlexConfigured();
  const [
    refresh,
    backup,
    plexSync,
    plexCandidates,
    plexUnaccounted,
    tvdbStubs,
    manualWatched,
    movieRatings,
    downloadSources,
  ] = await Promise.all([
    getSetting("refresh:lastRun"),
    getSetting("backup:lastRun"),
    plexOn ? getSetting("plex:lastSync") : Promise.resolve(null),
    plexOn ? getSetting("plex:candidates") : Promise.resolve(null),
    plexOn ? getSetting("plex:unaccounted") : Promise.resolve(null),
    getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
    isManualWatchedEnabled(),
    getMovieRatingsVisibility(),
    getDownloadSources(),
  ]);
  const stale = (iso: string): boolean => nowMs - new Date(iso).getTime() > FRESH_WINDOW_MS;

  // ── Refresh (incl. TVDB-fallback completeness) ────────────────────────────
  // Unresolved TVDB stubs — titles TMDB can't resolve that are still bare — fold into Refresh's status, since a
  // refresh pass is what hydrates them (there is no separate action of their own).
  const refreshState: JobState = !refresh
    ? "warn"
    : refresh.errors > 0 || stale(refresh.at) || tvdbStubs > 0
      ? "warn"
      : "ok";
  const refreshFresh = !refresh
    ? "never run"
    : refresh.errors > 0
      ? `${plural(refresh.errors, "error")} · ${ago(refresh.at, nowMs)}`
      : stale(refresh.at)
        ? `stale · ${ago(refresh.at, nowMs)}`
        : tvdbStubs > 0
          ? `${plural(tvdbStubs, "title")} unresolved`
          : `up to date · ${ago(refresh.at, nowMs)}`;
  const refreshDetail = refresh
    ? `${plural(refresh.tvRefreshed, "show")} · ${plural(refresh.moviesRefreshed, "movie")} · ${refresh.tvdbResolved ?? 0} via TVDB · ${seconds(refresh.durationMs)}`
    : "The nightly job runs automatically; this button triggers it now.";
  // TVDB-fallback fix line — shown inside the Refresh card only while TMDB-unresolvable titles remain as stubs.
  const tvdbNote =
    tvdbStubs > 0
      ? isTvdbConfigured()
        ? "Run Refresh to hydrate them from TVDB."
        : "These are titles TMDB can't resolve — set TVDB_API_KEY, then Refresh."
      : null;

  // ── Plex sync ────────────────────────────────────────────────────────────
  const candidates = plexCandidates?.items ?? [];
  const unaccounted = plexUnaccounted?.items ?? [];
  const candidateCount = candidates.length;
  const unaccountedCount = unaccounted.length;
  const plexState: JobState = !plexOn
    ? "off"
    : !plexSync
      ? "warn"
      : stale(plexSync.at) || candidateCount > 0 || unaccountedCount > 0
        ? "warn"
        : "ok";
  const plexFresh = !plexOn
    ? "not configured"
    : !plexSync
      ? "never synced"
      : stale(plexSync.at)
        ? `stale · ${ago(plexSync.at, nowMs)}`
        : `up to date · ${ago(plexSync.at, nowMs)}`;
  const plexDetail = !plexSync
    ? "Scan matches your Plex library to the catalog and marks what you have."
    : `${plural(plexSync.matchedShows, "show")} · ${plural(plexSync.matchedMovies, "movie")} · ${plural(plexSync.presenceSeasons, "season")} marked · ${plural(plexSync.importedWatches, "watch", "watches")} imported · ${plexSync.unaccounted} unmatched · ${seconds(plexSync.durationMs)}`;

  // ── Backup ───────────────────────────────────────────────────────────────
  const backupState: JobState = !backup ? "warn" : !backup.ok || stale(backup.at) ? "warn" : "ok";
  const backupFresh = !backup
    ? "never run"
    : !backup.ok
      ? `failed · ${ago(backup.at, nowMs)}`
      : stale(backup.at)
        ? `stale · ${ago(backup.at, nowMs)}`
        : `up to date · ${ago(backup.at, nowMs)}`;
  const backupDetail = !backup
    ? "Snapshots are kept 14 days on the data volume."
    : !backup.ok
      ? (backup.error ?? "Backup failed.")
      : `${backup.file} · pruned ${backup.prunedCount} old`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Signed in as {sessionUser.name}.</p>
      </div>

      <div className="space-y-3">
        <StatusCard label="Refresh" state={refreshState} freshness={refreshFresh} at={refresh?.at}>
          <div className="space-y-2.5">
            <p className="text-sm text-[var(--color-muted)]">
              Re-pulls show &amp; movie metadata (episodes, air dates, status) from TMDB — and TVDB for titles it
              can&rsquo;t resolve — so returning shows and upcoming movies stay current. Never touches your watch
              history.
            </p>
            <RefreshNowButton lastRun={refreshDetail} />
            {tvdbNote && <p className="text-sm text-[var(--color-behind)]">{tvdbNote}</p>}
          </div>
        </StatusCard>

        <StatusCard label="Plex sync" state={plexState} freshness={plexFresh} at={plexSync?.at}>
          {plexOn ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SyncPlexButton />
                <p className="text-sm text-[var(--color-muted)]">{plexDetail}</p>
              </div>

              {/* In Plex but not tracked — the review-and-add list. Hidden when there's nothing to add. */}
              {candidateCount > 0 && (
                <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-medium">
                    In Plex but not tracked{" "}
                    <span className="font-normal text-[var(--color-muted)]">({candidateCount})</span>
                  </h3>
                  <form action={addSelectedPlexItems} className="space-y-3">
                    <ul className="space-y-1">
                      {candidates.map((c) => (
                        <li key={c.plexRatingKey}>
                          <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                            <input
                              type="checkbox"
                              name="ratingKey"
                              value={c.plexRatingKey}
                              defaultChecked
                              className="accent-[#e5a00d]"
                            />
                            <span className="flex-1 text-sm">
                              {c.title} {c.year && <span className="text-[var(--color-muted)]">({c.year})</span>}
                              <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                                {c.mediaType === "tv" ? "TV" : "Movie"}
                              </span>
                              {c.plexWatched && <span className="ml-2 text-xs text-[var(--color-good)]">watched</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <button type="submit" className={ACTION_BUTTON_CLASS}>
                      Add selected to tracking
                    </button>
                  </form>
                </div>
              )}

              {/* Unmatched in Plex — no external id, so the sync can't identify them. Hidden when there are none. */}
              {unaccountedCount > 0 && (
                <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-medium">
                    Unmatched in Plex{" "}
                    <span className="font-normal text-[var(--color-muted)]">({unaccountedCount})</span>
                  </h3>
                  <p className="text-sm text-[var(--color-muted)]">
                    In your Plex libraries but with no TMDB, IMDb, or TVDB id, so the sync can neither match them to the
                    catalog nor add them automatically. Fix the match in Plex (item &rarr; Fix Match &rarr; pick the
                    right title), then they&rsquo;ll sync normally.
                  </p>
                  <ul className="space-y-1">
                    {unaccounted.map((u) => (
                      <li key={u.plexRatingKey} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                        <span className="flex-1 text-sm">
                          {u.title} {u.year && <span className="text-[var(--color-muted)]">({u.year})</span>}
                          <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                            {u.mediaType === "tv" ? "TV" : "Movie"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Set <span className="font-mono text-xs">PLEX_URL</span> +{" "}
              <span className="font-mono text-xs">PLEX_TOKEN</span> to sync your library.
            </p>
          )}
        </StatusCard>

        <StatusCard label="Backup" state={backupState} freshness={backupFresh} at={backup?.at}>
          <div className="space-y-2.5">
            <BackupNowButton />
            <p className="truncate text-sm text-[var(--color-muted)]">{backupDetail}</p>
          </div>
        </StatusCard>
      </div>

      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="font-medium">Settings</h2>
        <ManualWatchedToggle enabled={manualWatched} />
        <p className="text-sm text-[var(--color-muted)]">
          Off by default — watch state comes from the Plex sync. Turn on to show manual mark-watched controls on the
          home, show, and movie pages.
        </p>

        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <h3 className="text-sm font-medium">Ratings</h3>
          <p className="text-sm text-[var(--color-muted)]">
            Which rating sources appear on movie and show cards. Both on by default; uncheck one to hide it.
          </p>
          <MovieRatingsToggles tmdb={movieRatings.tmdb} imdb={movieRatings.imdb} />
        </div>

        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <h3 className="text-sm font-medium">Download search links</h3>
          <p className="text-sm text-[var(--color-muted)]">
            Links shown on each movie and show in the Download view (open in a new tab). Put{" "}
            <span className="font-mono text-xs">{"{query}"}</span> where the title goes, and choose which cards each
            source appears on; leave the label blank to use the site&rsquo;s domain. Stored here, never in the repo.
          </p>
          <DownloadSourcesEditor sources={downloadSources} />
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  label,
  state,
  freshness,
  at,
  children,
}: {
  label: string;
  state: JobState;
  freshness: string;
  at?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Dot state={state} />
          <h2 className="font-medium">{label}</h2>
        </div>
        <span className="text-xs" style={{ color: STATE_COLOR[state] }} title={at ? absolute(at) : undefined}>
          {freshness}
        </span>
      </div>
      {children}
    </section>
  );
}

function Dot({ state }: { state: JobState }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: STATE_COLOR[state] }}
      aria-hidden
    />
  );
}
