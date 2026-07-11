import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { plural, seconds } from "@/lib/format";
import { isPlexConfigured } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";
import { getSetting, isManualWatchedEnabled } from "@/lib/settings";
import { isTvdbConfigured } from "@/lib/tvdb";
import { BackupNowButton, ManualWatchedToggle, RefreshNowButton } from "./_components/AdminButtons";
import { ACTION_BUTTON_CLASS } from "./_components/buttonStyle";
import { SyncPlexButton } from "./plex/_components/SyncButton";

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
  const [refresh, backup, plexSync, plexCandidates, tvdbStubs, manualWatched] = await Promise.all([
    getSetting("refresh:lastRun"),
    getSetting("backup:lastRun"),
    plexOn ? getSetting("plex:lastSync") : Promise.resolve(null),
    plexOn ? getSetting("plex:candidates") : Promise.resolve(null),
    getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
    isManualWatchedEnabled(),
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
  const candidateCount = plexCandidates?.items.length ?? 0;
  const plexState: JobState = !plexOn
    ? "off"
    : !plexSync
      ? "warn"
      : stale(plexSync.at) || candidateCount > 0
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
    : `${plural(plexSync.matchedShows, "show")} · ${plural(plexSync.matchedMovies, "movie")} · ${plural(plexSync.presenceSeasons, "season")} marked · ${plural(plexSync.importedWatches, "watch", "watches")} imported · ${seconds(plexSync.durationMs)}`;

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
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <SyncPlexButton />
                <p className="text-sm text-[var(--color-muted)]">{plexDetail}</p>
              </div>
              {candidateCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-behind)] bg-[var(--color-surface-2)] px-3 py-2">
                  <p className="text-sm text-[var(--color-behind)]">
                    {plural(candidateCount, "title")} in Plex {candidateCount === 1 ? "isn't" : "aren't"} tracked yet.
                  </p>
                  <Link href="/admin/plex" className={ACTION_BUTTON_CLASS}>
                    Review &amp; add
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Set <span className="font-mono text-xs">PLEX_URL</span> +{" "}
              <span className="font-mono text-xs">PLEX_TOKEN</span> to sync your library.{" "}
              <Link href="/admin/plex" className="text-[var(--color-accent)] hover:underline">
                Open Plex sync →
              </Link>
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
