"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import type { RefreshProgress, RefreshResult } from "@/lib/refresh";
import { backupNow, setManualWatched } from "../actions";
import { JOB_BUTTON_CLASS, JOB_BUTTON_STYLE } from "./buttonStyle";
import { FreshnessBadge } from "./FreshnessBadge";

// The status dot that sits inside each job's "run now" button (green = up to date, amber = needs attention).
function Dot({ color }: { color: string }) {
  return <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

// Small owner-console action buttons. Refresh streams live progress from /api/admin/refresh (NDJSON) into a
// determinate bar; backup stays a plain server action. `lastRun` is the server-rendered summary shown when idle.

type RefreshMessage =
  | ({ type: "progress" } & RefreshProgress)
  | { type: "done"; result: RefreshResult }
  | { type: "error"; message: string };

export function RefreshNowButton({
  dotColor,
  freshness,
  freshnessColor,
  freshnessTitle,
  result,
}: {
  dotColor: string;
  freshness: string;
  freshnessColor: string;
  freshnessTitle?: string;
  result: ReactNode; // the server-rendered last-run result; hidden while a fresh run is in progress
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setProgress(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/refresh", { method: "POST" });
      if (!res.ok || !res.body) {
        throw new Error(res.status === 403 ? "Not authorized." : `Refresh failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as RefreshMessage;
          // The final {type:"done"} result is ignored here — the card re-reads it from the DB on router.refresh().
          if (msg.type === "progress") setProgress(msg);
          else if (msg.type === "error") streamError = msg.message;
        }
      }
      if (streamError) setError(streamError);
      else router.refresh(); // pull the updated last-run result the card renders — one refresh, not a four-route revalidation
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="w-full space-y-[15px]">
      {/* Button and status share one line so the status stays put; the progress bar / result drops below, where its
          long episode titles can't shove the status around. */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" disabled={running} onClick={run} className={JOB_BUTTON_CLASS} style={JOB_BUTTON_STYLE}>
          <Dot color={dotColor} />
          {running ? "Refreshing…" : "Refresh now"}
        </button>
        <FreshnessBadge text={freshness} color={freshnessColor} title={freshnessTitle} />
      </div>
      {/* While running, the live progress bar replaces the previous run's result; on failure the error replaces it. */}
      {running ? (
        <ProgressBar progress={progress} />
      ) : error ? (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      ) : (
        result
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: RefreshProgress | null }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="max-w-md space-y-1.5" role="status" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
          // Before the first item lands (total known, done 0) show a thin sliver; an empty bar reads as "stuck".
          style={{ width: total === 0 ? "8%" : `${Math.max(pct, 2)}%` }}
        />
      </div>
      <p className="truncate text-xs text-[var(--color-muted)]">
        {total === 0 ? (
          "Preparing…"
        ) : (
          <>
            <span className="font-medium tabular-nums text-[var(--color-text)]">{pct}%</span> · {activePhase(progress!)}
            {progress!.current && (
              <>
                {" · "}
                <span className="text-[var(--color-text)]">{progress!.current}</span>
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

// One phase at a time: the first phase still holding unprocessed items. Phases run shows → movies → TVDB in order,
// so everything before the active one is done and everything after hasn't started — no need to show all three.
function activePhase(p: RefreshProgress): string {
  if (p.tvDone < p.tvTotal) return `Shows ${p.tvDone}/${p.tvTotal}`;
  if (p.movieDone < p.movieTotal) return `Movies ${p.movieDone}/${p.movieTotal}`;
  if (p.tvdbDone < p.tvdbTotal) return `TVDB ${p.tvdbDone}/${p.tvdbTotal}`;
  // All processed (a brief final frame before the stream closes) — report the last phase that had work at 100%.
  if (p.tvdbTotal > 0) return `TVDB ${p.tvdbTotal}/${p.tvdbTotal}`;
  if (p.movieTotal > 0) return `Movies ${p.movieTotal}/${p.movieTotal}`;
  return `Shows ${p.tvTotal}/${p.tvTotal}`;
}

// Owner toggle for the manual "mark watched" controls, styled as the design reference's pill switch. Local state
// gives instant feedback; the server action persists the flag and revalidates the surfaces that render the controls.
export function ManualWatchedToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={pending}
      onClick={() => {
        const next = !checked;
        setChecked(next);
        start(() => setManualWatched(next));
      }}
      className="flex cursor-pointer items-center gap-[11px] text-sm disabled:opacity-50"
    >
      <span
        className="relative h-5 w-[34px] shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "var(--color-accent-strong)" : "var(--color-border)" }}
      >
        <span
          className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left]"
          style={{ left: checked ? "16px" : "2px" }}
        />
      </span>
      <span>Enable manual watched toggle</span>
    </button>
  );
}

export function BackupNowButton({
  dotColor,
  freshness,
  freshnessColor,
  freshnessTitle,
  result,
}: {
  dotColor: string;
  freshness: string;
  freshnessColor: string;
  freshnessTitle?: string;
  result: ReactNode; // the server-rendered last-backup result; hidden while a fresh backup is in progress
}) {
  const [pending, start] = useTransition();
  return (
    <div className="w-full space-y-[15px]">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={pending}
          // The label stays stable rather than flipping to a "done" state — the result below carries the outcome.
          onClick={() => start(async () => void (await backupNow()))}
          className={JOB_BUTTON_CLASS}
          style={JOB_BUTTON_STYLE}
        >
          <Dot color={dotColor} />
          {pending ? "Backing up…" : "Back up now"}
        </button>
        <FreshnessBadge text={freshness} color={freshnessColor} title={freshnessTitle} />
      </div>
      {/* Hide the previous backup's result while a fresh one runs, but keep its space so the card doesn't resize. */}
      <div style={pending ? { visibility: "hidden" } : undefined}>{result}</div>
    </div>
  );
}
