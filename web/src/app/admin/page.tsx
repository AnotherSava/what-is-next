import { Fragment } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "@/app/_components/cardUi";
import { getPrisma } from "@/lib/db";
import { plural } from "@/lib/format";
import {
  getMediaServers,
  isUsable,
  MEDIA_PROVIDERS,
  PROVIDER_LABEL,
  syncSummary,
  type MediaProvider,
} from "@/lib/media";
import { getSessionUser } from "@/lib/session";
import type { RefreshError } from "@/lib/refresh";
import { refreshSummary } from "@/lib/refreshSummary";
import {
  getDownloadSources,
  getSetting,
  isManualWatchedEnabled,
  isWaitForFullSeasonEnabled,
  SYNC_KEYS,
} from "@/lib/settings";
import { isTvdbConfigured } from "@/lib/tvdb";
import { addSelectedLibraryItems, setManualWatched, setWaitForFullSeason } from "./actions";
import { BackupNowButton, RefreshNowButton, SettingToggle } from "./_components/AdminButtons";
import { ACTION_BUTTON_CLASS } from "./_components/buttonStyle";
import { FreshnessBadge } from "./_components/FreshnessBadge";
import { RunResult, StatRows } from "./_components/RunResult";
import { DownloadSourcesEditor } from "./_components/DownloadSources";
import { MediaServerForm } from "./_components/MediaServerForm";
import { SyncServerButton } from "./_components/SyncButton";

export const metadata: Metadata = { title: "Settings" };

// A job counts as "up to date" only if it ran within this window. The nightly cron runs daily, so ~a day + a
// couple hours of grace flags a genuinely missed run without false alarms from slight timing drift.
const FRESH_WINDOW_MS = 26 * 60 * 60 * 1000;

type JobState = "ok" | "warn"; // green / amber

// The colour each state reads in. The freshness badge is the only thing that carries it — its wording and colour
// together are the status, so the button doesn't repeat it as a dot. There's no "not configured" colour: a
// server that's switched off has no card to colour (see the job grid).
const STATE_COLOR: Record<JobState, string> = {
  ok: "var(--color-good)",
  warn: "var(--color-behind)",
};

// Display order for the media servers — Jellyfin first, in both the job cards and the connection forms.
// Deliberately separate from MEDIA_PROVIDERS, which stays the canonical order everything else reads from:
// bookkeeping keys, and the play-link preference that sends a title held by both servers to Plex.
const SERVER_DISPLAY_ORDER: MediaProvider[] = ["jellyfin", "plex"];

