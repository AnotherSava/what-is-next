import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "@/app/_components/cardUi";
import { getPrisma } from "@/lib/db";
import { plural } from "@/lib/format";
import { isPlexConfigured } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";
import { plexSyncSummary } from "@/lib/plex";
import type { RefreshError } from "@/lib/refresh";
import { refreshSummary } from "@/lib/refreshSummary";
import { getDownloadSources, getSetting, isManualWatchedEnabled } from "@/lib/settings";
import { isTvdbConfigured } from "@/lib/tvdb";
import { addSelectedPlexItems } from "./actions";
import { BackupNowButton, ManualWatchedToggle, RefreshNowButton } from "./_components/AdminButtons";
import { ACTION_BUTTON_CLASS } from "./_components/buttonStyle";
import { FreshnessBadge } from "./_components/FreshnessBadge";
import { RunResult, StatRows } from "./_components/RunResult";
import { DownloadSourcesEditor } from "./_components/DownloadSources";
import { SyncPlexButton } from "./_components/SyncButton";

export const metadata: Metadata = { title: "Settings" };

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

const CARD_CLASS = "rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]";
const DESC_CLASS = "text-[13px] leading-[1.5] text-[var(--color-muted)]";

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

// Split a backup file path into its folder and filename for the two-line location readout. Handles both Windows
// (dev) and POSIX (prod) separators.
function splitPath(p: string): { folder: string; file: string } {
  const m = p.match(/^(.*)[\\/]([^\\/]+)$/);
  return m ? { folder: m[1], file: m[2] } : { folder: "", file: p };
}

// The backup snapshot's folder + downloadable filename, used as the Backup card's result body. Two label/value rows
// (muted label column, mono value) matching the design. The folder row is static (with the design's zebra stripe);
// the whole file value is a download link that, like the reference's `.wn-icobtn`, highlights on hover (surface fill
// + brighter text) and downloads the snapshot on click.
function backupFileLines(filePath: string | null, prunedCount: number): React.ReactNode {
  const { folder, file } = splitPath(filePath ?? "");
  const downloadHref = `/api/admin/backup/download?file=${encodeURIComponent(file)}`;
  return (
    <div className="flex flex-col">
      <div
        className="-mx-2 flex min-w-0 items-center gap-[9px] rounded-md px-2 py-1"
        style={{ background: "rgba(255,255,255,0.015)" }}
      >
        <span className="w-[38px] shrink-0 font-num text-[12.5px] text-[var(--color-muted)]">folder</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#c4c4cc]" title={folder}>
          {folder}
        </code>
      </div>
      <div className="-mx-2 flex min-w-0 items-center gap-[9px] rounded-md px-2 py-1">
        <span className="w-[38px] shrink-0 font-num text-[12.5px] text-[var(--color-muted)]">file</span>
        <a
          href={downloadHref}
          download={file}
          title="Download backup"
          className="wn-dl min-w-0 flex-1 truncate font-mono text-[11px] text-[#c4c4cc]"
        >
          {file}
        </a>
        <a
          href={downloadHref}
          download={file}
          title="Download backup"
          aria-label="Download backup"
          className="wn-icobtn -ml-[3px] flex shrink-0 items-center rounded-md p-1"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
        </a>
      </div>
      {prunedCount > 0 && (
        <div className="mt-1 px-2 text-[11px] text-[var(--color-faint)]">pruned {prunedCount} old</div>
      )}
    </div>
  );
}

