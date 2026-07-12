"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import type { RefreshProgress, RefreshResult } from "@/lib/refresh";
import { backupNow, setManualWatched, setMovieRatings } from "../actions";
import { ACTION_BUTTON_CLASS } from "./buttonStyle";

// Small owner-console action buttons. Refresh streams live progress from /api/admin/refresh (NDJSON) into a
// determinate bar; backup stays a plain server action. `lastRun` is the server-rendered summary shown when idle.

type RefreshMessage =
  | ({ type: "progress" } & RefreshProgress)
  | { type: "done"; result: RefreshResult }
  | { type: "error"; message: string };

export function RefreshNowButton({ lastRun }: { lastRun: ReactNode }) {
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
          if (msg.type === "progress") setProgress(msg);
          else if (msg.type === "error") streamError = msg.message;
        }
      }
      if (streamError) setError(streamError);
      else router.refresh(); // pull the updated "Last run" summary — one refresh, not a four-route revalidation
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2.5">
      <button type="button" disabled={running} onClick={run} className={ACTION_BUTTON_CLASS}>
        {running ? "Refreshing…" : "Refresh now"}
      </button>
      {running ? (
        <ProgressBar progress={progress} />
      ) : (
        <div className="space-y-0.5 text-sm text-[var(--color-muted)]">{lastRun}</div>
      )}
      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
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

// Owner toggle for the manual "mark watched" controls. Local state gives instant feedback; the server action
// persists the flag and revalidates the surfaces that render those controls.
export function ManualWatchedToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          start(() => setManualWatched(next));
        }}
        className="h-4 w-4 accent-[var(--color-accent-strong)] disabled:opacity-50"
      />
      <span>Enable manual watched toggle</span>
    </label>
  );
}

// Owner toggles for which rating sources appear on movie cards. Both checkboxes share one setting object, so each
// change persists the full { tmdb, imdb } pair; local state gives instant feedback and the action revalidates /movies.
export function MovieRatingsToggles({ tmdb, imdb }: { tmdb: boolean; imdb: boolean }) {
  const [state, setState] = useState({ tmdb, imdb });
  const [pending, start] = useTransition();
  function update(next: { tmdb: boolean; imdb: boolean }) {
    setState(next);
    start(() => setMovieRatings(next));
  }
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={state.tmdb}
          disabled={pending}
          onChange={(e) => update({ ...state, tmdb: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent-strong)] disabled:opacity-50"
        />
        <span>Show TMDB rating</span>
      </label>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={state.imdb}
          disabled={pending}
          onChange={(e) => update({ ...state, imdb: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent-strong)] disabled:opacity-50"
        />
        <span>Show IMDb rating</span>
      </label>
    </div>
  );
}

export function BackupNowButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await backupNow();
          setDone(true);
        })
      }
      className={ACTION_BUTTON_CLASS}
    >
      {pending ? "Backing up…" : done ? "Done ✓ — run again" : "Back up now"}
    </button>
  );
}