// Columns for the job grid, keyed by how many cards it actually holds (Refresh + Backup + each connected
// server). Written out rather than computed so Tailwind can see every class it has to generate.
const JOB_GRID_COLS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
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
function backupFileLines(filePath: string | null): React.ReactNode {
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
  const servers = await getMediaServers();
  const [refresh, backup, tvdbStubs, manualWatched, waitForFullSeason, downloadSources, ...serverRuns] =
    await Promise.all([
      getSetting("refresh:lastRun"),
      getSetting("backup:lastRun"),
      getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
      isManualWatchedEnabled(),
      isWaitForFullSeasonEnabled(),
      getDownloadSources(),
      // One bookkeeping bundle per provider, loaded whether or not it's connected — a card renders for each.
      ...MEDIA_PROVIDERS.map(async (provider) => ({
        provider,
        lastSync: await getSetting(SYNC_KEYS[provider].lastSync),
        candidates: await getSetting(SYNC_KEYS[provider].candidates),
        unaccounted: await getSetting(SYNC_KEYS[provider].unaccounted),
      })),
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

  // ── Media servers (Plex + Jellyfin) ──────────────────────────────────────
  // One derived view per provider: its status badge, its last-run stats, and the two review lists its last
  // scan produced. Both providers go through the same code, so their cards can't drift apart. Every provider is
  // derived (its review lists render below regardless), but only the connected ones get a job card.
  const mediaCards = serverRuns.map(({ provider, lastSync, candidates, unaccounted }) => {
    const connected = isUsable(servers[provider]);
    const candidateItems = connected ? (candidates?.items ?? []) : [];
    const unaccountedItems = connected ? (unaccounted?.items ?? []) : [];
    const state: JobState =
      !lastSync || stale(lastSync.at) || candidateItems.length > 0 || unaccountedItems.length > 0 ? "warn" : "ok";
    const freshness = !lastSync ? "never synced" : stale(lastSync.at) ? "stale" : "up to date";
    // The last sync's result — always shown, with its relative time in the heading and the duration to the right.
    const res = lastSync ? syncSummary(lastSync) : null;
    return {
      provider,
      label: PROVIDER_LABEL[provider],
      connected,
      state,
      freshness,
      at: lastSync?.at,
      candidates: candidateItems,
      unaccounted: unaccountedItems,
      stats:
        lastSync && res ? (
          <RunResult verb="Synced" when={ago(lastSync.at, nowMs)} duration={res.duration}>
            <StatRows stats={res.stats} />
          </RunResult>
        ) : null,
    };
  });
  // Job cards follow the same order as the forms below, so the two halves of the page agree.
  const connectedServers = SERVER_DISPLAY_ORDER.flatMap((p) => {
    const card = mediaCards.find((c) => c.provider === p);
    return card?.connected ? [card] : [];
  });

  // ── Backup ───────────────────────────────────────────────────────────────
  const backupState: JobState = !backup ? "warn" : !backup.ok || stale(backup.at) ? "warn" : "ok";
  const backupFresh = !backup ? "never run" : !backup.ok ? "failed" : stale(backup.at) ? "stale" : "up to date";
  const backupStats: React.ReactNode = !backup ? null : !backup.ok ? (
    <p className="text-[12px] text-red-400">{backup.error ?? "Backup failed."}</p>
  ) : (
    <RunResult verb="Backed up" when={ago(backup.at, nowMs)}>
      {backupFileLines(backup.file)}
    </RunResult>
  );

  return (
    <div className="space-y-[14px]">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Signed in as {sessionUser.name}.</p>
      </div>

      {/* One card per scheduled job — the run-now button + freshness badge up top, stats at the bottom. A media
          server that's switched off has no card at all; you turn it back on from Media servers below. */}
      <div className={`grid grid-cols-1 gap-[14px] ${JOB_GRID_COLS[2 + connectedServers.length]}`}>
        <JobCard
          button={
            <RefreshNowButton
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
        />

        {connectedServers.map((c) => (
          <JobCard
            key={c.provider}
            button={
              <SyncServerButton
                provider={c.provider}
                label={c.label}
                freshness={c.freshness}
                freshnessColor={STATE_COLOR[c.state]}
                freshnessTitle={c.at ? absolute(c.at) : undefined}
                result={c.stats}
              />
            }
            statusInButton
            freshness={c.freshness}
            color={STATE_COLOR[c.state]}
            at={c.at}
          />
        ))}

        <JobCard
          button={
            <BackupNowButton
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
        />
      </div>

      {/* Library review, per server — only when that server's last sync surfaced something to act on. Each list is
          its own form because the two servers' item keys live in separate id spaces. */}
      {mediaCards.map((c) => (
        <Fragment key={c.provider}>
          {c.candidates.length > 0 && (
            <section className={`${CARD_CLASS} p-5`}>
              <h3 className="font-display text-[16px] font-semibold">
                In {c.label} but not tracked{" "}
                <span className="font-normal text-[var(--color-muted)]">({c.candidates.length})</span>
              </h3>
              <form action={addSelectedLibraryItems} className="mt-3 space-y-3">
                <input type="hidden" name="provider" value={c.provider} />
                <ul className="space-y-1">
                  {c.candidates.map((item) => (
                    <li key={item.itemKey}>
                      <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                        <input
                          type="checkbox"
                          name="itemKey"
                          value={item.itemKey}
                          defaultChecked
                          className="accent-[#e5a00d]"
                        />
                        <span className="flex-1 text-sm">
                          {item.title} {item.year && <span className="text-[var(--color-muted)]">({item.year})</span>}
                          <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                            {item.mediaType === "tv" ? "TV" : "Movie"}
                          </span>
                          {item.watched && <span className="ml-2 text-xs text-[var(--color-good)]">watched</span>}
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

          {c.unaccounted.length > 0 && (
            <section className={`${CARD_CLASS} p-5`}>
              <h3 className="font-display text-[16px] font-semibold">
                Unmatched in {c.label}{" "}
                <span className="font-normal text-[var(--color-muted)]">({c.unaccounted.length})</span>
              </h3>
              <p className={`mt-2 ${DESC_CLASS}`}>
                In your {c.label} libraries but with no TMDB, IMDb, or TVDB id, so the sync can neither match them to
                the catalog nor add them automatically. Fix the match in {c.label}, then they&rsquo;ll sync normally.
              </p>
              <ul className="mt-3 space-y-1">
                {c.unaccounted.map((u) => (
                  <li key={u.itemKey} className="flex items-center gap-3 rounded-md px-2 py-1.5">
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
        </Fragment>
      ))}

      {/* App settings. */}
      <section className={`${CARD_CLASS} p-5`}>
        <h2 className="font-display text-[16px] font-semibold">Settings</h2>

        <div className="mt-[14px]">
          <h3 className="font-display text-[13px] font-semibold">Media servers</h3>
          <p className={`mt-1 ${DESC_CLASS}`}>
            Where your library lives. Each server can be switched on independently — with both connected, presence,
            watch history and play links are merged, so you can migrate from one to the other without losing either.
            Tokens are encrypted before they&rsquo;re stored, so a database backup carries no usable credential.
          </p>
          {/* Side by side once there's room for two columns of fields; stacked below that. Each form's own fields
              stay a single column here, since half the card is too narrow to pair them up. */}
          <div className="mt-3 grid grid-cols-1 items-start gap-x-8 gap-y-6 lg:grid-cols-2">
            {SERVER_DISPLAY_ORDER.map((provider) => (
              <MediaServerForm
                key={provider}
                provider={provider}
                label={PROVIDER_LABEL[provider]}
                fields={{
                  enabled: servers[provider].enabled,
                  url: servers[provider].url,
                  libraries: servers[provider].libraries,
                  user: servers[provider].user,
                  hasToken: Boolean(servers[provider].token),
                }}
                urlPlaceholder={provider === "plex" ? "http://localhost:32400" : "http://localhost:8096"}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-[#22222a] pt-4">
          <SettingToggle enabled={manualWatched} label="Enable manual watched toggle" action={setManualWatched} />
          <p className={`mt-1.5 ${DESC_CLASS}`}>
            Off by default — watch state comes from your media server. Turn on to show manual mark-watched controls on
            the home, show, and movie pages.
          </p>
        </div>

        <div className="mt-4">
          <SettingToggle
            enabled={waitForFullSeason}
            label="Wait for the full season to air"
            action={setWaitForFullSeason}
          />
          <p className={`mt-1.5 ${DESC_CLASS}`}>
            On by default — a show whose current season is still airing stays Up to date, and out of the Download view,
            until that season has fully aired, so you pick up a season only once it&rsquo;s complete. Turn off to be
            surfaced episodes as soon as they air. Shows that have already ended aren&rsquo;t affected.
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
  statusInButton,
}: {
  button: React.ReactNode;
  freshness: string;
  color: string;
  at?: string;
  // When the button owns the status badge (all configured jobs), it renders the badge on its own line so a
  // progress bar / result below can't shove it around — otherwise the card renders the badge in the header itself.
  statusInButton?: boolean;
}) {
  // The button component renders both the run-now button and the last run's result, so the card is just that
  // block inside its padding. There's no trailing spacer: it existed to push a description to the bottom, and
  // with the descriptions gone it only left the cards taller than their content.
  return (
    <section className={`h-full ${CARD_CLASS} px-5 py-[18px]`}>
      <div className="flex items-center justify-between gap-3">
        {button ?? <span />}
        {!statusInButton && <FreshnessBadge text={freshness} color={color} title={at ? absolute(at) : undefined} />}
      </div>
    </section>
  );
}