// Owner console (brief §8.7) — the Settings view. proxy.ts already requires a session to reach /admin; this
// re-checks role. A grid of one card per scheduled job (each with a freshness signal + "run now" button), then any
// Plex review lists, then the app settings. Rebuilt to the design reference's card grid.
export default async function AdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/login");

  // Dynamic server component: needs the request-time wall clock for the "time ago" freshness readouts. It renders
  // once per request and is never memoized, so reading the clock here is safe despite the purity lint.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const plexOn = isPlexConfigured();
  const [refresh, backup, plexSync, plexCandidates, plexUnaccounted, tvdbStubs, manualWatched, downloadSources] =
    await Promise.all([
      getSetting("refresh:lastRun"),
      getSetting("backup:lastRun"),
      plexOn ? getSetting("plex:lastSync") : Promise.resolve(null),
      plexOn ? getSetting("plex:candidates") : Promise.resolve(null),
      plexOn ? getSetting("plex:unaccounted") : Promise.resolve(null),
      getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
      isManualWatchedEnabled(),
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
  // Status word only — the "when" moved into the result line below the button (see refreshDetail).
  const refreshFresh = !refresh
    ? "never run"
    : refresh.errors > 0
      ? plural(refresh.errors, "error")
      : stale(refresh.at)
        ? "stale"
        : tvdbStubs > 0
          ? `${plural(tvdbStubs, "title")} unresolved`
          : "up to date";
  // The last run's result — always shown, with its relative time in the heading ("Refreshed 1m ago") and the
  // duration to the right; stats (bright numbers, muted labels) below.
  const refreshRes = refresh ? refreshSummary(refresh) : null;
  const refreshDetail =
    refresh && refreshRes ? (
      <RunResult verb="Refreshed" when={ago(refresh.at, nowMs)} duration={refreshRes.duration}>
        <StatRows stats={refreshRes.stats} />
      </RunResult>
    ) : null;
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
        ? "stale"
        : "up to date";
  // The last sync's result — always shown, with its relative time in the heading and the duration to the right.
  const plexRes = plexSync ? plexSyncSummary(plexSync) : null;
  const plexStats =
    plexSync && plexRes ? (
      <RunResult verb="Synced" when={ago(plexSync.at, nowMs)} duration={plexRes.duration}>
        <StatRows stats={plexRes.stats} />
      </RunResult>
    ) : null;

  // ── Backup ───────────────────────────────────────────────────────────────
  const backupState: JobState = !backup ? "warn" : !backup.ok || stale(backup.at) ? "warn" : "ok";
  const backupFresh = !backup ? "never run" : !backup.ok ? "failed" : stale(backup.at) ? "stale" : "up to date";
  const backupStats: React.ReactNode = !backup ? null : !backup.ok ? (
    <p className="text-[12px] text-red-400">{backup.error ?? "Backup failed."}</p>
  ) : (
    <RunResult verb="Backed up" when={ago(backup.at, nowMs)}>
      {backupFileLines(backup.file, backup.prunedCount)}
    </RunResult>
  );

  return (
    <div className="space-y-[14px]">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Signed in as {sessionUser.name}.</p>
      </div>

      {/* One card per scheduled job — the run-now button (with a status dot) up top, stats at the bottom. */}
      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3">
        <JobCard
          button={
            <RefreshNowButton
              dotColor={STATE_COLOR[refreshState]}
              freshness={refreshFresh}
              freshnessColor={STATE_COLOR[refreshState]}
              freshnessTitle={refresh ? absolute(refresh.at) : undefined}
              result={
                <>
                  {refreshDetail}
                  {tvdbNote && <p className="mt-2 text-[13px] text-[var(--color-behind)]">{tvdbNote}</p>}
                  {refresh && refresh.errors > 0 && refresh.errorItems.length > 0 && (
                    <RefreshErrors errors={refresh.errors} items={refresh.errorItems} />
                  )}
                </>
              }
            />
          }
          statusInButton
          freshness={refreshFresh}
          color={STATE_COLOR[refreshState]}
          at={refresh?.at}
          hasResult={!!refresh}
          desc={<em>Re-pulls show &amp; movie metadata (episodes, air dates, status) from TMDB/TVDB</em>}
        />

        <JobCard
          button={
            plexOn ? (
              <SyncPlexButton
                dotColor={STATE_COLOR[plexState]}
                freshness={plexFresh}
                freshnessColor={STATE_COLOR[plexState]}
                freshnessTitle={plexSync ? absolute(plexSync.at) : undefined}
                result={plexStats}
              />
            ) : null
          }
          statusInButton={plexOn}
          freshness={plexFresh}
          color={STATE_COLOR[plexState]}
          at={plexSync?.at}
          hasResult={!!plexSync}
          desc={
            plexOn ? (
              <em>Re-pulls your Plex catalog, including watched status and dates</em>
            ) : (
              <>
                Set <span className="font-mono text-xs">PLEX_URL</span> +{" "}
                <span className="font-mono text-xs">PLEX_TOKEN</span> to sync your library.
              </>
            )
          }
        />

        <JobCard
          button={
            <BackupNowButton
              dotColor={STATE_COLOR[backupState]}
              freshness={backupFresh}
              freshnessColor={STATE_COLOR[backupState]}
              freshnessTitle={backup ? absolute(backup.at) : undefined}
              result={backupStats}
            />
          }
          statusInButton
          freshness={backupFresh}
          color={STATE_COLOR[backupState]}
          at={backup?.at}
          hasResult={!!backup}
          desc={<em>Saves a full snapshot of the database; older snapshots are pruned after 14 days</em>}
        />
      </div>

      {/* Plex review — only when the last sync surfaced something to act on. */}
      {plexOn && candidateCount > 0 && (
        <section className={`${CARD_CLASS} p-5`}>
          <h3 className="font-display text-[16px] font-semibold">
            In Plex but not tracked <span className="font-normal text-[var(--color-muted)]">({candidateCount})</span>
          </h3>
          <form action={addSelectedPlexItems} className="mt-3 space-y-3">
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
        </section>
      )}

      {plexOn && unaccountedCount > 0 && (
        <section className={`${CARD_CLASS} p-5`}>
          <h3 className="font-display text-[16px] font-semibold">
            Unmatched in Plex <span className="font-normal text-[var(--color-muted)]">({unaccountedCount})</span>
          </h3>
          <p className={`mt-2 ${DESC_CLASS}`}>
            In your Plex libraries but with no TMDB, IMDb, or TVDB id, so the sync can neither match them to the catalog
            nor add them automatically. Fix the match in Plex (item &rarr; Fix Match &rarr; pick the right title), then
            they&rsquo;ll sync normally.
          </p>
          <ul className="mt-3 space-y-1">
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
        </section>
      )}

      {/* App settings. */}
      <section className={`${CARD_CLASS} p-5`}>
        <h2 className="font-display text-[16px] font-semibold">Settings</h2>

        <div className="mt-[14px]">
          <ManualWatchedToggle enabled={manualWatched} />
          <p className={`mt-1.5 ${DESC_CLASS}`}>
            Off by default — watch state comes from the Plex sync. Turn on to show manual mark-watched controls on the
            home, show, and movie pages.
          </p>
        </div>

        <div className="mt-4 border-t border-[#22222a] pt-4">
          <h3 className="font-display text-[13px] font-semibold">Download search links</h3>
          <p className={`mt-1 ${DESC_CLASS}`}>
            Links shown on each movie and show in the Download view (open in a new tab). Put{" "}
            <span className="font-mono text-xs">{"{query}"}</span> where the title goes, and choose which cards each
            source appears on; leave the label blank to use the site&rsquo;s domain. Stored here, never in the repo.
          </p>
          <div className="mt-3">
            <DownloadSourcesEditor sources={downloadSources} />
          </div>
        </div>
      </section>
    </div>
  );
}

// The inspectable breakdown behind the Refresh card's "N errors" badge. Distinct error messages surface right
// away; the titles hit by each fold into an expansion box. Populated on the next run; older summaries (count
// only) render nothing here.
function RefreshErrors({ errors, items }: { errors: number; items: RefreshError[] }) {
  // Group failures by reason, preserving first-seen order.
  const groups = new Map<string, RefreshError[]>();
  for (const it of items) {
    const g = groups.get(it.reason);
    if (g) g.push(it);
    else groups.set(it.reason, [it]);
  }
  return (
    <div className="mt-2.5 space-y-1.5 text-[12px]">
      {[...groups.entries()].map(([reason, group]) => (
        <details key={reason}>
          <summary className="flex cursor-pointer select-none items-center gap-1 text-[var(--color-behind)] [&::-webkit-details-marker]:hidden">
            <span className="flex shrink-0 text-[var(--color-faint)]" aria-hidden>
              {/* Collapsed: chevron points right; expanded: chevron points down. Swapped by the [open] rule above. */}
              <svg
                className="wn-disc-collapsed"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <svg
                className="wn-disc-expanded hidden"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
            <span className="truncate">
              {reason} <span className="text-[var(--color-faint)]">· {group.length}</span>
            </span>
          </summary>
          <ul className="mt-1 list-inside list-disc pl-1.5 leading-tight marker:text-[var(--color-faint)]">
            {group.map((e, i) => (
              <li key={i} className="truncate">
                <span className="text-[var(--color-text)]">{e.title}</span>
                <span className="ml-1.5 rounded bg-[var(--color-surface-2)] px-1 text-[10px] uppercase text-[var(--color-muted)]">
                  {e.mediaType === "tv" ? "TV" : "Movie"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {errors > items.length && (
        <p className="text-[var(--color-faint)]">
          Showing {items.length} of {errors} failures.
        </p>
      )}
    </div>
  );
}

function JobCard({
  button,
  freshness,
  color,
  at,
  desc,
  hasResult,
  statusInButton,
}: {
  button: React.ReactNode;
  freshness: string;
  color: string;
  at?: string;
  desc: React.ReactNode;
  // The last-run result now lives inside the button (so the button can hide it while a fresh run is in progress);
  // this flag just tells the card whether to draw the divider above the description.
  hasResult?: boolean;
  // When the button owns the status badge (all configured jobs), it renders the badge on its own line so a
  // progress bar / result below can't shove it around — otherwise the card renders the badge in the header itself.
  statusInButton?: boolean;
}) {
  return (
    <section className={`flex h-full flex-col ${CARD_CLASS} px-5 py-[18px]`}>
      <div className="mb-[14px] flex items-center justify-between gap-3">
        {button ?? <span />}
        {!statusInButton && <FreshnessBadge text={freshness} color={color} title={at ? absolute(at) : undefined} />}
      </div>
      {/* The button (above) carries the last-run result; the explanatory blurb sinks to the bottom in pale italic
          text, under a divider when there's a result to separate it from. */}
      <div className="min-h-[18px] flex-1" />
      <p
        className={`text-pretty text-[12px] leading-[1.5] ${hasResult ? "border-t border-[#22222a] pt-3" : ""}`}
        style={{ color: "#77777f" }}
      >
        {desc}
      </p>
    </section>
  );
}
