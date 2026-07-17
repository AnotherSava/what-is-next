"use client";

import { type ReactNode, useState, useTransition } from "react";
import { syncPlexNow } from "../actions";
import { JOB_BUTTON_CLASS, JOB_BUTTON_STYLE } from "./buttonStyle";
import { FreshnessBadge } from "./FreshnessBadge";

// Triggers a full Plex scan (presence + candidate/unmatched refresh). useTransition keeps it responsive during
// the round-trip to Plex + TMDB. A failed sync (e.g. a 401 from a stale token) shows inline instead of crashing.
// The status badge shares the button's line so a long error message below can't shove it around.
export function SyncPlexButton({
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
  result: ReactNode; // the server-rendered last-sync result; hidden while a fresh sync is in progress
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="w-full space-y-[15px]">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await syncPlexNow();
              // On success the action revalidates the route, so the card's "Synced <when>" result re-renders itself.
              if (!res.ok) setError(res.error);
            })
          }
          className={JOB_BUTTON_CLASS}
          style={JOB_BUTTON_STYLE}
        >
          <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden />
          {pending ? "Syncing…" : "Sync Plex now"}
        </button>
        <FreshnessBadge text={freshness} color={freshnessColor} title={freshnessTitle} />
      </div>
      {/* While syncing, hide the previous run's result but keep its space so the card doesn't resize; on failure
          show the error in its place. */}
      {error ? (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      ) : (
        <div style={pending ? { visibility: "hidden" } : undefined}>{result}</div>
      )}
    </div>
  );
}
